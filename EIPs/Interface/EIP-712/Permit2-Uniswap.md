# Permit2 trong Uniswap V4 — Hướng dẫn toàn diện

## 1. Tổng quan

### 1.1 Permit2 là gì?

Permit2 là smart contract của Uniswap giúp **chuẩn hóa token approvals** cho mọi ERC-20 token. Thay vì mỗi dApp yêu cầu 1 lần approve riêng, user chỉ cần approve Permit2 **một lần duy nhất** cho mỗi token, sau đó mọi dApp tích hợp Permit2 đều có thể dùng chung approval đó thông qua **EIP-712 signatures**.

```
╔═══════════════════════════════════════════════════════════════╗
║                     TRUYỀN THỐNG (approve)                   ║
╠═══════════════════════════════════════════════════════════════╣
║                                                               ║
║  User ──approve()──► Uniswap     (tx #1, tốn gas)           ║
║  User ──approve()──► Aave        (tx #2, tốn gas)           ║
║  User ──approve()──► 1inch       (tx #3, tốn gas)           ║
║  User ──approve()──► Curve       (tx #4, tốn gas)           ║
║                                                               ║
║  → Mỗi dApp cần 1 approve tx riêng → N dApps = N tx         ║
╚═══════════════════════════════════════════════════════════════╝

╔═══════════════════════════════════════════════════════════════╗
║                     PERMIT2 (signature)                       ║
╠═══════════════════════════════════════════════════════════════╣
║                                                               ║
║  User ──approve()──► Permit2     (1 lần duy nhất, tốn gas)  ║
║                                                               ║
║  User ──sign()────► Uniswap     (off-chain, FREE)            ║
║  User ──sign()────► Aave        (off-chain, FREE)            ║
║  User ──sign()────► 1inch       (off-chain, FREE)            ║
║  User ──sign()────► Curve       (off-chain, FREE)            ║
║                                                               ║
║  → 1 approve + N signatures = 1 tx + 0 gas cho mỗi dApp     ║
╚═══════════════════════════════════════════════════════════════╝
```

### 1.2 Permit2 trong Uniswap V4

Uniswap V4 dùng **Universal Router** làm entrypoint chính cho swap. Universal Router tích hợp Permit2, nghĩa là:

```
User → approve(Permit2) → sign(EIP-712) → Universal Router → PoolManager → V4 Pool
```

### 1.3 Địa chỉ Permit2

Permit2 được deploy bằng CREATE2, nên có **cùng 1 địa chỉ trên tất cả chains**:

```
PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3
```

---

## 2. Hai chế độ hoạt động của Permit2

Permit2 gồm 2 contract con:

### 2.1 AllowanceTransfer — Cho phép transfer nhiều lần

```
User ──permit()──► Permit2 lưu allowance (amount, expiry, nonce)
                   │
                   ├── Spender gọi transferFrom() lần 1 ✅
                   ├── Spender gọi transferFrom() lần 2 ✅ (nếu còn allowance)
                   └── Hết hạn hoặc hết amount → ❌
```

**Dùng khi:** dApp cần transfer token từ user **thường xuyên** (DEX, lending).

**Interface chính:**

```solidity
// User ký EIP-712 → dApp gọi permit() để set allowance trong Permit2
function permit(
    address owner,
    PermitSingle calldata permitSingle,
    bytes calldata signature
) external;

// dApp gọi transferFrom() để kéo token từ user (dùng allowance đã set)
function transferFrom(
    address from,
    address to,
    uint160 amount,
    address token
) external;
```

**Structs:**

```solidity
struct PermitSingle {
    PermitDetails details;
    address spender;      // Contract được phép transfer
    uint256 sigDeadline;  // Signature hết hạn lúc nào
}

struct PermitDetails {
    address token;        // Token address
    uint160 amount;       // Allowance amount
    uint48 expiration;    // Allowance hết hạn lúc nào
    uint48 nonce;         // Replay protection
}
```

### 2.2 SignatureTransfer — Transfer 1 lần duy nhất

