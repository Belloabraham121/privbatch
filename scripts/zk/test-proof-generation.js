#!/usr/bin/env node

/**
 * ZK Proof Generation Test Suite
 * Tests proof generation, validation, and privacy properties
 */

const snarkjs = require('snarkjs');
const fs = require('fs');
const path = require('path');

// Load circomlibjs for Poseidon hashing
let circomlibjs;
try {
    circomlibjs = require('circomlibjs');
} catch (e) {
    console.error('❌ Error: circomlibjs not found. Install with: npm install circomlibjs');
    process.exit(1);
}

const WASM_PATH = path.join(__dirname, '../../build/zk/commitment-proof_js/commitment-proof.wasm');
const ZKEY_PATH = path.join(__dirname, '../../build/zk/final.zkey');

// Test results tracking
const testResults = {
    passed: 0,
    failed: 0,
    tests: []
};

function logTest(name, passed, details = '') {
    const status = passed ? '✅' : '❌';
    console.log(`${status} ${name}${details ? ': ' + details : ''}`);
    testResults.tests.push({ name, passed, details });
    if (passed) testResults.passed++;
    else testResults.failed++;
}

/**
 * Compute commitment hash using Poseidon
 */
async function computeCommitmentHash(inputs) {
    const poseidon = await circomlibjs.buildPoseidon();
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
    return poseidon.F.toString(hash);
}

/**
 * Generate proof and measure time
 */
async function generateProofWithTiming(inputs) {
    const startTime = Date.now();
    
    let commitmentHash = inputs.commitmentHash;
    if (!commitmentHash || commitmentHash === '0') {
        commitmentHash = await computeCommitmentHash(inputs);
    }

    const proofInputs = {
        ...inputs,
        commitmentHash: commitmentHash
    };

    const { proof, publicSignals } = await snarkjs.groth16.fullProve(
        proofInputs,
        WASM_PATH,
        ZKEY_PATH
    );

    const endTime = Date.now();
    const duration = endTime - startTime;

    return { proof, publicSignals, commitmentHash, duration };
}

/**
 * Test 1: Valid proof generation with various parameters
 */
async function testValidProofGeneration() {
    console.log('\n📋 Test 1: Valid Proof Generation');
    console.log('='.repeat(50));

    const testCases = [
        {
            name: 'Small amounts',
            inputs: {
                user: '229969036602647245296619092241183476068732116153',
                tokenIn: '19551945435078646265689162860222206903555313534',
                tokenOut: '443813545090893575307080745651382659354832499179',
                amountIn: '1000000',
                minAmountOut: '900000',
                recipient: '229969036602647245296619092241183476068732116153',
                nonce: '1',
                deadline: '1770524208',
                commitmentHash: '0'
            }
        },
        {
            name: 'Large amounts',
            inputs: {
                user: '123456789012345678901234567890123456789012345678',
                tokenIn: '19551945435078646265689162860222206903555313534',
                tokenOut: '443813545090893575307080745651382659354832499179',
                amountIn: '1000000000000000000000000', // 1M tokens with 18 decimals
                minAmountOut: '950000000000000000000000',
                recipient: '987654321098765432109876543210987654321098765432',
                nonce: '42',
                deadline: '2000000000',
                commitmentHash: '0'
            }
        },
        {
            name: 'Different token pair',
            inputs: {
                user: '111111111111111111111111111111111111111111111111',
                tokenIn: '443813545090893575307080745651382659354832499179',
                tokenOut: '19551945435078646265689162860222206903555313534',
                amountIn: '5000000',
                minAmountOut: '4500000',
                recipient: '222222222222222222222222222222222222222222222222',
                nonce: '100',
                deadline: '1800000000',
                commitmentHash: '0'
            }
        },
        {
            name: 'Maximum nonce',
            inputs: {
                user: '333333333333333333333333333333333333333333333333',
                tokenIn: '19551945435078646265689162860222206903555313534',
                tokenOut: '443813545090893575307080745651382659354832499179',
                amountIn: '1000000',
                minAmountOut: '900000',
                recipient: '444444444444444444444444444444444444444444444444',
                nonce: '115792089237316195423570985008687907853269984665640564039457', // Max uint256
                deadline: '1770524208',
                commitmentHash: '0'
            }
        }
    ];

    for (const testCase of testCases) {
        try {
            const { proof, publicSignals, commitmentHash, duration } = await generateProofWithTiming(testCase.inputs);
            
            // Verify proof structure
            // pi_b has length 3 in snarkjs format (G2 point in affine coordinates)
            const hasValidStructure = 
                proof.pi_a && Array.isArray(proof.pi_a) && proof.pi_a.length === 3 &&
                proof.pi_b && Array.isArray(proof.pi_b) && proof.pi_b.length === 3 &&
                proof.pi_c && Array.isArray(proof.pi_c) && proof.pi_c.length === 3 &&
                publicSignals && Array.isArray(publicSignals) && publicSignals.length === 1;

            // Verify public signal matches commitment hash
            const hashMatches = publicSignals[0] === commitmentHash;
            
            logTest(
                `${testCase.name}`,
                hasValidStructure && hashMatches,
                `Duration: ${duration}ms, Hash: ${commitmentHash.slice(0, 20)}...${hashMatches ? '' : ' (hash mismatch)'}`
            );

            // Verify timing (should be 1-4 seconds, but allow up to 10s for slower machines)
            if (duration > 10000) {
                logTest(`${testCase.name} - Timing`, false, `Too slow: ${duration}ms`);
            } else {
                logTest(`${testCase.name} - Timing`, true, `${duration}ms`);
            }
        } catch (error) {
            logTest(`${testCase.name}`, false, error.message);
        }
    }
}

