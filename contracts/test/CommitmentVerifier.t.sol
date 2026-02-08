// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Test.sol";
import {Groth16Verifier} from "../CommitmentVerifier.sol";

/**
 * @title CommitmentVerifierTest
 * @notice Comprehensive tests for the ZK verifier contract
 * @dev Tests proof verification, gas costs, and edge cases
 */
contract CommitmentVerifierTest is Test {
    Groth16Verifier verifier;

    // Valid proof from build/zk/proof.json and build/zk/public.json
    // Note: Solidity doesn't support constant arrays, so we use helper functions
    
    function getValidA() internal pure returns (uint[2] memory) {
        return [
            uint256(17002299895928590336027953136176593770942021334429510429547120270983041214405),
            uint256(6947303486410269252917513017734334161671303213768473474962467883267847974646)
        ];
    }
    
    function getValidB() internal pure returns (uint[2][2] memory) {
        return [
            [
                uint256(12390606658959339806304769971768157266554196400277049355851676804197362266192),
                uint256(4324244732169176280330390811917704582606188290902304005922335301580960410951)
            ],
            [
                uint256(12533441529731975719976100092662198908364404644836821682649263654513801012771),
                uint256(3108378817970598942026255066191671615189500496142227204429162940129286092020)
            ]
        ];
    }
    
    function getValidC() internal pure returns (uint[2] memory) {
        return [
            uint256(18721720203810119944160531538871544797401199464080421565626513118012554237738),
            uint256(9712642516648492560593987944343454514029576329637114704869187502381844962718)
        ];
    }
    
    uint256 constant VALID_COMMITMENT_HASH = 15487518024730841941762307804339002357283870537119939381941957344477347729321;

    function setUp() public {
        // Deploy verifier contract
        verifier = new Groth16Verifier();
    }

    /**
     * @notice Test 1: Verify valid proof
     */
    function testVerifyProof_Valid() public view {
        uint[1] memory publicSignals = [VALID_COMMITMENT_HASH];

        bool isValid = verifier.verifyProof(getValidA(), getValidB(), getValidC(), publicSignals);
        
        assertTrue(isValid, "Proof verification should succeed");
    }

    /**
     * @notice Test 2: Verify proof with wrong commitment hash (should fail)
     */
    function testVerifyProof_InvalidHash() public view {
        uint[1] memory publicSignals = [
            uint256(9999999999999999999999999999999999999999999999999999999999999999999999999999)
        ];

        bool isValid = verifier.verifyProof(getValidA(), getValidB(), getValidC(), publicSignals);
        
        assertFalse(isValid, "Proof verification should fail with wrong hash");
    }

    /**
     * @notice Test 3: Verify proof with corrupted proof component A
     */
    function testVerifyProof_InvalidProofA() public view {
        uint[2] memory validA = getValidA();
        uint[2] memory corruptedA = [
            validA[0],
            validA[1] + 1 // Corrupt second element
        ];
        
        uint[1] memory publicSignals = [VALID_COMMITMENT_HASH];

        bool isValid = verifier.verifyProof(corruptedA, getValidB(), getValidC(), publicSignals);
        
        assertFalse(isValid, "Proof verification should fail with corrupted proof A");
    }

    /**
     * @notice Test 4: Verify proof with corrupted proof component B
     */
    function testVerifyProof_InvalidProofB() public view {
        uint[2][2] memory validB = getValidB();
        uint[2][2] memory corruptedB = [
            [validB[0][0], validB[0][1]],
            [validB[1][0] + 1, validB[1][1]] // Corrupt one element
        ];
        
        uint[1] memory publicSignals = [VALID_COMMITMENT_HASH];

        bool isValid = verifier.verifyProof(getValidA(), corruptedB, getValidC(), publicSignals);
        
        assertFalse(isValid, "Proof verification should fail with corrupted proof B");
    }

    /**
     * @notice Test 5: Verify proof with corrupted proof component C
     */
    function testVerifyProof_InvalidProofC() public view {
        uint[2] memory validC = getValidC();
        uint[2] memory corruptedC = [
            validC[0] + 1, // Corrupt first element
            validC[1]
        ];
        
        uint[1] memory publicSignals = [VALID_COMMITMENT_HASH];

        bool isValid = verifier.verifyProof(getValidA(), getValidB(), corruptedC, publicSignals);
        
        assertFalse(isValid, "Proof verification should fail with corrupted proof C");
    }

    /**
     * @notice Test 6: Measure gas costs for verification
     */
    function testGasCost_VerifyProof() public view {
        uint[1] memory publicSignals = [VALID_COMMITMENT_HASH];

        uint256 gasBefore = gasleft();
        bool isValid = verifier.verifyProof(getValidA(), getValidB(), getValidC(), publicSignals);
        uint256 gasUsed = gasBefore - gasleft();

        assertTrue(isValid, "Proof should be valid");
        
        // Log gas usage
        console.log("Gas used for verifyProof:", gasUsed);
        
        // Verify gas is within expected range (150k-250k)
        assertGe(gasUsed, 150000, "Gas should be at least 150k");
        assertLe(gasUsed, 300000, "Gas should be at most 300k (allowing some buffer)");
    }

    /**
     * @notice Test 7: Verify proof with zero values (should fail)
     */
    function testVerifyProof_ZeroValues() public view {
        uint[2] memory zeroA = [uint256(0), uint256(0)];
        uint[2][2] memory zeroB = [[uint256(0), uint256(0)], [uint256(0), uint256(0)]];
        uint[2] memory zeroC = [uint256(0), uint256(0)];
        uint[1] memory publicSignals = [VALID_COMMITMENT_HASH];

        bool isValid = verifier.verifyProof(zeroA, zeroB, zeroC, publicSignals);
        
        assertFalse(isValid, "Proof verification should fail with zero values");
    }

    /**
     * @notice Test 8: Verify proof with maximum field values (edge case)
     */
    function testVerifyProof_MaxFieldValues() public view {
        // Use values close to field size (but still valid)
        uint256 maxField = 21888242871839275222246405745257275088548364400416034343698204186575808495616;
        
        uint[2] memory maxA = [maxField - 1, maxField - 2];
        uint[2][2] memory maxB = [
            [maxField - 3, maxField - 4],
            [maxField - 5, maxField - 6]
        ];
        uint[2] memory maxC = [maxField - 7, maxField - 8];
        uint[1] memory publicSignals = [VALID_COMMITMENT_HASH];

        // This will fail because the proof is invalid, but it tests field size handling
        bool isValid = verifier.verifyProof(maxA, maxB, maxC, publicSignals);
        
        assertFalse(isValid, "Proof verification should fail with invalid max field values");
    }

    /**
     * @notice Test 9: Multiple valid verifications (stress test)
     */
    function testVerifyProof_MultipleValid() public view {
        uint[1] memory publicSignals = [VALID_COMMITMENT_HASH];

        // Verify the same proof multiple times
        for (uint256 i = 0; i < 5; i++) {
            bool isValid = verifier.verifyProof(getValidA(), getValidB(), getValidC(), publicSignals);
            assertTrue(isValid, "Proof should remain valid on repeated verification");
        }
    }

    /**
     * @notice Test 10: Verify contract matches circuit (public signal count)
     */
    function testVerifierContract_MatchesCircuit() public view {
        // The circuit has 1 public input (commitmentHash)
        // The verifier should accept exactly 1 public signal
        uint[1] memory publicSignals = [VALID_COMMITMENT_HASH];

        bool isValid = verifier.verifyProof(getValidA(), getValidB(), getValidC(), publicSignals);
        
        assertTrue(isValid, "Verifier should match circuit specification");
    }

    /**
     * @notice Test 11: Test with deployed verifier on Base Sepolia
     * @dev This test can be run with --fork-url to test against deployed contract
     * Usage: forge test --fork-url $BASE_SEPOLIA_RPC_URL --match-test testFork_DeployedVerifier -vv
     */
    function testFork_DeployedVerifier() public {
        // Base Sepolia deployed verifier address (from broadcast file)
        address deployedVerifier = 0x09F3bCe3546C3b4348E31B6E86A271c42b39672e;
        
        // Skip if not forking Base Sepolia
        if (block.chainid != 84532) {
            console.log("Skipping fork test - not on Base Sepolia (chainid:", block.chainid, ")");
            return;
        }

        Groth16Verifier forkVerifier = Groth16Verifier(deployedVerifier);
        uint[1] memory publicSignals = [VALID_COMMITMENT_HASH];

        bool isValid = forkVerifier.verifyProof(getValidA(), getValidB(), getValidC(), publicSignals);
        
        assertTrue(isValid, "Deployed verifier should verify valid proof");
    }
}
