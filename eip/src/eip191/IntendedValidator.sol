// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

contract IntendedValidator {
    using ECDSA for bytes32;

    function isSignatureValid(
        address signer,
        bytes32 data,
        bytes memory signature
    ) public view returns (bool) {
        bytes32 digest = keccak256(
            abi.encodePacked(
                bytes1(0x19),
                bytes1(0x00),
                address(this),
                data
            )
        );

        return digest.recover(signature) == signer;
    }
}