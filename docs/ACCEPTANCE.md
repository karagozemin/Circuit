# P0 acceptance evidence — 6 September 2026

The locked PRD is unchanged. This report distinguishes implementation tests from live-chain acceptance. **The full live Definition of Done remains open.**

Verification: **26 TypeScript tests, 37 Forge tests, production build, tools typecheck, and the actual keeper/Anvil integration passed.**

## Implemented and verified locally

| Requirement | Evidence |
| --- | --- |
| Reject missing/invalid risk limits, unsupported actions and malformed drafts | `src/lib/strategy.test.ts`; incomplete drafts block validation/activation and never inherit the builder preset |
| Bounded automatic IOC execution | `scripts/keeper.ts`, `src/lib/automation/order-plan.test.ts`; bigint price/tick/lot rounding and remaining-cap checks |
| Callback → order → fill → resolution → redeem → rollover → next ARMED | `testResolutionCallbackRedeemsAndReturnsToArmedSuccessor`; [local trace](../deployments/evidence/local-lifecycle-trace.txt) |
| Resolution source of truth | Engine reads `isResolved`, `isVoided`, `payoutNumerators`; callback cannot supply winner/proceeds |
| Actual redeem proceeds | Exact ERC-6909 position approval, module redeem, collateral and position balance deltas; winner/partial fill tests |
| Void neutrality, no-fill neutrality, expired untriggered window | `testVoidRedeemsHalfAndPreservesLossCounter`, `testNoFillAndExpiredUntriggeredWindowDoNotCountAsLoss` |
| Permissionless sync and replay protection | `testPermissionlessSyncRedeemsActualWinAndIsIdempotent`; paused/unsettled tests |
| Preserve the execution account while a position is open | `testCannotSwapAccountWithOpenPosition` |
| Authoritative successor binding | Module registry, increasing expiry, exact cadence, unchanged collateral/outcome singleton; old handler bindings removed |
| Live UI reads | Engine state, round, capital, losses, event transaction links and subscription funding health are read from chain; preview no longer changes live state |
| Resolution subscription in activation | Activation dialog creates pool OrderFilled, BinaryMarket StatusChanged and creator MarketCreated subscriptions before arming |
| Indexer outage recovery | `chain-discovery.ts` scans bounded RPC log ranges, checks creator ownership against the SDK deployment and verifies module registry + live market state |

The Solidity trace uses a mock venue and impersonated precompile in a local test. It is not evidence of a live Somnia callback, live fill, or live settlement.

## Verified on Shannon

[Deployment record](../deployments/shannon.json) contains the new Engine, Handler and SmartAccount receipts, runtime code hashes, and the previous deployment history.

[Preparation receipts](../deployments/evidence/live-preparation-v2.json) contain:

- an owner-controlled smart account funded with **2 tUSDC**;
- **1 tUSDC** allowance to the recorded BTC 1h pool;
- a strategy created, linked and market-bound, with explicit automatic-rollover consent;
- three real on-chain subscription receipts and IDs, with `getSubscriptionInfo` verification;
- balance/allowance reads and the verification timestamp.

The first above-0.70 demo fixture was paused and cancelled without an Engine position after the intended maker order immediately filled against existing public asks. Its receipts remain in `live-demo/attempt-1.json`. A separate explicit BUY_UP/below-0.70 fixture retained the 1 tUSDC order cap and 2 tUSDC capital cap. Its real Reactivity callback triggered the keeper; the Engine spent 1 tUSDC and received 50 UP shares. [Live evidence](../deployments/evidence/live-demo/proof.json) records the ongoing settlement wait and verified pause/resume without a duplicate order. A read-only browser dashboard is being recorded. No local oracle mutation is used.

## Open acceptance items and limits

- **Live callback → automatic order → fill → resolution → redeem → rollover recording is not complete.** `liveLifecycle.complete` is false; callback and order hashes are populated, resolution and successor proof are pending.
- The indexer's Market queries timed out during verification. Chain logs found active BTC/ETH 1h windows; earlier sampled books were empty, but the current demo window has public liquidity. The observed creator's BTC/ETH 15m series had not advanced since expiry `1788546600`. There was no eligible BTC 15m window in the recent scanned events.
- The demo entered an already-running 1h window with less than 30 minutes remaining. Local time advancement is not substituted for live oracle resolution.
- With explicit owner consent via `setAutomaticRollover`, a separate keeper signer can bind a successor and grant its exact next-round allowance. The handler verifies creator callbacks against module records; the engine restricts successors to the approved creator, asset and cadence. This path passed the local keeper integration. The v2 contracts are deployed and the public deployment record points to them. Three subscriptions are funded. Actual callback and automatic order evidence is recorded; live settlement and successor proof are pending.
- Missed fill events cannot be reconstructed from a caller-supplied price. Sync recovers settlement/expiry and the keeper recovers an already-TRIGGERED action. If the market-activity callback never arrived, the round expires without a fabricated trigger.
- The intent compiler is local and deterministic, and is labelled as such. The PRD's actual Somnia Agent integration is not established by these tests.
- Revoking an ERC-20 pool allowance prevents current-pool spending. Disable automatic rollover or pause the strategy to prevent future authorized pool approvals. The UI now detects insufficient/revoked current-pool allowance and funding. Browser recovery validates the saved owner and manifest hash against chain state. Cross-user keeper enrollment still needs deployment integration.
- UX judge testing, real BUY UP/BUY DOWN fills, live void/redeem and the final recorded demo remain unchecked. The locked PRD checklist has not been blanket-marked complete.

## Reproduce

```bash
npm test
npm run contracts:test
npm run build
npm run typecheck:tools
npm run test:keeper
```

`test:keeper` launches an isolated Anvil chain with disposable local signers and a mock venue, runs the actual keeper process for order execution and a separate restart for redemption, then verifies that a non-owner keeper cannot rebind without consent and can subscribe, approve the exact budget and arm a verified successor after consent. Its evidence is explicitly labelled local.

Protocol ABI references: [Somnia Markets release notes](https://prd.smk.somnia.host/docs/typescript/release-notes), [Reactivity subscription management](https://docs.somnia.network/developer/reactivity/tooling/subscription-management). Runtime signatures were also checked against the installed SDK 0.29.0 source and successful Shannon binding/subscription transactions.