/**
 * Test 2: Invalid inputs (should fail)
 */
async function testInvalidInputs() {
    console.log('\n📋 Test 2: Invalid Input Handling');
    console.log('='.repeat(50));

    const invalidCases = [
        {
            name: 'Missing required field',
            inputs: {
                user: '229969036602647245296619092241183476068732116153',
                // Missing tokenIn
                tokenOut: '443813545090893575307080745651382659354832499179',
                amountIn: '1000000',
                minAmountOut: '900000',
                recipient: '229969036602647245296619092241183476068732116153',
                nonce: '1',
                deadline: '1770524208',
                commitmentHash: '0'
            }
        },
        {
            name: 'Invalid commitment hash mismatch',
            inputs: {
                user: '229969036602647245296619092241183476068732116153',
                tokenIn: '19551945435078646265689162860222206903555313534',
                tokenOut: '443813545090893575307080745651382659354832499179',
                amountIn: '1000000',
                minAmountOut: '900000',
                recipient: '229969036602647245296619092241183476068732116153',
                nonce: '1',
                deadline: '1770524208',
                commitmentHash: '9999999999999999999999999999999999999999999999999999999999999999999999999999' // Wrong hash
            }
        }
    ];

    for (const testCase of invalidCases) {
        try {
            await generateProofWithTiming(testCase.inputs);
            logTest(`${testCase.name}`, false, 'Should have failed but succeeded');
        } catch (error) {
            logTest(`${testCase.name}`, true, `Correctly failed: ${error.message.slice(0, 50)}...`);
        }
    }
}

/**
 * Test 3: Proof structure validation
 */
