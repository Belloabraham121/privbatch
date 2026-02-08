const snarkjs = require('snarkjs');
const fs = require('fs');
const path = require('path');

// Import Poseidon hash from circomlibjs
// circomlibjs provides JavaScript implementations of circomlib functions

/**
 * Generate ZK proof for commitment hash
 * 
 * This script generates a Groth16 proof that proves knowledge of trade parameters
 * that hash to a given commitmentHash, without revealing the parameters.
 * 
 * Usage:
 *   node generate-proof.js <user> <tokenIn> <tokenOut> <amountIn> <minAmountOut> <recipient> <nonce> <deadline>
 * 
 * Or edit the inputs object below and run: node generate-proof.js
 */

// Paths to circuit artifacts
const WASM_PATH = path.join(__dirname, '../../build/zk/commitment-proof_js/commitment-proof.wasm');
const ZKEY_PATH = path.join(__dirname, '../../build/zk/final.zkey');

/**
 * Compute commitment hash using Poseidon
 * This must match what the circuit computes
 */
async function computeCommitmentHash(inputs) {
    // Use circomlibjs to compute Poseidon hash
    // This matches what the circuit computes
    try {
        const circomlibjs = require('circomlibjs');
        const poseidon = await circomlibjs.buildPoseidon();
        
        // Compute hash with 8 inputs (matching circuit)
        const hash = poseidon([
            BigInt(inputs.user),
            BigInt(inputs.tokenIn),
            BigInt(inputs.tokenOut),
            BigInt(inputs.amountIn),
            BigInt(inputs.minAmountOut),
            BigInt(inputs.recipient),
            BigInt(inputs.nonce),
            BigInt(inputs.deadline)
        ]);
        
        // Convert to string (poseidon returns field element)
        return poseidon.F.toString(hash);
    } catch (e) {
        console.error('❌ Failed to load circomlibjs.');
        console.error('Error:', e.message);
        console.error('\nPlease install missing dependencies:');
        console.error('  cd scripts/zk && npm install');
        throw new Error('circomlibjs or dependencies missing. Run: npm install');
    }
}

async function generateProof(inputs) {
    console.log('Generating ZK proof...');
    console.log('Inputs:', inputs);
    
    // Verify files exist
    if (!fs.existsSync(WASM_PATH)) {
        throw new Error(`WASM file not found: ${WASM_PATH}`);
    }
    if (!fs.existsSync(ZKEY_PATH)) {
        throw new Error(`ZKEY file not found: ${ZKEY_PATH}`);
    }

    // Compute commitment hash if not provided
    let commitmentHash = inputs.commitmentHash;
    if (!commitmentHash || commitmentHash === '0') {
        commitmentHash = await computeCommitmentHash(inputs);
        console.log('📝 Computed commitment hash:', commitmentHash);
    }
    
    // Update inputs with computed commitmentHash
    const proofInputs = {
        ...inputs,
        commitmentHash: commitmentHash
    };

    const startTime = Date.now();
    
    // Generate proof using snarkjs
    const { proof, publicSignals } = await snarkjs.groth16.fullProve(
        proofInputs,
        WASM_PATH,
        ZKEY_PATH
    );

    const endTime = Date.now();
    const duration = ((endTime - startTime) / 1000).toFixed(2);

    console.log(`\n✅ Proof generated in ${duration} seconds`);
    console.log('\n📊 Public Signals (commitmentHash):');
    console.log('  Commitment Hash:', publicSignals[0]);
    
    console.log('\n🔐 Proof Structure:');
    console.log('  A:', proof.pi_a);
    console.log('  B:', proof.pi_b);
    console.log('  C:', proof.pi_c);

    // Format proof for Solidity (Groth16Verifier format)
    const proofFormatted = {
        a: [proof.pi_a[0], proof.pi_a[1]],
        b: [
            [proof.pi_b[0][1], proof.pi_b[0][0]], // Reverse order for Solidity
            [proof.pi_b[1][1], proof.pi_b[1][0]]
        ],
        c: [proof.pi_c[0], proof.pi_c[1]]
    };

    const publicSignalsFormatted = [publicSignals[0]]; // commitmentHash

    // Save proof and public signals
    const outputDir = path.join(__dirname, '../../build/zk');
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }

    fs.writeFileSync(
        path.join(outputDir, 'proof.json'),
        JSON.stringify(proofFormatted, null, 2)
    );
    
    fs.writeFileSync(
        path.join(outputDir, 'public.json'),
        JSON.stringify(publicSignalsFormatted, null, 2)
    );

    fs.writeFileSync(
        path.join(outputDir, 'proof-full.json'),
        JSON.stringify({ proof, publicSignals }, null, 2)
    );

    console.log('\n💾 Proof saved to:');
    console.log(`  - ${path.join(outputDir, 'proof.json')} (Solidity format)`);
    console.log(`  - ${path.join(outputDir, 'public.json')} (Public signals)`);
    console.log(`  - ${path.join(outputDir, 'proof-full.json')} (Full proof)`);

    // Return formatted proof for use in scripts
    return {
        proof: proofFormatted,
        publicSignals: publicSignalsFormatted,
        commitmentHash: publicSignals[0]
    };
}

