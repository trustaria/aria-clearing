# CRE settlement workflow

`aria-settle` is a Chainlink CRE workflow (TypeScript SDK) that settles AriaClearing events on Monad testnet.

On each cron tick it:

1. reads `pendingEvents()`, `disputeWindow()` and `lastReportedAt()` from AriaClearing at the latest block;
2. selects events whose window has closed (`loggedAt + disputeWindow <= now`), oldest first, at most `maxIdsPerReport`;
3. sends **one** `POST {evidenceUrl}` with the ids of the `Logged` ones (identical-result consensus over the decision);
4. applies the rule: an impression is released iff `viewMs >= 1000 && visibleRatio >= 0.5`, a click iff
   `clickRedirected`; anything else, a missing id, and every `Disputed` event go to reject;
5. writes `abi.encode(uint64 reportedAt, bytes32[] release, bytes32[] reject)` to AriaClearing through the
   Monad testnet MockKeystoneForwarder (`0xB9F79d863261869B234c481D1f9A7af84AeAd192`).

Nothing to settle means no HTTP call and no transaction. A non-2xx evidence response fails the run without a report.

## Layout

```
cre/
  project.yaml            RPC per target (staging-settings → Monad testnet)
  .env.example            CRE_ETH_PRIVATE_KEY for --broadcast
  aria-settle/
    main.ts               entry point
    config.json           staging config
    workflow.yaml         target → workflow name, entry and config
    src/                  abi, select, evidence, rule, report, workflow
    test/                 bun tests (pure modules + mocked end-to-end run)
```

## Config (`aria-settle/config.json`)

| Field | Value |
|---|---|
| `schedule` | cron with seconds; simulation fires once on demand |
| `chainSelectorName` | `monad-testnet` (selector `2183018362218727504`) |
| `clearingAddress` | AriaClearing address from `deployments/10143.json` |
| `evidenceUrl` | the live site's `https://web-production-95cf9.up.railway.app/api/aria/evidence`; `http://localhost:3000/api/aria/evidence` against a local web app |
| `gasLimit` | `"1500000"` (string): payouts add USDC transfers; Monad bills the full limit (~0.15 MON per run) |
| `maxIdsPerReport` | `15` |

## Evidence API contract

```
POST {evidenceUrl}
{"ids": ["0x<eventId>", ...]}

200 {"evidence": [{"id": "0x<eventId>", "kind": "impression" | "click",
                   "viewMs": 1800, "visibleRatio": 0.9, "clickRedirected": false,
                   "firstSeenAt": "..."}]}
```

`id` is the onchain `eventId = keccak256(abi.encode(requestId, kind))`, 0x + 64 hex (case-insensitive).
A missing id, a malformed entry or an entry whose `kind` differs from the onchain kind counts as no evidence.

## Commands

Requires bun ≥ 1.2.21 (`bun upgrade`) and the CRE CLI (`~/.cre/bin/cre`).

```sh
cd cre/aria-settle
bun install
bun test
bun run typecheck

cd ..                                   # cre/
cre workflow build ./aria-settle        # compiles to aria-settle/binary.wasm, no login needed
```

Simulate (needs `cre login`; `--broadcast` needs `cre/.env` with a funded Monad testnet key):

```sh
cd cre
cp .env.example .env                    # fill CRE_ETH_PRIVATE_KEY
cre login

# dry run: reads chain and evidence, prints the decision, no transaction
cre workflow simulate ./aria-settle -T staging-settings --non-interactive --trigger-index 0

# settle onchain
cre workflow simulate ./aria-settle -T staging-settings --non-interactive --trigger-index 0 --broadcast
```

The mock forwarder never reverts when `onReport` fails, so `txStatus=SUCCESS` alone proves nothing. Confirm with
AriaClearing's `EventSettled(eventId, outcome)` logs in the broadcast tx (outcome 3 = Released, 4 = Rejected).
Running it again settles nothing new: settled ids leave `pendingEvents()`.

The mock forwarder is permissionless and skips signature checks, so anyone can route a report through it on
testnet; the production forwarder verifies DON signatures.

## A real run on Monad testnet

`simulate --broadcast` against the live contract `0x431e97E2EB23ac06C9f807cC8DCe54499C1bDC7B` and the live site's
evidence endpoint, on three events created on the live site: a Nova card viewed
([logEvent](https://testnet.monadvision.com/tx/0x1f7bb1af1254702c6befca205d3037192e216749384d880c347fd7e0d09e2519))
and clicked ([logEvent](https://testnet.monadvision.com/tx/0xe9aaf334bba9463ecdd17a113f11c62f76e1afa973f4f1be8807c80c9ac2ec4c)),
and a forged impression for a card that was never on screen
([logEvent](https://testnet.monadvision.com/tx/0x64301476d3bf1f560ac0f4d6c3088adfc36137e0344bb7a7addd09581dd0f72c)):

```
[USER LOG] aria-settle: 3 pending, 3 past the 20s window (now=1791925189, cap=15)
[USER LOG] aria-settle: release 2, reject 1
[USER LOG] aria-settle:   release 0x737d128f469372dd695f2691ebc4547db99b9d8934d9368435283604d3c31758
[USER LOG] aria-settle:   release 0xaa74416dbbdea0085800f5a8bc206d66d058828091980aa67e2748ca5010c285
[USER LOG] aria-settle:   reject  0x145698cd118124021c1a32fc71164484d67b8866e37de97700e511d51743b75f
[USER LOG] aria-settle: writeReport txStatus=SUCCESS receiver=0 tx=0x1f0988846ef20eb86959cab6abb6c178f93b9b8caad56f3af855f8dd9118d84a
```

The settlement tx emits `EventSettled` for all three and `PaidOut` for the two released events, each with the
app's amount and Aria's 20 % fee ($0.008 + $0.002 and $0.20 + $0.05); the forged impression's price returns to the
campaign budget:
[0x1f09…d84a](https://testnet.monadvision.com/tx/0x1f0988846ef20eb86959cab6abb6c178f93b9b8caad56f3af855f8dd9118d84a).
Receipts: [verified](https://web-production-95cf9.up.railway.app/receipt/req_gQfX4agOzJkHRZQwQiA32Z) and
[rejected](https://web-production-95cf9.up.railway.app/receipt/req_2DCUb2B7NwcNO6PvpM7kUS). Check it yourself:

```sh
pnpm --filter @aria-clearing/receipt verify req_gQfX4agOzJkHRZQwQiA32Z \
  --sentence "For a Lisbon family trip, packages cover 3 to 10 nights and children under 6 stay free in partner hotels."
```