```
User ──sign()──► dApp gọi permitTransferFrom() ──► token chuyển ngay
                 │
                 └── Signature bị "tiêu" → không thể dùng lại
```

**Dùng khi:** chỉ cần transfer **một lần** (OTC swap, payment). Gas hiệu quả hơn vì ít state update.

**Interface chính:**

```solidity
// User ký EIP-712 → dApp gọi permitTransferFrom() → token chuyển trong 1 tx
function permitTransferFrom(
    PermitTransferFrom calldata permit,
    SignatureTransferDetails calldata transferDetails,
    address owner,
    bytes calldata signature
) external;
```

**Structs:**

```solidity
struct PermitTransferFrom {
    TokenPermissions permitted;  // Token + max amount
    uint256 nonce;               // Unique nonce (bitmap-based, unordered)
    uint256 deadline;            // Signature expiry
}

struct TokenPermissions {
    address token;
    uint256 amount;
}

struct SignatureTransferDetails {
    address to;           // Recipient
    uint256 requestedAmount;  // Actual amount (≤ permitted.amount)
}
```

### 2.3 So sánh

| | AllowanceTransfer | SignatureTransfer |
|---|---|---|
| **Số lần transfer** | Nhiều lần (đến khi hết allowance) | 1 lần duy nhất |
| **State storage** | Lưu allowance on-chain | Chỉ flip nonce bit |
| **Gas** | Cao hơn (SSTORE) | Thấp hơn |
| **Hanging approvals** | Có (nhưng có expiry) | Không bao giờ |
| **Dùng cho** | DEX swap, lending | Payment, OTC |
| **Uniswap V4 dùng** | ✅ AllowanceTransfer | ❌ |

---

## 3. Tích hợp Permit2 vào Contract (Solidity)

### 3.1 Setup

```bash
# Foundry
forge install uniswap/permit2
forge install uniswap/universal-router
forge install uniswap/v4-core
forge install uniswap/v4-periphery

# remappings.txt
@uniswap/permit2/=lib/permit2/
@uniswap/universal-router/=lib/universal-router/
@uniswap/v4-core/=lib/v4-core/
@uniswap/v4-periphery/=lib/v4-periphery/
```

### 3.2 Contract tích hợp AllowanceTransfer

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IPermit2, IAllowanceTransfer} from "permit2/src/interfaces/IPermit2.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title Permit2Vault — Demo tích hợp Permit2 AllowanceTransfer
 * @notice User deposit token vào vault qua Permit2 thay vì approve trực tiếp.
 */
