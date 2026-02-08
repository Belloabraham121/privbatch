// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Test.sol";
import {Groth16Verifier} from "../CommitmentVerifier.sol";

contract CommitmentVerifierTest is Test {
    Groth16Verifier verifier;

    function setUp() public {
        // Deploy verifier contract
        verifier = new Groth16Verifier();
    }

    function testVerifyProof() public {
        // Load proof from generated files
        // These values are from build/zk/proof.json and build/zk/public.json
        uint[2] memory a = [
            uint256(17002299895928590336027953136176593770942021334429510429547120270983041214405),
            uint256(6947303486410269252917513017734334161671303213768473474962467883267847974646)
        ];
        
        uint[2][2] memory b = [
            [
                uint256(12390606658959339806304769971768157266554196400277049355851676804197362266192),
                uint256(4324244732169176280330390811917704582606188290902304005922335301580960410951)
            ],
            [
                uint256(12533441529731975719976100092662198908364404644836821682649263654513801012771),
                uint256(3108378817970598942026255066191671615189500496142227204429162940129286092020)
            ]
        ];
        
        uint[2] memory c = [
            uint256(18721720203810119944160531538871544797401199464080421565626513118012554237738),
            uint256(9712642516648492560593987944343454514029576329637114704869187502381844962718)
        ];
        
        uint[1] memory publicSignals = [
            uint256(15487518024730841941762307804339002357283870537119939381941957344477347729321)
        ];

        // Verify proof
        bool isValid = verifier.verifyProof(a, b, c, publicSignals);
        
        assertTrue(isValid, "Proof verification should succeed");
    }

    function testVerifyProofWithInvalidHash() public {
        // Use same proof but with wrong commitment hash
        uint[2] memory a = [
            uint256(17002299895928590336027953136176593770942021334429510429547120270983041214405),
            uint256(6947303486410269252917513017734334161671303213768473474962467883267847974646)
        ];
        
        uint[2][2] memory b = [
            [
                uint256(12390606658959339806304769971768157266554196400277049355851676804197362266192),
                uint256(4324244732169176280330390811917704582606188290902304005922335301580960410951)
            ],
            [
                uint256(12533441529731975719976100092662198908364404644836821682649263654513801012771),
                uint256(3108378817970598942026255066191671615189500496142227204429162940129286092020)
            ]
        ];
        
        uint[2] memory c = [
            uint256(18721720203810119944160531538871544797401199464080421565626513118012554237738),
            uint256(9712642516648492560593987944343454514029576329637114704869187502381844962718)
        ];
        
        // Wrong commitment hash
        uint[1] memory publicSignals = [
            uint256(9999999999999999999999999999999999999999999999999999999999999999999999999999)
        ];

        // Verify proof - should fail
        bool isValid = verifier.verifyProof(a, b, c, publicSignals);
        
        assertFalse(isValid, "Proof verification should fail with wrong hash");
    }
}
