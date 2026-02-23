// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import "@openzeppelin/contracts/utils/Strings.sol";

/**
 * @title SignatureDemo — All 3 Ethereum Signing Methods
 *
 * Type 1: Transaction (RLP)        → Built into EVM, msg.sender is the recovered signer
 * Type 2: Personal Sign (ERC-191)  → "\x19Ethereum Signed Message:\n" prefix
 * Type 3: EIP-712 Typed Data       → "\x19\x01" + domainSeparator + hashStruct
 *
 * First byte distinguishes all three:
 *   Transaction:    0xc0–0xf9 (RLP range)
 *   Personal Sign:  0x19 then 0x45 ('E')
 *   EIP-712:        0x19 then 0x01
 */
contract SignatureDemo is EIP712 {
    using ECDSA for bytes32;

    // ══════════════════════════════════════════════════════════
    //  TYPE 1: Transaction Signing (RLP)
    // ══════════════════════════════════════════════════════════

    // The EVM automatically verifies transaction signatures.
    // msg.sender IS the recovered signer — no custom code needed.
    // We expose ecrecover for educational purposes only.

    mapping(address => uint256) public txNonces;

    event TransactionExecuted(address indexed signer, uint256 nonce, uint256 value);

    /**
     * @notice Demonstrate that msg.sender = verified signer of the transaction.
     *         The EVM does RLP decode → keccak256 → ecrecover internally.
     */
    function executeTransaction() external payable {
        uint256 nonce = txNonces[msg.sender]++;
        emit TransactionExecuted(msg.sender, nonce, msg.value);
    }

    /**
     * @notice Manual ecrecover — shows what the EVM does under the hood.
     * @param txHash  keccak256 of RLP-encoded unsigned transaction
     * @param v       Recovery id (27/28, or chainId*2 + 35/36 per EIP-155)
     * @param r       First 32 bytes of ECDSA signature
     * @param s       Second 32 bytes of ECDSA signature
     */
    function recoverTxSigner(
        bytes32 txHash,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external pure returns (address) {
        address signer = ecrecover(txHash, v, r, s);
        require(signer != address(0), "Invalid tx signature");
        return signer;
    }

    // ══════════════════════════════════════════════════════════
    //  TYPE 2: Personal Sign (ERC-191)
    // ══════════════════════════════════════════════════════════

    mapping(address => bool) public personalSignVerified;

    event PersonalSignVerified(address indexed signer, string message);

    /**
     * @notice Verify a personal_sign signature (MetaMask "Sign Message").
     *
     * @dev Signed payload:
     *      keccak256("\x19Ethereum Signed Message:\n" + len(message) + message)
     *
     *      First byte = 0x19, second byte = 0x45 ('E')
     *      This distinguishes it from transactions (0xc0-0xf9) and EIP-712 (0x19 0x01).
     */
    function verifyPersonalSign(
        string calldata message,
        bytes calldata signature
    ) external returns (address signer) {
        // Step 1: Hash the raw message
        bytes32 messageHash = keccak256(abi.encodePacked(message));

        // Step 2: Apply ERC-191 prefix
        //         "\x19Ethereum Signed Message:\n32" + messageHash
        bytes32 ethSignedHash = MessageHashUtils.toEthSignedMessageHash(messageHash);

        // Step 3: Recover signer via ECDSA
        signer = ECDSA.recover(ethSignedHash, signature);

        personalSignVerified[signer] = true;
        emit PersonalSignVerified(signer, message);
    }

    /**
     * @notice View-only verification (no state change)
     */
    function verifyPersonalSignView(
        string calldata message,
        bytes calldata signature
    ) external pure returns (address signer) {
        bytes32 messageHash = keccak256(abi.encodePacked(message));
        bytes32 ethSignedHash = MessageHashUtils.toEthSignedMessageHash(messageHash);
        signer = ECDSA.recover(ethSignedHash, signature);
    }

    // ══════════════════════════════════════════════════════════
    //  TYPE 3: EIP-712 Typed Structured Data
    // ══════════════════════════════════════════════════════════

    // --- Struct: the structured data users will sign ---
    struct MinePermit {
        address miner;      // Who is authorized
        uint256 agentId;    // Which agent NFT
        uint256 nonce;      // Replay protection
        uint256 deadline;   // Expiration timestamp
    }

    // --- Type hash: compile-time constant ---
    bytes32 public constant MINE_PERMIT_TYPEHASH = keccak256(
        "MinePermit(address miner,uint256 agentId,uint256 nonce,uint256 deadline)"
    );

    mapping(address => uint256) public eip712Nonces;
    mapping(address => bool) public eip712Authorized;

    event EIP712Authorized(address indexed signer, uint256 agentId, uint256 nonce);

    /**
     * @notice Authorize a miner via EIP-712 signed permit (gasless meta-tx pattern).
     *
     * @dev Signed payload:
     *      keccak256("\x19\x01" + domainSeparator + hashStruct(MinePermit))
     *
     *      First byte = 0x19, second byte = 0x01
     *      Anyone can submit this on-chain (relayer pattern).
     *
     *      hashStruct(permit) = keccak256(
     *          MINE_PERMIT_TYPEHASH,
     *          permit.miner,
     *          permit.agentId,
     *          permit.nonce,
     *          permit.deadline
     *      )
     */
    function authorizeWithPermit(
        MinePermit calldata permit,
        bytes calldata signature
    ) external {
        // Validate permit
        require(block.timestamp <= permit.deadline, "Permit expired");
        require(permit.nonce == eip712Nonces[permit.miner], "Invalid nonce");

        // Compute struct hash
        bytes32 structHash = keccak256(abi.encode(
            MINE_PERMIT_TYPEHASH,
            permit.miner,
            permit.agentId,
            permit.nonce,
            permit.deadline
        ));

        // Compute EIP-712 digest:
        // keccak256("\x19\x01" + domainSeparator + structHash)
        bytes32 digest = _hashTypedDataV4(structHash);

        // Recover and verify signer
        address signer = ECDSA.recover(digest, signature);
        require(signer == permit.miner, "Invalid EIP712 signature");

        // Execute
        eip712Nonces[permit.miner]++;
        eip712Authorized[permit.miner] = true;

        emit EIP712Authorized(signer, permit.agentId, permit.nonce);
    }

    /**
     * @notice View-only EIP-712 verification
     */
    function verifyEIP712View(
        MinePermit calldata permit,
        bytes calldata signature
    ) external view returns (address signer, bool valid) {
        bytes32 structHash = keccak256(abi.encode(
            MINE_PERMIT_TYPEHASH,
            permit.miner,
            permit.agentId,
            permit.nonce,
            permit.deadline
        ));

        bytes32 digest = _hashTypedDataV4(structHash);
        signer = ECDSA.recover(digest, signature);
        valid = (signer == permit.miner && block.timestamp <= permit.deadline);
    }

    // ══════════════════════════════════════════════════════════
    //  HELPERS — Expose internals for testing/learning
    // ══════════════════════════════════════════════════════════

    constructor() EIP712("SignatureDemo", "1") {}

    /// @notice Returns the EIP-712 domain separator
    function getDomainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    /// @notice Returns the full EIP-712 digest for a permit
    function getDigest(MinePermit calldata permit) external view returns (bytes32) {
        bytes32 structHash = keccak256(abi.encode(
            MINE_PERMIT_TYPEHASH,
            permit.miner,
            permit.agentId,
            permit.nonce,
            permit.deadline
        ));
        return _hashTypedDataV4(structHash);
    }

    /// @notice Returns just the struct hash (without domain separator)
    function getStructHash(MinePermit calldata permit) external pure returns (bytes32) {
        return keccak256(abi.encode(
            MINE_PERMIT_TYPEHASH,
            permit.miner,
            permit.agentId,
            permit.nonce,
            permit.deadline
        ));
    }
}