contract Permit2Vault {
    IPermit2 public immutable permit2;

    // User balances trong vault
    mapping(address => mapping(address => uint256)) public balances;

    event Deposited(address indexed user, address indexed token, uint256 amount);
    event Withdrawn(address indexed user, address indexed token, uint256 amount);

    constructor(address _permit2) {
        permit2 = IPermit2(_permit2);
    }

    // ══════════════════════════════════════════════════════════
    //  DEPOSIT VỚI PERMIT2 (AllowanceTransfer)
    // ══════════════════════════════════════════════════════════

    /**
     * @notice Deposit token bằng Permit2 signature.
     *         User ký EIP-712 off-chain → gọi hàm này → token chuyển vào vault.
     *
     * Flow:
     *   1. User đã approve(Permit2, maxUint) cho token (1 lần duy nhất)
     *   2. Frontend tạo PermitSingle + ký EIP-712
     *   3. User gọi depositWithPermit(permitSingle, signature, amount)
     *   4. Contract gọi permit2.permit() để set allowance
     *   5. Contract gọi permit2.transferFrom() để kéo token
     *
     * @param permitSingle  EIP-712 signed permit data
     * @param signature     User's EIP-712 signature (65 bytes)
     * @param amount        Amount to deposit
     */
    function depositWithPermit(
        IAllowanceTransfer.PermitSingle calldata permitSingle,
        bytes calldata signature,
        uint160 amount
    ) external {
        address token = permitSingle.details.token;

        // Step 1: Submit the permit signature to Permit2
        //         This sets: Permit2.allowance[user][token][vault] = {amount, expiry}
        permit2.permit(msg.sender, permitSingle, signature);

        // Step 2: Transfer tokens from user to vault via Permit2
        //         Permit2 calls token.transferFrom(user, vault, amount) using the allowance
        permit2.transferFrom(
            msg.sender,         // from
            address(this),      // to
            amount,             // amount
            token               // token
        );

        // Step 3: Credit user's vault balance
        balances[msg.sender][token] += amount;

        emit Deposited(msg.sender, token, amount);
    }

    /**
     * @notice Deposit nếu user đã set allowance trên Permit2 trước đó.
     *         Không cần signature — chỉ dùng allowance đã có.
     */
    function depositWithExistingAllowance(
        address token,
        uint160 amount
    ) external {
        // Permit2 checks: allowance[user][token][vault] >= amount && not expired
        permit2.transferFrom(
            msg.sender,
            address(this),
            amount,
            token
        );

        balances[msg.sender][token] += amount;
        emit Deposited(msg.sender, token, amount);
    }

    // ══════════════════════════════════════════════════════════
    //  WITHDRAW (không liên quan Permit2)
    // ══════════════════════════════════════════════════════════

    function withdraw(address token, uint256 amount) external {
        require(balances[msg.sender][token] >= amount, "Insufficient balance");
        balances[msg.sender][token] -= amount;
        IERC20(token).transfer(msg.sender, amount);
        emit Withdrawn(msg.sender, token, amount);
    }
}
```

### 3.3 Contract tích hợp SignatureTransfer

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IPermit2, ISignatureTransfer} from "permit2/src/interfaces/IPermit2.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title Permit2Payment — Demo tích hợp Permit2 SignatureTransfer
 * @notice Dùng cho one-time payments — signature chỉ dùng 1 lần.
 */
contract Permit2Payment {
    IPermit2 public immutable permit2;

    event PaymentReceived(
        address indexed from,
        address indexed to,
        address indexed token,
        uint256 amount
    );

    constructor(address _permit2) {
        permit2 = IPermit2(_permit2);
    }

    /**
     * @notice Nhận payment từ user qua Permit2 SignatureTransfer.
     *         Signature chỉ dùng được 1 lần — nonce tự invalidate.
     *
     * @param permit     Permit data (token, amount, nonce, deadline)
     * @param signature  User's EIP-712 signature
     * @param to         Recipient address
     * @param amount     Amount to transfer (≤ permit.permitted.amount)
     */
    function pay(
        ISignatureTransfer.PermitTransferFrom calldata permit,
        bytes calldata signature,
        address to,
        uint256 amount
    ) external {
        // Transfer tokens directly — no allowance needed
        // Permit2 verifies signature + flips nonce bit → can't reuse
        permit2.permitTransferFrom(
            permit,
            ISignatureTransfer.SignatureTransferDetails({
                to: to,
                requestedAmount: amount
            }),
            msg.sender,  // token owner
            signature
        );

        emit PaymentReceived(msg.sender, to, permit.permitted.token, amount);
    }
}
```

---

## 4. Uniswap V4 Swap với Permit2 (Solidity)

### 4.1 Full Contract

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {UniversalRouter} from "@uniswap/universal-router/contracts/UniversalRouter.sol";
import {Commands} from "@uniswap/universal-router/contracts/libraries/Commands.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IV4Router} from "@uniswap/v4-periphery/src/interfaces/IV4Router.sol";
import {Actions} from "@uniswap/v4-periphery/src/libraries/Actions.sol";
import {IPermit2} from "@uniswap/permit2/src/interfaces/IPermit2.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";

/**
 * @title UniswapV4Swapper — Swap trên V4 qua Universal Router + Permit2
 *
 * Flow:
 *   1. User approve(USDC, Permit2, maxUint)          — 1 lần duy nhất
 *   2. Contract gọi permit2.approve(USDC, Router)    — set sub-allowance
 *   3. Contract gọi router.execute(V4_SWAP, ...)     — thực hiện swap
 *   4. Universal Router → PoolManager → V4 Pool       — swap xảy ra
 */
