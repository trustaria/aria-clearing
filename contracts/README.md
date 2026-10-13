# contracts

`AriaClearing.sol`: USDC escrow, the onchain event log, disputes and CRE settlement (`onReport`).
A release takes Aria's fee, `fee = price * feeBps / 10_000` (rounded down), into `fees` and transfers
the net `price - fee` straight to the publisher (`PaidOut`); if that transfer fails the net is credited
instead (`PayoutDeferred`) and the publisher pulls it with `claim()`. Rejected and disputed events are
refunded to the campaign in full, with no fee. Anyone can call `withdrawFees()`, which pays all accrued
fees to `feeRecipient`.
The interface is `src/IAriaClearing.sol`.

> The libraries are git submodules: clone with `git clone --recurse-submodules`, or run
> `git submodule update --init --recursive` before `forge build`.

## Test

```bash
forge test -vv
forge test --gas-report --match-test testGas_
```

## Deploy to Monad testnet (chain 10143)

The deployer needs MON for gas and enough USDC for every campaign in `script/campaigns.json`
(4 × 4 USDC + 10 × 1.5 USDC = 31 USDC). The deployer becomes the contract owner, the fee recipient (`feeBps` 2000, 20 %)
and the advertiser of the seeded campaigns.

```bash
cd contracts
set -a; source ../.env.local; set +a   # MONAD_TESTNET_RPC_URL, DEPLOYER_PRIVATE_KEY

export USDC_ADDRESS=0x534b2f3A21130d7a60830c2Df862319e593943A3        # Circle USDC, Monad testnet
export FORWARDER_ADDRESS=0xB9F79d863261869B234c481D1f9A7af84AeAd192   # CRE MockKeystoneForwarder
export RELAYER_ADDRESS=<privy-server-wallet-address>
export DISPUTE_WINDOW=20                                              # seconds

# 1. Deploy; writes ../deployments/10143.json
forge script script/Deploy.s.sol:Deploy \
  --rpc-url "$MONAD_TESTNET_RPC_URL" --private-key "$DEPLOYER_PRIVATE_KEY" --broadcast --slow

# 2. Verify on MonadVision (Sourcify)
forge verify-contract "$(jq -r .address ../deployments/10143.json)" AriaClearing \
  --chain 10143 --verifier sourcify --verifier-url https://sourcify-api-monad.blockvision.org/

# 3. Seed the campaigns (skips any that already exist)
forge script script/Seed.s.sol:Seed \
  --rpc-url "$MONAD_TESTNET_RPC_URL" --private-key "$DEPLOYER_PRIVATE_KEY" --broadcast --slow

# 4. Check one campaign: claimsHash must be 0x634e8eac…208a
cast call "$(jq -r .address ../deployments/10143.json)" \
  'campaign(bytes32)((address,bytes32,uint256,uint256,uint256,uint256))' \
  "$(cast keccak lisbon-family-trips)" --rpc-url "$MONAD_TESTNET_RPC_URL"
```

`MONAD_TESTNET_RPC_URL` is `https://testnet-rpc.monad.xyz`.

`deployments/<chainId>.json` holds `{chainId, address, deployBlock, usdc, relayer, forwarder, feeBps, feeRecipient, disputeWindow}`.
It is written only on broadcast. `deployBlock` is the block number when the script ran, a lower bound of
the inclusion block, so indexers can start from it.

## Local run (anvil)

```bash
anvil --port 8611
RPC=http://127.0.0.1:8611
DEPLOYER=0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
forge create test/mocks/MockUSDC.sol:MockUSDC --rpc-url $RPC --unlocked --from $DEPLOYER --broadcast
cast send <usdc> 'mint(address,uint256)' $DEPLOYER 20000000 --rpc-url $RPC --unlocked --from $DEPLOYER
USDC_ADDRESS=<usdc> RELAYER_ADDRESS=0x70997970C51812dc3A010C7d01b50e0d17dc79C8 \
FORWARDER_ADDRESS=0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC DISPUTE_WINDOW=20 \
  forge script script/Deploy.s.sol:Deploy --rpc-url $RPC --unlocked --sender $DEPLOYER --broadcast
forge script script/Seed.s.sol:Seed --rpc-url $RPC --unlocked --sender $DEPLOYER --broadcast
```

## Gas

| Call | Gas |
|---|---|
| `logEvent`, first event of a campaign (150-char rationale, 2 claim refs), full tx | 202,006 |
| `logEvent`, later events, full tx | 167,806 |
| `onReport`, 15 releases paid to 15 new publishers, execution (forge test) | 884,139 |
| `claim` (after a deferred payout), execution | 63,314 |

Measured on anvil unless marked. Monad charges the gas limit, not gas used, and prices cold storage differently,
so set the relayer's limit from `cast estimate` against the deployed contract plus a margin.
