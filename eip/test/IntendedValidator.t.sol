// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../src/IntendedValidator.sol";

contract IntendedValidatorTest is Test {
    IntendedValidator public validatorA;
    IntendedValidator public validatorB;
    
    uint256 internal signerPrivateKey;
    address internal signer;

    function setUp() public {
        validatorA = new IntendedValidator();
        validatorB = new IntendedValidator();

        signerPrivateKey = 0xA11CE; 
        signer = vm.addr(signerPrivateKey);
    }

    function test_ValidSignature() public view {
        bytes32 data = keccak256("Send 100 USD");

        bytes32 digest = keccak256(
            abi.encodePacked(
                bytes1(0x19),
                bytes1(0x00),
                address(validatorA),
                data
            )
        );

        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerPrivateKey, digest);
        bytes memory signature = abi.encodePacked(r, s, v);

        assertTrue(validatorA.isSignatureValid(signer, data, signature));
    }

    function test_ReplayAttackFailsOnDifferentContract() public view {
        bytes32 data = keccak256("Send 100 USD");

        bytes32 digestA = keccak256(
            abi.encodePacked(
                bytes1(0x19),
                bytes1(0x00),
                address(validatorA),
                data
            )
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerPrivateKey, digestA);
        bytes memory signatureForA = abi.encodePacked(r, s, v);

        bool isValidOnB = validatorB.isSignatureValid(signer, data, signatureForA);
        
        assertFalse(isValidOnB, "Signature of A is not valid on B");
    }
}