contract UniswapV4Swapper {
    UniversalRouter public immutable router;
    IPoolManager public immutable poolManager;
    IPermit2 public immutable permit2;

    constructor(address _router, address _poolManager, address _permit2) {
        router = UniversalRouter(payable(_router));
        poolManager = IPoolManager(_poolManager);
        permit2 = IPermit2(_permit2);
    }

    // ══════════════════════════════════════════════════════════
    //  STEP 1: Approve Permit2 → Router (gọi 1 lần per token)
    // ══════════════════════════════════════════════════════════

    /**
     * @notice Approve token cho Permit2 → Universal Router.
     *         Gọi 1 lần cho mỗi token cần swap.
     *
     *  Token.approve(Permit2, maxUint)   ← user đã làm ở frontend
     *  Permit2.approve(Token, Router)    ← contract làm ở đây
     *
     * @param token       ERC-20 token address
     * @param amount      Allowance amount (uint160)
     * @param expiration  Khi nào allowance hết hạn (uint48 timestamp)
     */
    function approveTokenWithPermit2(
        address token,
        uint160 amount,
        uint48 expiration
    ) external {
        // Cho phép Permit2 kéo token từ contract này
        IERC20(token).approve(address(permit2), type(uint256).max);

        // Permit2 set sub-allowance: Router được phép kéo token qua Permit2
        permit2.approve(token, address(router), amount, expiration);
    }

    // ══════════════════════════════════════════════════════════
    //  STEP 2: Swap
    // ══════════════════════════════════════════════════════════

    /**
     * @notice Exact Input Single swap trên V4.
     *         Swap đúng amountIn token, nhận ít nhất minAmountOut.
     *
     * @param key           V4 PoolKey (token0, token1, fee, tickSpacing, hooks)
     * @param amountIn      Exact amount of input token
     * @param minAmountOut  Slippage protection — minimum output
     */
    function swapExactInputSingle(
        PoolKey calldata key,
        uint128 amountIn,
        uint128 minAmountOut
    ) external returns (uint256 amountOut) {
        // ── 1. Encode the Universal Router command ──
        // V4_SWAP tells Router to route through V4 PoolManager
        bytes memory commands = abi.encodePacked(uint8(Commands.V4_SWAP));

        // ── 2. Encode V4Router actions ──
        // 3 actions executed sequentially:
        //   SWAP_EXACT_IN_SINGLE → execute the swap
        //   SETTLE_ALL           → pay input tokens
        //   TAKE_ALL             → collect output tokens
        bytes memory actions = abi.encodePacked(
            uint8(Actions.SWAP_EXACT_IN_SINGLE),
            uint8(Actions.SETTLE_ALL),
            uint8(Actions.TAKE_ALL)
        );

        // ── 3. Encode params for each action ──
        bytes[] memory params = new bytes[](3);

        // Param 0: Swap configuration
        params[0] = abi.encode(
            IV4Router.ExactInputSingleParams({
                poolKey: key,
                zeroForOne: true,            // swap token0 → token1
                amountIn: amountIn,
                amountOutMinimum: minAmountOut,
                hookData: bytes("")
            })
        );

        // Param 1: SETTLE_ALL — which token to pay, how much
        params[1] = abi.encode(key.currency0, amountIn);

        // Param 2: TAKE_ALL — which token to receive, minimum
        params[2] = abi.encode(key.currency1, minAmountOut);

        // ── 4. Combine and execute ──
        bytes[] memory inputs = new bytes[](1);
        inputs[0] = abi.encode(actions, params);

        // Deadline: 20 seconds from now
        router.execute(commands, inputs, block.timestamp + 20);

        // ── 5. Check output ──
        amountOut = key.currency1.balanceOf(address(this));
        require(amountOut >= minAmountOut, "Insufficient output");

        return amountOut;
    }

    /**
     * @notice Exact Output Single swap trên V4.
     *         Nhận đúng amountOut token, trả tối đa maxAmountIn.
     */
    function swapExactOutputSingle(
        PoolKey calldata key,
        uint128 amountOut,
        uint128 maxAmountIn
    ) external returns (uint256 amountIn) {
        bytes memory commands = abi.encodePacked(uint8(Commands.V4_SWAP));

        bytes memory actions = abi.encodePacked(
            uint8(Actions.SWAP_EXACT_OUT_SINGLE),
            uint8(Actions.SETTLE_ALL),
            uint8(Actions.TAKE_ALL)
        );

        bytes[] memory params = new bytes[](3);

        params[0] = abi.encode(
            IV4Router.ExactOutputSingleParams({
                poolKey: key,
                zeroForOne: true,
                amountOut: amountOut,
                amountInMaximum: maxAmountIn,
                hookData: bytes("")
            })
        );

        params[1] = abi.encode(key.currency0, maxAmountIn);
        params[2] = abi.encode(key.currency1, amountOut);

        bytes[] memory inputs = new bytes[](1);
        inputs[0] = abi.encode(actions, params);

        router.execute(commands, inputs, block.timestamp + 20);

        return maxAmountIn; // actual amount spent
    }
}
```

---

## 5. Frontend Integration (JavaScript / ethers.js)

### 5.1 One-time Token Approval

```javascript
const { ethers } = require("ethers");

