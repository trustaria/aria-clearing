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
| `evidenceUrl` | `http://localhost:3000/api/aria/evidence`; a `cloudflared` URL if localhost is unreachable |
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

`simulate --broadcast` against the live contract `0x431e97E2EB23ac06C9f807cC8DCe54499C1bDC7B`, settling a viewed
impression and a click from Nova, and rejecting a forged impression (never on screen):

```
[USER LOG] aria-settle: 3 pending, 3 past the 20s window (now=1791909396, cap=15)
[USER LOG] aria-settle: release 2, reject 1
[USER LOG] aria-settle:   release 0x6190f53d5c344b86281e7103d61078c3e4f8fc871caebdf3af6c9685e6564b02
[USER LOG] aria-settle:   release 0x1b8f080cbaad7f8c21d390921d60fe944b0f55261e840385de51d3ad83bac40b
[USER LOG] aria-settle:   reject  0xffe4fbe0b0f70e82b18d90482791ebc3e54bfeb3524e0e7c5b5ea64be275a387
[USER LOG] aria-settle: writeReport txStatus=SUCCESS receiver=0 tx=0x24b97108e45d388ec6ea1f8fb663f46e30c39066bfa0c1ea83aece0beb967832
```

The settlement tx emits `EventSettled` for all three and `PaidOut` for the two released events, each with the
app's amount and Aria's 20 % fee ($0.008 + $0.002 and $0.20 + $0.05):
[0x24b9…7832](https://testnet.monadvision.com/tx/0x24b97108e45d388ec6ea1f8fb663f46e30c39066bfa0c1ea83aece0beb967832).
Check it yourself: `pnpm --filter @aria-clearing/receipt verify req_36wX7fR79VnTOVHwllgYhA`.