async function testProofStructure() {
    console.log('\n📋 Test 3: Proof Structure Validation');
    console.log('='.repeat(50));

    const inputs = {
        user: '229969036602647245296619092241183476068732116153',
        tokenIn: '19551945435078646265689162860222206903555313534',
        tokenOut: '443813545090893575307080745651382659354832499179',
        amountIn: '1000000',
        minAmountOut: '900000',
        recipient: '229969036602647245296619092241183476068732116153',
        nonce: '1',
        deadline: '1770524208',
        commitmentHash: '0'
    };

    try {
        const { proof, publicSignals } = await generateProofWithTiming(inputs);

        // Test 3.1: Proof has correct structure
        // pi_a: [x, y, z] where z is typically "1" (affine coordinates)
        const hasPiA = proof.pi_a && Array.isArray(proof.pi_a) && proof.pi_a.length === 3;
        // pi_b: snarkjs returns [[x1, y1], [x2, y2], [1, 0]] for G2 points (affine coordinates)
        // The third element [1, 0] is the point at infinity in affine coordinates
        const hasPiB = proof.pi_b && Array.isArray(proof.pi_b) && proof.pi_b.length === 3 && 
                       Array.isArray(proof.pi_b[0]) && proof.pi_b[0].length === 2 &&
                       Array.isArray(proof.pi_b[1]) && proof.pi_b[1].length === 2 &&
                       Array.isArray(proof.pi_b[2]) && proof.pi_b[2].length === 2 &&
                       typeof proof.pi_b[0][0] === 'string' && typeof proof.pi_b[0][1] === 'string' &&
                       typeof proof.pi_b[1][0] === 'string' && typeof proof.pi_b[1][1] === 'string';
        // pi_c: [x, y, z] where z is typically "1"
        const hasPiC = proof.pi_c && Array.isArray(proof.pi_c) && proof.pi_c.length === 3;
        const hasPublicSignals = publicSignals && Array.isArray(publicSignals) && publicSignals.length === 1;

        logTest('Proof structure (pi_a)', hasPiA, `Length: ${proof.pi_a?.length || 0}`);
        logTest('Proof structure (pi_b)', hasPiB, `Shape: [3][2] (G2 point in affine coords)`);
        logTest('Proof structure (pi_c)', hasPiC, `Length: ${proof.pi_c?.length || 0}`);
        logTest('Public signals structure', hasPublicSignals, `Length: ${publicSignals?.length || 0}`);

        // Test 3.2: All values are valid BigInt strings
        const allValuesValid = 
            proof.pi_a.every(v => typeof v === 'string' && /^\d+$/.test(v)) &&
            proof.pi_b.flat().every(v => typeof v === 'string' && /^\d+$/.test(v)) &&
            proof.pi_c.every(v => typeof v === 'string' && /^\d+$/.test(v)) &&
            publicSignals.every(v => typeof v === 'string' && /^\d+$/.test(v));

        logTest('All values are valid BigInt strings', allValuesValid);

        // Test 3.3: Values are within field size (rough check - should be < 2^254)
        const maxFieldSize = '21888242871839275222246405745257275088548364400416034343698204186575808495617';
        const valuesInField = 
            proof.pi_a.every(v => BigInt(v) < BigInt(maxFieldSize)) &&
            proof.pi_b.flat().every(v => BigInt(v) < BigInt(maxFieldSize)) &&
            proof.pi_c.every(v => BigInt(v) < BigInt(maxFieldSize));

        logTest('All values within field size', valuesInField);

    } catch (error) {
        logTest('Proof structure validation', false, error.message);
    }
}

/**
 * Test 4: Privacy - verify private inputs are hidden
 */