// Permit2 address — same on all chains
const PERMIT2_ADDRESS = "0x000000000022D473030F116dDEE9F6B43aC78BA3";

/**
 * Step 1: User approve token → Permit2 (one-time, costs gas)
 * Sau bước này, user không cần approve lại cho bất kỳ dApp nào dùng Permit2.
 */
async function approveTokenToPermit2(signer, tokenAddress) {
    const token = new ethers.Contract(tokenAddress, [
        "function approve(address spender, uint256 amount) returns (bool)",
        "function allowance(address owner, address spender) view returns (uint256)",
    ], signer);

    // Check nếu đã approve rồi
    const currentAllowance = await token.allowance(signer.address, PERMIT2_ADDRESS);
    if (currentAllowance > 0n) {
        console.log("Already approved Permit2");
        return;
    }

    // Approve max — chỉ cần 1 lần
    const tx = await token.approve(PERMIT2_ADDRESS, ethers.MaxUint256);
    await tx.wait();
    console.log("Approved Permit2:", tx.hash);
}
```

### 5.2 AllowanceTransfer — Sign + Submit

```javascript
/**
 * Step 2: User ký EIP-712 permit → frontend gửi lên contract
 *
 * Không tốn gas cho user (chỉ sign).
 * Gas do contract/relayer trả khi gọi permit2.permit().
 */
async function signAllowancePermit(signer, tokenAddress, spenderAddress, amount, chainId) {
    const permit2 = new ethers.Contract(PERMIT2_ADDRESS, [
        "function allowance(address owner, address token, address spender) view returns (uint160, uint48, uint48)",
    ], signer);

    // Get current nonce from Permit2
    const [, , nonce] = await permit2.allowance(signer.address, tokenAddress, spenderAddress);

    // Build the permit data
    const permitSingle = {
        details: {
            token: tokenAddress,
            amount: amount,                         // uint160
            expiration: Math.floor(Date.now() / 1000) + 86400, // 24 hours
            nonce: nonce,
        },
        spender: spenderAddress,
        sigDeadline: Math.floor(Date.now() / 1000) + 3600, // 1 hour to submit
    };

    // EIP-712 domain for Permit2
    const domain = {
        name: "Permit2",
        chainId: chainId,
        verifyingContract: PERMIT2_ADDRESS,
    };

    // EIP-712 types
    const types = {
        PermitSingle: [
            { name: "details", type: "PermitDetails" },
            { name: "spender", type: "address" },
            { name: "sigDeadline", type: "uint256" },
        ],
        PermitDetails: [
            { name: "token", type: "address" },
            { name: "amount", type: "uint160" },
            { name: "expiration", type: "uint48" },
            { name: "nonce", type: "uint48" },
        ],
    };

    // User signs — MetaMask shows structured data
    const signature = await signer.signTypedData(domain, types, permitSingle);

    console.log("Permit signed:", signature.slice(0, 20), "...");

    return { permitSingle, signature };
}
```

### 5.3 SignatureTransfer — One-time Transfer

```javascript
/**
 * SignatureTransfer: User ký → token chuyển ngay trong 1 tx.
 * Signature chỉ dùng được 1 lần (nonce bitmap).
 */