// Main execution
async function main() {
    try {
        // Get inputs from command line or use defaults
        const args = process.argv.slice(2);
        
        let inputs;
        if (args.length >= 8) {
            // Parse command line arguments
            inputs = {
                user: BigInt(args[0]).toString(),
                tokenIn: BigInt(args[1]).toString(),
                tokenOut: BigInt(args[2]).toString(),
                amountIn: BigInt(args[3]).toString(),
                minAmountOut: BigInt(args[4]).toString(),
                recipient: BigInt(args[5]).toString(),
                nonce: BigInt(args[6]).toString(),
                deadline: BigInt(args[7]).toString(),
                commitmentHash: BigInt(args[8] || '0').toString() // Optional: pre-computed hash
            };
        } else {
            // Example inputs (edit these for your test)
            const userAddress = '0x28482B1279E442f49eE76351801232D58f341CB9';
            const tokenInAddress = '0x036CbD53842c5426634e7929541eC2318f3dCF7e'; // USDC
            const tokenOutAddress = '0x4DBD49a3aE90Aa5F13091ccD29A896cbb5B171EB'; // USDT
            const amountIn = '1000000'; // 1 USDC (6 decimals)
            const minAmountOut = '9000000000000000000'; // 9 USDT (18 decimals)
            const recipientAddress = userAddress;
            const nonce = '42';
            const deadline = Math.floor(Date.now() / 1000) + 3600; // 1 hour from now

            inputs = {
                user: BigInt(userAddress).toString(),
                tokenIn: BigInt(tokenInAddress).toString(),
                tokenOut: BigInt(tokenOutAddress).toString(),
                amountIn: amountIn,
                minAmountOut: minAmountOut,
                recipient: BigInt(recipientAddress).toString(),
                nonce: nonce,
                deadline: deadline.toString(),
                commitmentHash: '0' // Will be computed by circuit
            };
        }

        const result = await generateProof(inputs);
        
        console.log('\n✅ Proof generation complete!');
        console.log('\n📋 Next steps:');
        console.log('  1. Use the proof in proof.json to call submitCommitmentWithProof()');
        console.log('  2. The commitmentHash in public.json must match your on-chain commitment');
        console.log('  3. Format proof for Solidity:');
        console.log('     - a: [uint256, uint256]');
        console.log('     - b: [[uint256, uint256], [uint256, uint256]]');
        console.log('     - c: [uint256, uint256]');
        console.log('     - publicSignals: [uint256] (commitmentHash)');
        
        process.exit(0);
    } catch (error) {
        console.error('\n❌ Error generating proof:');
        console.error(error.message);
        if (error.stack) {
            console.error(error.stack);
        }
        process.exit(1);
    }
}

// Run if called directly
if (require.main === module) {
    main();
}

module.exports = { generateProof };
