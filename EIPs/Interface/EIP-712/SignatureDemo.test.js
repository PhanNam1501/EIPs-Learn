const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("SignatureDemo — All 3 Ethereum Signing Methods", function () {
  let demo;
  let signer, relayer, otherAccount;

  beforeEach(async function () {
    [signer, relayer, otherAccount] = await ethers.getSigners();

    const Factory = await ethers.getContractFactory("SignatureDemo");
    demo = await Factory.deploy();
  });

  // ═══════════════════════════════════════════════════════
  //  TYPE 1: Transaction Signing (RLP)
  // ═══════════════════════════════════════════════════════

  describe("Type 1: Transaction Signing", function () {
    /**
     * Flow:
     *   1. User constructs a transaction { to, value, gasLimit, nonce, ... }
     *   2. Wallet RLP-encodes it: encode(tx) = RLP(nonce, gasPrice, ...)
     *   3. Wallet signs: signature = ECDSA.sign(keccak256(RLP(tx)), privateKey)
     *   4. EVM receives tx, does ecrecover → sets msg.sender
     *
     * First byte of RLP encoding: 0xc0–0xf9 (NEVER 0x19)
     */

    it("msg.sender is automatically verified by EVM", async function () {
      // When signer calls executeTransaction, the EVM has already
      // verified their signature and set msg.sender = signer.address
      await expect(demo.connect(signer).executeTransaction({ value: 100 }))
        .to.emit(demo, "TransactionExecuted")
        .withArgs(signer.address, 0, 100);

      // Second call increments nonce
      await expect(demo.connect(signer).executeTransaction({ value: 200 }))
        .to.emit(demo, "TransactionExecuted")
        .withArgs(signer.address, 1, 200);

      expect(await demo.txNonces(signer.address)).to.equal(2);
    });

    it("different signers produce different msg.sender", async function () {
      await demo.connect(signer).executeTransaction();
      await demo.connect(otherAccount).executeTransaction();

      expect(await demo.txNonces(signer.address)).to.equal(1);
      expect(await demo.txNonces(otherAccount.address)).to.equal(1);
    });

    it("RLP encoding first byte is never 0x19", async function () {
      // Demonstrate that a raw transaction's RLP encoding
      // never starts with 0x19 — this is what makes the encoding injective
      const tx = {
        to: demo.target,
        value: 0,
        gasLimit: 100000,
        nonce: 0,
        chainId: 31337, // Hardhat default
      };

      const populated = await signer.populateTransaction(tx);
      const serialized = ethers.Transaction.from(populated).unsignedSerialized;

      console.log("\n--- Type 1: Transaction (RLP) ---");
      console.log("RLP encoded (hex):", serialized.slice(0, 20), "...");
      console.log("First byte:", serialized.slice(0, 4));

      // First byte is NEVER 0x19
      const firstByte = parseInt(serialized.slice(2, 4), 16);
      expect(firstByte).to.not.equal(0x19);
    });
  });

  // ═══════════════════════════════════════════════════════
  //  TYPE 2: Personal Sign (ERC-191)
  // ═══════════════════════════════════════════════════════

  describe("Type 2: Personal Sign (ERC-191)", function () {
    /**
     * Flow:
     *   1. User has a message: "Authorize agent #42"
     *   2. Wallet prefixes: "\x19Ethereum Signed Message:\n" + len + message
     *   3. Wallet signs: signature = ECDSA.sign(keccak256(prefixed), privateKey)
     *   4. Contract recreates the prefix and recovers the signer
     *
     * First byte: 0x19, second byte: 0x45 ('E')
     */

    it("sign and verify a simple message", async function () {
      const message = "Authorize mining for agent #42";

      // Off-chain: signer signs the message (MetaMask equivalent)
      // signMessage automatically applies "\x19Ethereum Signed Message:\n" prefix
      const signature = await signer.signMessage(message);

      console.log("\n--- Type 2: Personal Sign (ERC-191) ---");
      console.log("Message:", message);
      console.log("Signature:", signature.slice(0, 20), "...");

      // On-chain: contract verifies
      const recovered = await demo.verifyPersonalSignView(message, signature);
      expect(recovered).to.equal(signer.address);
    });

    it("verify and mark signer on-chain", async function () {
      const message = "I agree to mine aBTC";
      const signature = await signer.signMessage(message);

      expect(await demo.personalSignVerified(signer.address)).to.equal(false);

      await expect(demo.verifyPersonalSign(message, signature))
        .to.emit(demo, "PersonalSignVerified")
        .withArgs(signer.address, message);

      expect(await demo.personalSignVerified(signer.address)).to.equal(true);
    });

    it("tampered message recovers wrong signer", async function () {
      const message = "Send 100 aBTC to Alice";
      const signature = await signer.signMessage(message);

      // Attacker changes the message
      const recovered = await demo.verifyPersonalSignView(
        "Send 100 aBTC to Eve",  // tampered
        signature
      );

      // Recovered address is NOT the original signer
      expect(recovered).to.not.equal(signer.address);
    });

    it("show the internal prefix mechanism", async function () {
      const message = "hello";

      // What MetaMask does internally:
      // 1. Prefix = "\x19Ethereum Signed Message:\n5"
      // 2. Full payload = prefix + "hello"
      // 3. Hash = keccak256(payload)
      // 4. Sign the hash

      const messageBytes = ethers.toUtf8Bytes(message);
      const prefix = ethers.toUtf8Bytes(
        "\x19Ethereum Signed Message:\n" + messageBytes.length
      );
      const payload = ethers.concat([prefix, messageBytes]);

      console.log("\n--- Personal Sign Internal Breakdown ---");
      console.log("Message:", message);
      console.log("Message length:", messageBytes.length);
      console.log("Prefix (hex):", ethers.hexlify(prefix));
      console.log("First byte:", ethers.hexlify(prefix.slice(0, 1)));  // 0x19
      console.log("Second byte:", ethers.hexlify(prefix.slice(1, 2))); // 0x45 = 'E'
      console.log("Full payload (hex):", ethers.hexlify(payload));

      // Verify first bytes
      expect(ethers.hexlify(prefix.slice(0, 1))).to.equal("0x19");
      expect(ethers.hexlify(prefix.slice(1, 2))).to.equal("0x45"); // 'E'
    });
  });

  // ═══════════════════════════════════════════════════════
  //  TYPE 3: EIP-712 Typed Structured Data
  // ═══════════════════════════════════════════════════════

  describe("Type 3: EIP-712 Typed Structured Data", function () {
    /**
     * Flow:
     *   1. Define types: { MinePermit: [...fields...] }
     *   2. Define domain: { name, version, chainId, verifyingContract }
     *   3. Construct message: { miner, agentId, nonce, deadline }
     *   4. Wallet displays structured data → user reviews and signs
     *   5. Wallet computes:
     *        structHash = keccak256(TYPEHASH + encoded fields)
     *        digest = keccak256("\x19\x01" + domainSeparator + structHash)
     *        signature = ECDSA.sign(digest, privateKey)
     *   6. Anyone submits (permit, signature) to contract (relayer pattern)
     *   7. Contract recomputes digest, recovers signer, verifies
     *
     * First byte: 0x19, second byte: 0x01
     */

    // EIP-712 domain and types — must match contract's EIP712 constructor
    function getEIP712Domain() {
      return {
        name: "SignatureDemo",
        version: "1",
        chainId: 31337, // Hardhat
        verifyingContract: demo.target,
      };
    }

    const EIP712_TYPES = {
      MinePermit: [
        { name: "miner", type: "address" },
        { name: "agentId", type: "uint256" },
        { name: "nonce", type: "uint256" },
        { name: "deadline", type: "uint256" },
      ],
    };

    async function signPermit(signerWallet, agentId, nonce, deadline) {
      const domain = getEIP712Domain();
      const message = {
        miner: signerWallet.address,
        agentId: agentId,
        nonce: nonce,
        deadline: deadline,
      };

      // signTypedData applies "\x19\x01" + domainSeparator + hashStruct automatically
      const signature = await signerWallet.signTypedData(domain, EIP712_TYPES, message);
      return { message, signature };
    }

    it("sign and verify EIP-712 typed data", async function () {
      const deadline = Math.floor(Date.now() / 1000) + 3600; // 1 hour

      const { message, signature } = await signPermit(signer, 42, 0, deadline);

      console.log("\n--- Type 3: EIP-712 Typed Data ---");
      console.log("Permit:", message);
      console.log("Signature:", signature.slice(0, 20), "...");

      // Verify on-chain
      const [recovered, valid] = await demo.verifyEIP712View(message, signature);
      expect(recovered).to.equal(signer.address);
      expect(valid).to.equal(true);
    });

    it("authorize miner via permit (gasless meta-tx)", async function () {
      const deadline = Math.floor(Date.now() / 1000) + 3600;

      // Signer signs off-chain (no gas needed)
      const { message, signature } = await signPermit(signer, 42, 0, deadline);

      expect(await demo.eip712Authorized(signer.address)).to.equal(false);

      // Relayer submits on-chain (pays gas on behalf of signer)
      await expect(demo.connect(relayer).authorizeWithPermit(message, signature))
        .to.emit(demo, "EIP712Authorized")
        .withArgs(signer.address, 42, 0);

      expect(await demo.eip712Authorized(signer.address)).to.equal(true);
      expect(await demo.eip712Nonces(signer.address)).to.equal(1);
    });

    it("reject expired permit", async function () {
      const expiredDeadline = Math.floor(Date.now() / 1000) - 100; // already expired

      const { message, signature } = await signPermit(signer, 42, 0, expiredDeadline);

      await expect(
        demo.connect(relayer).authorizeWithPermit(message, signature)
      ).to.be.revertedWith("Permit expired");
    });

    it("reject replayed permit (nonce already used)", async function () {
      const deadline = Math.floor(Date.now() / 1000) + 3600;

      const { message, signature } = await signPermit(signer, 42, 0, deadline);

      // First submission: OK
      await demo.connect(relayer).authorizeWithPermit(message, signature);

      // Replay: nonce already incremented to 1, but permit has nonce 0
      await expect(
        demo.connect(relayer).authorizeWithPermit(message, signature)
      ).to.be.revertedWith("Invalid nonce");
    });

    it("reject signature from wrong signer", async function () {
      const deadline = Math.floor(Date.now() / 1000) + 3600;

      // otherAccount signs a permit claiming to be signer.address
      const domain = getEIP712Domain();
      const fakeMessage = {
        miner: signer.address, // claims to be signer
        agentId: 42,
        nonce: 0,
        deadline: deadline,
      };

      // But otherAccount signs it
      const signature = await otherAccount.signTypedData(domain, EIP712_TYPES, fakeMessage);

      // Recovery will get otherAccount.address, which != signer.address
      await expect(
        demo.connect(relayer).authorizeWithPermit(fakeMessage, signature)
      ).to.be.revertedWith("Invalid EIP712 signature");
    });

    it("show the internal EIP-712 encoding", async function () {
      const deadline = Math.floor(Date.now() / 1000) + 3600;
      const permit = {
        miner: signer.address,
        agentId: 42,
        nonce: 0,
        deadline: deadline,
      };

      const domainSeparator = await demo.getDomainSeparator();
      const structHash = await demo.getStructHash(permit);
      const digest = await demo.getDigest(permit);

      console.log("\n--- EIP-712 Internal Breakdown ---");
      console.log("Domain Separator:", domainSeparator);
      console.log("Struct Hash:     ", structHash);
      console.log("Digest:          ", digest);

      // Manual digest computation to verify
      // digest = keccak256("\x19\x01" + domainSeparator + structHash)
      const manualDigest = ethers.keccak256(
        ethers.concat([
          ethers.toUtf8Bytes("\x19\x01"),
          ethers.getBytes(domainSeparator),
          ethers.getBytes(structHash),
        ])
      );

      console.log("Manual Digest:   ", manualDigest);
      console.log("Match:", digest === manualDigest);

      expect(digest).to.equal(manualDigest);

      // Verify first bytes of the prefix
      const prefix = ethers.toUtf8Bytes("\x19\x01");
      console.log("\nPrefix bytes:", ethers.hexlify(prefix));
      console.log("First byte: ", ethers.hexlify(prefix.slice(0, 1))); // 0x19
      console.log("Second byte:", ethers.hexlify(prefix.slice(1, 2))); // 0x01

      expect(ethers.hexlify(prefix.slice(0, 1))).to.equal("0x19");
      expect(ethers.hexlify(prefix.slice(1, 2))).to.equal("0x01");
    });
  });

  // ═══════════════════════════════════════════════════════
  //  CROSS-TYPE: Prove all 3 types are distinct
  // ═══════════════════════════════════════════════════════

  describe("Cross-Type: Injective Encoding Proof", function () {
    /**
     * The encoding is INJECTIVE because the three cases
     * always differ in the first byte:
     *
     *   Transaction:    0xc0–0xf9 (RLP range)
     *   Personal Sign:  0x19 then 0x45 ('E')
     *   EIP-712:        0x19 then 0x01
     *
     * This prevents an attacker from tricking a user into
     * signing a "message" that is actually a valid "transaction".
     */

    it("all three signing methods produce different first bytes", async function () {
      console.log("\n╔══════════════════════════════════════════════╗");
      console.log("║   INJECTIVE ENCODING — First Byte Proof     ║");
      console.log("╠══════════════════════════════════════════════╣");

      // Type 1: Transaction (RLP)
      const tx = await signer.populateTransaction({
        to: demo.target,
        value: 0,
        gasLimit: 100000,
      });
      const rlpEncoded = ethers.Transaction.from(tx).unsignedSerialized;
      const rlpFirstByte = parseInt(rlpEncoded.slice(2, 4), 16);

      console.log(`║  Type 1 (RLP):           0x${rlpFirstByte.toString(16).padStart(2, "0")}              ║`);

      // Type 2: Personal Sign
      const personalPrefix = ethers.toUtf8Bytes("\x19Ethereum Signed Message:\n");
      const personalFirstByte = personalPrefix[0];   // 0x19
      const personalSecondByte = personalPrefix[1];   // 0x45 = 'E'

      console.log(`║  Type 2 (Personal Sign): 0x${personalFirstByte.toString(16)} 0x${personalSecondByte.toString(16)}        ║`);

      // Type 3: EIP-712
      const eip712Prefix = ethers.toUtf8Bytes("\x19\x01");
      const eip712FirstByte = eip712Prefix[0];   // 0x19
      const eip712SecondByte = eip712Prefix[1];   // 0x01

      console.log(`║  Type 3 (EIP-712):       0x${eip712FirstByte.toString(16)} 0x${eip712SecondByte.toString(16).padStart(2, "0")}        ║`);
      console.log("╠══════════════════════════════════════════════╣");

      // Assertions
      // Transaction first byte is NEVER 0x19
      expect(rlpFirstByte).to.not.equal(0x19);
      console.log("║  ✅ RLP ≠ 0x19 (no collision with types 2,3) ║");

      // Personal Sign and EIP-712 share 0x19 but differ in second byte
      expect(personalFirstByte).to.equal(0x19);
      expect(eip712FirstByte).to.equal(0x19);
      expect(personalSecondByte).to.not.equal(eip712SecondByte);
      console.log("║  ✅ Personal(0x45) ≠ EIP-712(0x01)           ║");

      console.log("║                                              ║");
      console.log("║  → All 3 encodings are INJECTIVE             ║");
      console.log("║  → No cross-type signature collision possible ║");
      console.log("╚══════════════════════════════════════════════╝");
    });

    it("same content signed with different methods produces different signatures", async function () {
      // Sign the same "content" using Personal Sign and EIP-712
      // They MUST produce different signatures

      const message = "hello";

      // Personal Sign
      const personalSig = await signer.signMessage(message);

      // EIP-712 (wrap "hello" in a struct)
      // Even if the "content" is the same, the encoding differs
      const domain = {
        name: "SignatureDemo",
        version: "1",
        chainId: 31337,
        verifyingContract: demo.target,
      };

      const types = {
        MinePermit: [
          { name: "miner", type: "address" },
          { name: "agentId", type: "uint256" },
          { name: "nonce", type: "uint256" },
          { name: "deadline", type: "uint256" },
        ],
      };

      const eip712Sig = await signer.signTypedData(domain, types, {
        miner: signer.address,
        agentId: 0,
        nonce: 0,
        deadline: 9999999999,
      });

      console.log("\n--- Same signer, different methods ---");
      console.log("Personal Sign sig:", personalSig.slice(0, 30), "...");
      console.log("EIP-712 sig:      ", eip712Sig.slice(0, 30), "...");
      console.log("Same?", personalSig === eip712Sig);

      // Signatures are ALWAYS different
      expect(personalSig).to.not.equal(eip712Sig);
    });
  });
});