async function testPrivacyProperties() {
    console.log('\n📋 Test 4: Privacy Properties (Input Hiding)');
    console.log('='.repeat(50));

    const inputs = {
        user: '229969036602647245296619092241183476068732116153',
        tokenIn: '19551945435078646265689162860222206903555313534',
        tokenOut: '443813545090893575307080745651382659354832499179',
        amountIn: '1000000',
        minAmountOut: '900000',
        recipient: '229969036602647245296619092241183476068732116153',
        nonce: '1',
        deadline: '1770524208',
        commitmentHash: '0'
    };

    try {
        const { proof } = await generateProofWithTiming(inputs);

        // Serialize proof to JSON string
        const proofString = JSON.stringify(proof);
        
        // Test 4.1: Proof string does not contain private input values
        // Note: We check for exact matches, not substrings, to avoid false positives
        // (e.g., a nonce "1" might appear as part of a larger number)
        const containsUser = proofString.includes(`"${inputs.user}"`) || proofString.includes(`'${inputs.user}'`);
        const containsTokenIn = proofString.includes(`"${inputs.tokenIn}"`) || proofString.includes(`'${inputs.tokenIn}'`);
        const containsTokenOut = proofString.includes(`"${inputs.tokenOut}"`) || proofString.includes(`'${inputs.tokenOut}'`);
        const containsAmountIn = proofString.includes(`"${inputs.amountIn}"`) || proofString.includes(`'${inputs.amountIn}'`);
        const containsRecipient = proofString.includes(`"${inputs.recipient}"`) || proofString.includes(`'${inputs.recipient}'`);
        // For nonce, check if it appears as a standalone value (not part of a larger number)
        // This is a heuristic - small nonces might appear in encoded values
        const noncePattern = new RegExp(`[^0-9]${inputs.nonce}[^0-9]`);
        const containsNonce = noncePattern.test(proofString) || proofString.includes(`"${inputs.nonce}"`);

        logTest('User address hidden', !containsUser);
        logTest('TokenIn hidden', !containsTokenIn);
        logTest('TokenOut hidden', !containsTokenOut);
        logTest('AmountIn hidden', !containsAmountIn);
        logTest('Recipient hidden', !containsRecipient);
        // Note: Small nonces (like "1") might appear in encoded proof values - this is acceptable
        // as they don't reveal the actual trade parameters
        logTest('Nonce hidden (heuristic)', !containsNonce, containsNonce ? 'Nonce may appear in encoded values (acceptable)' : '');

        // Test 4.2: Proof is deterministic (same inputs = same proof structure, but values may vary due to randomness)
        const { proof: proof2 } = await generateProofWithTiming(inputs);
        
        // Proofs should have same structure
        const sameStructure = 
            proof.pi_a.length === proof2.pi_a.length &&
            proof.pi_b.length === proof2.pi_b.length &&
            proof.pi_c.length === proof2.pi_c.length;
        
        // But values should be different (randomness in proof generation)
        // Note: Due to randomness, proofs will be different each time
        const proof1String = JSON.stringify(proof);
        const proof2String = JSON.stringify(proof2);
        const differentValues = proof1String !== proof2String;

        logTest('Proof structure deterministic', sameStructure);
        logTest('Proof values non-deterministic (randomness)', differentValues, differentValues ? 'Proofs differ (expected)' : 'Proofs identical (unexpected)');

    } catch (error) {
        logTest('Privacy properties test', false, error.message);
    }
}

/**
 * Test 5: Proof serialization/deserialization
 */
async function testSerialization() {
    console.log('\n📋 Test 5: Proof Serialization/Deserialization');
    console.log('='.repeat(50));

    const inputs = {
        user: '229969036602647245296619092241183476068732116153',
        tokenIn: '19551945435078646265689162860222206903555313534',
        tokenOut: '443813545090893575307080745651382659354832499179',
        amountIn: '1000000',
        minAmountOut: '900000',
        recipient: '229969036602647245296619092241183476068732116153',
        nonce: '1',
        deadline: '1770524208',
        commitmentHash: '0'
    };

    try {
        const { proof, publicSignals } = await generateProofWithTiming(inputs);

        // Test 5.1: JSON serialization
        const jsonString = JSON.stringify({ proof, publicSignals });
        const parsed = JSON.parse(jsonString);
        
        const serializationWorks = 
            parsed.proof.pi_a.length === proof.pi_a.length &&
            parsed.proof.pi_b.length === proof.pi_b.length &&
            parsed.proof.pi_c.length === proof.pi_c.length &&
            parsed.publicSignals.length === publicSignals.length;

        logTest('JSON serialization', serializationWorks);

        // Test 5.2: Round-trip (serialize -> deserialize -> compare)
        const roundTripWorks = 
            JSON.stringify(parsed.proof) === JSON.stringify(proof) &&
            JSON.stringify(parsed.publicSignals) === JSON.stringify(publicSignals);

        logTest('Round-trip serialization', roundTripWorks);

        // Test 5.3: Format for Solidity (a, b, c arrays)
        const solidityFormat = {
            a: [proof.pi_a[0], proof.pi_a[1]],
            b: [
                [proof.pi_b[0][1], proof.pi_b[0][0]],
                [proof.pi_b[1][1], proof.pi_b[1][0]]
            ],
            c: [proof.pi_c[0], proof.pi_c[1]]
        };

        const hasCorrectFormat = 
            solidityFormat.a.length === 2 &&
            solidityFormat.b.length === 2 && solidityFormat.b[0].length === 2 && solidityFormat.b[1].length === 2 &&
            solidityFormat.c.length === 2;

        logTest('Solidity format conversion', hasCorrectFormat);

        // Save formatted proof for testing
        const outputDir = path.join(__dirname, '../../build/zk');
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
        }
        fs.writeFileSync(
            path.join(outputDir, 'proof-test.json'),
            JSON.stringify(solidityFormat, null, 2)
        );

    } catch (error) {
        logTest('Serialization test', false, error.message);
    }
}

