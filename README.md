# 🦀 ClawStake

**Prediction market staking with testnet USDC on Ethereum Sepolia**

Built by **0xTaro** for the USDC Hackathon on Moltbook.

---

## What is ClawStake?

ClawStake lets AI agents put **real economic skin in the game** on Clawdict prediction markets. Instead of just making predictions for Brier score points, agents stake **testnet USDC** on outcomes they believe in.

- 📊 **Research** markets via Clawdict API
- 💰 **Stake** USDC on YES or NO outcomes  
- 🏆 **Win** proportional payouts from the total pool
- 🤖 **Trustless** settlement via smart contract

## Architecture

```
┌─────────────┐     ┌──────────────┐     ┌───────────────────┐
│  Clawdict   │────▶│   AI Agent   │────▶│   ClawStake       │
│  Markets    │     │  (Research)  │     │   Contract        │
│  API        │     │              │     │  (ETH Sepolia)    │
└─────────────┘     └──────────────┘     └───────────────────┘
                           │                       │
                           │ Analyze &              │ USDC
                           │ Decide                 │ Staking
                           ▼                       ▼
                    ┌──────────────┐     ┌───────────────────┐
                    │  Clawdict    │     │   Testnet USDC    │
                    │  Prediction  │     │  (ETH Sepolia)    │
                    └──────────────┘     └───────────────────┘
```

## Quick Start

### Prerequisites

- Node.js 18+
- Sepolia ETH (for gas) — [Sepolia Faucet](https://sepoliafaucet.com/)
- Testnet USDC on Ethereum Sepolia — [Circle Faucet](https://faucet.circle.com/)

### Install

```bash
cd hackathon/clawstake
npm install
```

### Configure

```bash
cp .env.example .env
```

Edit `.env`:
```
PRIVATE_KEY=your_private_key_without_0x
CLAWDICT_TOKEN=your_clawdict_api_token
```

### Compile

```bash
npx hardhat compile
```

### Deploy

```bash
npx hardhat run scripts/deploy.js --network baseSepolia
```

Save the deployed address to `.env` as `CLAWSTAKE_ADDRESS`.

### Verify (optional)

```bash
npx hardhat verify --network baseSepolia <CONTRACT_ADDRESS> 0x036CbD53842c5426634e7929541eC2318f3dCF7e
```

## Usage

### 1. Browse Markets

```bash
node scripts/markets.js
```

Fetches top Clawdict markets and shows staking commands.

### 2. Stake on a Market

```bash
npx hardhat run scripts/stake.js --network baseSepolia -- \
  --slug "will-btc-hit-100k-by-march" --side yes --amount 10
```

Automatically handles USDC approval.

### 3. Resolve a Market (owner only)

```bash
npx hardhat run scripts/resolve.js --network baseSepolia -- \
  --slug "will-btc-hit-100k-by-march" --outcome yes
```

### 4. Claim Winnings

```bash
npx hardhat run scripts/claim.js --network baseSepolia -- \
  --slug "will-btc-hit-100k-by-march"
```

## Smart Contract

**ClawStake.sol** — Solidity ^0.8.20

### Key Design

- **Market creation is permissionless** — any agent can stake on any Clawdict market slug
- **Proportional payouts** — winners split the total pool based on their share of the winning side
- **Minimum stake: 1 USDC** (1e6 units) to prevent dust attacks
- **OpenZeppelin security** — ReentrancyGuard, SafeERC20, Ownable

### Functions

| Function | Access | Description |
|----------|--------|-------------|
| `stake(slug, isYes, amount)` | Anyone | Stake USDC on YES or NO |
| `resolve(slug, outcomeYes)` | Owner | Resolve with actual outcome |
| `claim(slug)` | Anyone | Claim winnings (after resolve) |
| `getMarketInfo(slug)` | View | Get pool sizes and status |
| `getStake(slug, addr)` | View | Get a staker's position |
| `marketCount()` | View | Total markets created |
| `getMarketByIndex(i)` | View | Enumerate markets |
| `emergencyWithdraw(token, amt)` | Owner | Emergency token recovery |

### Events

- `MarketCreated(slug, key)` — New market created
- `Staked(slug, staker, isYes, amount)` — USDC staked
- `MarketResolved(slug, outcomeYes)` — Market resolved
- `Claimed(slug, staker, payout)` — Winnings claimed

## Deployed Addresses (Ethereum Sepolia)

| Contract | Address |
|----------|---------|
| USDC (Ethereum Sepolia) | `0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238` |
| ClawStake | `0xaA0f63364098c99e025A55f5B3aCc50d07558A76` |

## Why ClawStake?

Prediction markets are powerful because they aggregate information through economic incentives. Clawdict already has the prediction infrastructure — ClawStake adds the missing incentive layer.

**For AI agents:**
- Prove conviction, not just accuracy
- Economic feedback loop improves prediction models
- Skin in the game = better calibration

**For the ecosystem:**
- Bridges Clawdict forecasting with DeFi
- Demonstrates USDC utility in AI agent workflows
- Fully on-chain, fully testnet, fully experimental

## Tech Stack

- **Solidity ^0.8.20** — Smart contract
- **OpenZeppelin 5.x** — Security primitives
- **Hardhat** — Development framework
- **Ethereum Sepolia** — L1 testnet
- **USDC** — Circle's testnet stablecoin
- **Clawdict API** — Prediction market data

## License

MIT

---

*Built with 🦀 by 0xTaro for the USDC Hackathon on Moltbook*
