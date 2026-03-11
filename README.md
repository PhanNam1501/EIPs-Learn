# 🛡️ Ethereum Improvement Proposals (EIPs) Research Lab

This repository is a dedicated space for the experimental analysis, deep-dive research, and optimized implementation of core Ethereum standards. The primary goal is to master protocol specifications, achieve maximum performance via **Assembly (Yul)**, and cultivate a standardized security-first mindset.

---

## 🎯 Research Objectives

EIP research in this lab goes beyond reading documentation. It is a process of "dissecting" standards through three distinct layers:

1.  **Specification (Theory):** Understanding the "Why" behind the proposal—what friction in the ecosystem does it resolve?
2.  **Implementation (Practice):** Writing clean Solidity implementations, followed by refactoring into **Inline Assembly (Yul)** to optimize gas and understand data flow at the Memory/Storage level.
3.  **Verification (Security):** Building comprehensive test suites using **Foundry** to simulate attack vectors, edge cases, and signature malleability.

---

## 🗺️ Research Roadmap

The repository is categorized by the most impactful standards in the Ethereum ecosystem:

### 1. Signature & Data Standards
* **EIP-191:** Standard for Signed Data (including Version 0x00: Intended Validator).
* **EIP-712:** Type-safe structured data hashing and signing.
* **EIP-1271:** Standard Signature Validation Method for Smart Contract Wallets.

### 2. Token & Asset Standards
* **ERC-20 / ERC-721 / ERC-1155:** Foundational asset standards.
* **ERC-2612:** Permit mechanism (Gasless approvals via signatures).
* **ERC-4626:** Tokenized Vault Standard for yield-bearing assets.

### 3. Account Abstraction & Architecture
* **EIP-4337:** Account Abstraction via EntryPoint and UserOperations.
* **EIP-1967 / EIP-1167:** Proxy storage slots and Minimal Proxy (Clones) patterns.
* **EIP-2535:** Diamond Pattern for multi-faceted modular contracts.

---

## 🛠️ Tech Stack

* **Framework:** [Foundry](https://book.getfoundry.sh/) (Forge for testing, Cast for CLI interaction).
* **Language:** Solidity & Yul (Inline Assembly).
* **Libraries:** OpenZeppelin Contracts, Solady (for gas-optimized patterns).
* **Environment:** WSL (Ubuntu) on Windows / Linux.

---

## 📝 Developer Logs & Insights

> [!NOTE]
> **Low-level Philosophy:** This project prioritizes bitwise operations and manual memory management over high-level abstractions to ensure a deep understanding of the EVM (Ethereum Virtual Machine).

> [!IMPORTANT]
> **Security First:** Every implementation involving signatures and permissions includes a detailed analysis of classic vulnerabilities, such as **Replay Attacks** and **Signature Malleability**.

---

## 🚀 How to Research a New EIP

1.  Analyze the original specification at [eips.ethereum.org](https://eips.ethereum.org/).
2.  Create a dedicated directory in `src/` (e.g., `src/EIP191/`).
3.  Draft a **Naive Implementation** (Readable Solidity).
4.  Refactor into an **Optimized Version** (Assembly/Yul).
5.  Validate logic with `forge test -vvv` covering all edge cases.

---
*This lab is under active development, constantly evolving with the latest discussions from the Ethereum Magicians community.*