/**
 * Test 6: Performance benchmarks
 */
async function testPerformanceBenchmarks() {
    console.log('\n📋 Test 6: Performance Benchmarks');
    console.log('='.repeat(50));

    const inputs = {
        user: '229969036602647245296619092241183476068732116153',
        tokenIn: '19551945435078646265689162860222206903555313534',
        tokenOut: '443813545090893575307080745651382659354832499179',
        amountIn: '1000000',
        minAmountOut: '900000',
        recipient: '229969036602647245296619092241183476068732116153',
        nonce: '1',
        deadline: '1770524208',
        commitmentHash: '0'
    };

    const iterations = 5;
    const timings = [];

    console.log(`Running ${iterations} iterations for benchmark...`);

    for (let i = 0; i < iterations; i++) {
        try {
            const { duration } = await generateProofWithTiming(inputs);
            timings.push(duration);
            console.log(`  Iteration ${i + 1}: ${duration}ms`);
        } catch (error) {
            logTest(`Benchmark iteration ${i + 1}`, false, error.message);
        }
    }

    if (timings.length > 0) {
        const avg = timings.reduce((a, b) => a + b, 0) / timings.length;
        const min = Math.min(...timings);
        const max = Math.max(...timings);

        logTest('Average proof generation time', avg < 4000, `${avg.toFixed(2)}ms (target: <4000ms)`);
        logTest('Minimum proof generation time', min < 1000, `${min}ms`);
        logTest('Maximum proof generation time', max < 10000, `${max}ms (target: <10000ms)`);

        console.log(`\n📊 Benchmark Summary:`);
        console.log(`  Average: ${avg.toFixed(2)}ms`);
        console.log(`  Min: ${min}ms`);
        console.log(`  Max: ${max}ms`);
    }
}

/**
 * Main test runner
 */
async function runAllTests() {
    console.log('🧪 ZK Proof Generation Test Suite');
    console.log('='.repeat(50));
    console.log(`WASM: ${WASM_PATH}`);
    console.log(`ZKEY: ${ZKEY_PATH}`);
    console.log('='.repeat(50));

    // Check if files exist
    if (!fs.existsSync(WASM_PATH)) {
        console.error(`❌ WASM file not found: ${WASM_PATH}`);
        console.error('   Run: cd circuits && npm run compile');
        process.exit(1);
    }

    if (!fs.existsSync(ZKEY_PATH)) {
        console.error(`❌ ZKEY file not found: ${ZKEY_PATH}`);
        console.error('   Run: cd circuits && npm run setup-groth16 && npm run contribute-zkey');
        process.exit(1);
    }

    try {
        await testValidProofGeneration();
        await testInvalidInputs();
        await testProofStructure();
        await testPrivacyProperties();
        await testSerialization();
        await testPerformanceBenchmarks();

        // Print summary
        console.log('\n' + '='.repeat(50));
        console.log('📊 Test Summary');
        console.log('='.repeat(50));
        console.log(`✅ Passed: ${testResults.passed}`);
        console.log(`❌ Failed: ${testResults.failed}`);
        console.log(`📈 Total: ${testResults.passed + testResults.failed}`);
        console.log('='.repeat(50));

        if (testResults.failed > 0) {
            console.log('\n❌ Some tests failed. Review output above.');
            process.exit(1);
        } else {
            console.log('\n✅ All tests passed!');
            process.exit(0);
        }
    } catch (error) {
        console.error('\n❌ Test suite error:', error);
        process.exit(1);
    }
}

// Run tests
runAllTests().catch(console.error);
