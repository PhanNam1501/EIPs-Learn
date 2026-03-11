// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";

contract PersonalSignVerifier {
    using ECDSA for bytes32;
    using Strings for uint256;

    function verify(string memory message, bytes memory signature) public view returns (address) {
        string memory len = bytes(message).length.toString();

        // \x19 + E (0x45) + "thereum Signed Message:\n" + len + message
        bytes32 messageHash = keccak256(
            abi.encodePacked(
                "\x19Ethereum Signed Message:\n",
                len,
                message
            )
        );

        return messageHash.recover(signature);
    }
}