// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../src/PersonalSignVerifier.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";

contract PersonalSignTest is Test {
    using Strings for uint256;
    
    PersonalSignVerifier public verifier;
    uint256 internal privateKey = 0xABC; 
    address internal signer;

    function setUp() public {
        verifier = new PersonalSignVerifier();
        signer = vm.addr(privateKey);
    }

    function test_VerifyPersonalSign() public view {
        string memory message = "EIP-191 is awesome!";
        string memory len = bytes(message).length.toString();
        
        bytes32 digest = keccak256(
            abi.encodePacked(
                "\x19Ethereum Signed Message:\n",
                len,
                message
            )
        );

        (uint8 v, bytes32 r, bytes32 s) = vm.sign(privateKey, digest);
        bytes memory signature = abi.encodePacked(r, s, v);

        address recovered = verifier.verify(message, signature);
        assertEq(recovered, signer, "Signer mismatch!");
    }
}