# Programmable Circuit — P0 acceptance addendum

This tightens acceptance without changing Circuit's product scope. No vault, market maker, hedge product or copy trading. **Compose → Compile → Execute → React.**

> Others automate a strategy. Circuit makes strategies programmable.

## Executable graph grammar

The editor owns a persisted graph document with node IDs, typed rules, explicit port connections and layout. Users can add, remove, move and reconnect nodes. Each supported program uses one MARKET, CONDITION, BUY, WIN/LOSS, ROLL and STOP node. The supported connections are:

```text
MARKET.next → CONDITION
CONDITION.match → BUY
BUY.resolved → WIN/LOSS
WIN/LOSS.win → ROLL
WIN/LOSS.loss → STOP
WIN/LOSS.void → STOP
ROLL.next → STOP
STOP.next → MARKET (only while capital, round and loss limits permit)
```

This is a bounded trading DSL, not an arbitrary graph interpreter. Missing nodes, duplicate nodes/ports, disconnected branches, unsupported edges, unbounded cycles and invalid limits fail compilation. The graph compiler produces the actual Strategy Manifest passed to `manifestHash` and the Engine adapter. Editing rules or connections invalidates compilation; moving a node does not. Existing browser drafts can be opened and compiled into the new graph format.

## Same engine, three programs

| Program | Entry | Win progression | Stop conditions |
| --- | --- | --- | --- |
| Contrarian Roller | BTC UP fill above 0.70 → BUY DOWN, cap 10 tUSDC/order | Roll 50% of actual redeemed proceeds, within caps | 20 tUSDC lifetime spend; 5 rounds; 2 consecutive losses |
| Conditional Ladder | BTC UP fill below 0.40 → BUY UP | Start 5; increase next budget by 2.5 after a settled win; per-order maximum 10 | First loss; 3 rounds; 25 tUSDC lifetime spend |
| Bounded Streak | ETH UP fill above 0.60 → BUY UP, cap 3 | Roll 50% of actual redeemed proceeds | First loss; 4 rounds; 12 tUSDC lifetime spend |

Ladder's intended win path is **5 → 7.5 → 10**, followed by the round stop. These are order budget ceilings, not guaranteed fill amounts. Each rung is also clipped to the remaining lifetime spending cap. A void or skipped market preserves the rung and loss counter; only a settled WIN increases it. The smart account must have enough actual collateral for the next rung; the keeper does not invent funds or top up the account.

Ladder uses `createConfiguredLadderStrategy`, the same Engine execution path, the same SmartAccount and the same Reactivity handler. No separate strategy-specific engine is deployed. The old `StrategyConfig` ABI remains compatible; ladder sizing is stored separately and initialized atomically. `ladderSetupVersion()` capability detection prevents fallback to a fixed-size strategy on old deployments.

## Intent assistant

The assistant is a local, deterministic intent parser. It proposes rules; it does not predict markets, choose a trade or fill missing risk parameters. The supported Turkish phrase “UP 70 cent’i geçerse DOWN al, iki kayıpta dur” extracts the entry, direction and loss stop, then requests the missing market, amount and bounds. Complete proposals go through the same graph compiler. User review and explicit wallet authorization remain separate steps. No external LLM or Somnia Agent integration is claimed.

## State and evidence

Activity shows current state, configured maximum capital, round limit, loss counter, current on-chain market link, last observed chain action, next action and next order budget. The execution checklist uses current-strategy chain events and verified subscription reads; no timer, sample graph or preview completes a step.

“Next node executed” means a verified successor MARKET binding, not a second order fill. Missing history stays unverified. Initial subscription IDs are displayed with their emitter links and funding/handler verification; this does not establish keeper uptime or the health of every later successor subscription. The UI uses the actual test collateral denomination **tUSDC**, not an unsupported USDso label.

## Acceptance evidence and release boundary

- Graph compiler and three exact manifest/Engine adapter round trips: `src/lib/graph.test.ts`.
- Ladder sizing, 5/7.5/10 progression, loss stop, cap clipping and void neutrality: `contracts/test/CircuitEngine.t.sol`.
- Contrarian execution and Bounded Streak redeemed-win progression and first-loss stop: the same contract test suite.
- Older Engine rejection and ladder-capable readiness: `src/lib/contracts/activation-preflight.test.ts`.
- Existing real Shannon subscription/callback/order/settlement proof remains in [the live receipt audit](../deployments/evidence/live-demo/audit.json) and [demo report](LIVE_DEMO.md).

**The Ladder-capable Engine, handler and linked SmartAccount are deployed and verified on Shannon.** The [deployment record](../deployments/shannon-programmable.json) contains successful receipts, runtime code hashes, ownership/wiring checks and verified `ladderSetupVersion() == 1`. Frontend environments must use these new addresses. The new account requires initial preparation. Ladder execution is locally tested but has no complete live-cycle proof yet; deployment does not constitute execution evidence. Do not label the existing historical live recording as a Ladder run or as proof that all three programs executed live.

Local verification for this update: **67 TypeScript tests, 48 Foundry tests, production build, tools typecheck and keeper/Anvil integration passed.** Browser checks at 1440px and 390px covered all three programs, node removal/addition/reconnection, manifest inspection, compilation invalidation and saved-graph recovery. A separate browser check verified that foreign strategy events, foreign subscription IDs, skipped windows and initial bindings cannot falsely complete the execution checklist. These are local checks, not live-chain evidence for Ladder.

## Shared-runtime evidence

Run `npm run test:programs` to compile the actual three template graphs, initialize three isolated smart accounts and execute their programs on the **same Engine instance**. The [local machine-readable proof](../deployments/evidence/local-three-programs.json) records graph/manifest/hash pairs, individual fill and settlement transactions, eight completed rounds and each program’s final stop. Contrarian budgets follow 10 → 2 → 10 under the chosen fixture fills; Ladder follows 5 → 7.5 → 10; Streak follows 3 → 2. These are bounded order budgets; recorded actual spend is separate. Mock prices/outcomes and impersonated validator dispatch are local fixtures, not measured live-market performance.

## Short-window deployment

The [current Shannon deployment](../deployments/shannon-short-windows.json) adds 1m/5m support alongside 15m and legacy 1h handling. Engine, handler and linked smart-account receipts succeeded. Deployed runtime code matches the local compiled artifacts (constructor immutables checked separately through ownership/wiring reads). Read-only `createStrategy` simulations passed for 60, 300 and 900 seconds. Local frontend and keeper address configuration was updated after verification. The new smart account still needs funding/preparation before activation; no live strategy, subscriptions or orders were created during redeployment.

`node --env-file=.env.local --import tsx scripts/deploy-windows.ts` performs a read-only preflight. Add `--execute` to deploy/resume the journaled deployment and update local public addresses after verification. Build contracts first with `forge build`. The journal rejects a different signer or changed build.