async function signSignatureTransfer(signer, tokenAddress, spenderAddress, amount, chainId) {
    // Nonce: any unique number — Permit2 uses bitmap, not sequential
    const nonce = BigInt(Date.now()); // simple unique nonce

    const permit = {
        permitted: {
            token: tokenAddress,
            amount: amount,
        },
        nonce: nonce,
        deadline: Math.floor(Date.now() / 1000) + 3600, // 1 hour
    };

    const domain = {
        name: "Permit2",
        chainId: chainId,
        verifyingContract: PERMIT2_ADDRESS,
    };

    const types = {
        PermitTransferFrom: [
            { name: "permitted", type: "TokenPermissions" },
            { name: "spender", type: "address" },
            { name: "nonce", type: "uint256" },
            { name: "deadline", type: "uint256" },
        ],
        TokenPermissions: [
            { name: "token", type: "address" },
            { name: "amount", type: "uint256" },
        ],
    };

    // IMPORTANT: spender must be included in the signed data
    // but it's NOT a field in the struct — it's passed separately
    const values = {
        permitted: permit.permitted,
        spender: spenderAddress,
        nonce: permit.nonce,
        deadline: permit.deadline,
    };

    const signature = await signer.signTypedData(domain, types, values);

    return { permit, signature };
}
```

### 5.4 Full Swap Flow trên Uniswap V4

```javascript
/**
 * Complete swap flow: approve → sign Permit2 → execute swap
 */
async function swapOnUniswapV4(
    signer,
    tokenIn,
    tokenOut,
    amountIn,
    minAmountOut,
    chainId
) {
    // Deployed addresses (example — Ethereum mainnet)
    const UNIVERSAL_ROUTER = "0x66a9893cC07D91D95644AEDD05D03f95e1dBA8Af";
    const POOL_MANAGER = "0x000000000004444c5dc75cB358380D2e3dE08A90";
    const SWAPPER_CONTRACT = "0x..."; // Your UniswapV4Swapper address

    console.log("=== Uniswap V4 Swap via Permit2 ===\n");

    // Step 1: One-time approve (skip if already done)
    console.log("1. Approving token → Permit2...");
    await approveTokenToPermit2(signer, tokenIn);

    // Step 2: Approve Permit2 → Universal Router (via your contract)
    console.log("2. Setting Permit2 → Router allowance...");
    const swapper = new ethers.Contract(SWAPPER_CONTRACT, SWAPPER_ABI, signer);
    await swapper.approveTokenWithPermit2(
        tokenIn,
        ethers.MaxUint160,                                  // max amount
        Math.floor(Date.now() / 1000) + 30 * 24 * 3600    // 30 days
    );

    // Step 3: Execute swap
    console.log("3. Executing swap...");
    const poolKey = {
        currency0: tokenIn,
        currency1: tokenOut,
        fee: 3000,          // 0.3%
        tickSpacing: 60,
        hooks: ethers.ZeroAddress,
    };

    const tx = await swapper.swapExactInputSingle(poolKey, amountIn, minAmountOut);
    const receipt = await tx.wait();

    console.log("Swap completed:", receipt.hash);
}
```

---

## 6. Security Considerations

### 6.1 Rủi ro của Permit2

| Rủi ro | Giải thích | Mitigation |
|---|---|---|
| **Malicious signature** | User ký phishing signature → attacker kéo hết token | Luôn verify domain separator, đọc kỹ MetaMask popup |
| **Max approval** | approve(Permit2, maxUint) = Permit2 có toàn quyền | Permit2 chỉ cho phép transfer khi có valid sub-permission |
| **Hanging allowance** | AllowanceTransfer lưu allowance on-chain | Luôn set expiration ngắn, revoke khi không dùng |
| **Signature replay** | Cùng signature dùng lại nhiều lần | Nonce tự tăng (Allowance) hoặc bitmap (Signature) |
| **Cross-chain replay** | Signature dùng trên chain khác | chainId trong EIP-712 domain separator |

### 6.2 Best Practices

```solidity
// ✅ Luôn set expiration cho allowance
permit2.approve(token, spender, amount, uint48(block.timestamp + 1 days));

// ❌ KHÔNG set expiration vô hạn
permit2.approve(token, spender, amount, type(uint48).max);

// ✅ Kiểm tra deadline hợp lý
require(block.timestamp + 20 <= deadline, "Deadline too short");

// ❌ KHÔNG dùng block.timestamp hoặc type(uint256).max làm deadline
router.execute(commands, inputs, block.timestamp);      // ❌
router.execute(commands, inputs, type(uint256).max);    // ❌
```

### 6.3 Revoke Approvals

```javascript
// Revoke Permit2 allowance cho 1 spender cụ thể
async function revokePermit2Allowance(signer, tokenAddress, spenderAddress) {
    const permit2 = new ethers.Contract(PERMIT2_ADDRESS, [
        "function approve(address token, address spender, uint160 amount, uint48 expiration) external",
    ], signer);

    // Set amount = 0 → revoke
    await permit2.approve(tokenAddress, spenderAddress, 0, 0);
    console.log("Revoked allowance for", spenderAddress);
}

// Lockdown: revoke TẤT CẢ approvals trong 1 tx
async function lockdown(signer, tokensAndSpenders) {
    const permit2 = new ethers.Contract(PERMIT2_ADDRESS, [
        "function lockdown(tuple(address token, address spender)[] approvals) external",
    ], signer);

    await permit2.lockdown(tokensAndSpenders);
    console.log("Lockdown complete — all approvals revoked");
}
```

---

## 7. Tổng kết Flow

```
╔═══════════════════════════════════════════════════════════════════╗
║                    PERMIT2 + UNISWAP V4 FLOW                    ║
╠═══════════════════════════════════════════════════════════════════╣
║                                                                   ║
║  ┌─────────┐                                                     ║
║  │  USER   │                                                     ║
║  └────┬────┘                                                     ║
║       │                                                           ║
║       │ ① token.approve(Permit2, maxUint)     ← 1 lần / token   ║
║       │                                                           ║
║  ┌────▼────┐                                                     ║
║  │ PERMIT2 │ ← Canonical: 0x000...78BA3                          ║
║  └────┬────┘                                                     ║
║       │                                                           ║
║       │ ② permit2.approve(token, Router, amount, expiry)         ║
║       │    hoặc user.signTypedData(PermitSingle)                 ║
║       │                                                           ║
║  ┌────▼──────────────┐                                           ║
║  │ UNIVERSAL ROUTER  │ ← Entrypoint cho swap                    ║
║  └────┬──────────────┘                                           ║
║       │                                                           ║
║       │ ③ router.execute(V4_SWAP, [SWAP + SETTLE + TAKE])       ║
║       │                                                           ║
║  ┌────▼──────────────┐                                           ║
║  │   POOL MANAGER    │ ← Singleton quản lý tất cả V4 pools     ║
║  └────┬──────────────┘                                           ║
║       │                                                           ║
║       │ ④ Swap xảy ra trong pool                                 ║
║       │                                                           ║
║  ┌────▼────┐                                                     ║
║  │ V4 POOL │ ← token0/token1/fee/tickSpacing/hooks              ║
║  └─────────┘                                                     ║
║                                                                   ║
╚═══════════════════════════════════════════════════════════════════╝
```