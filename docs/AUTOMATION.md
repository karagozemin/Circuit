# Running the keeper

Build/deploy the current contracts and configure the server-only signer in the ignored `.env.local`. The keeper reads immutable on-chain strategy config; it does not compile prompts or choose risk limits.

```bash
CIRCUIT_STRATEGY_IDS=0xYOUR_CONFIRMED_STRATEGY_ID npm run keeper -- --once
CIRCUIT_STRATEGY_IDS=0xYOUR_CONFIRMED_STRATEGY_ID npm run keeper -- --execute
```

The first command only simulates. The second signs bounded Engine transactions and required on-chain subscriptions. The signer needs testnet gas and 32 STT for subscription creation. Never put its key in a `VITE_*` variable.

The daemon listens for Engine events over WebSocket and reconciles every 30 seconds as a liveness backstop. On restart it reads the current Engine state. Engine action keys prevent duplicate spending. Pending/successful receipts and observed state are written to `deployments/evidence/keeper.jsonl`; subscription IDs are persisted by emitter/topic. Preserve these files across restarts and use one daemon per signer to avoid nonce contention.

An ordinary keeper can call `executeReadyAction` and `syncStrategy`. With the owner's explicit `setAutomaticRollover(strategyId, true)` authorization, it can also call `rollToNextMarket`. Activation requests this authorization before arming. The handler authenticates creator `MarketCreated` callbacks against the module registry; the engine requires the same creator, asset and cadence. Rollover revokes the old pool allowance and grants the new pool only the next-round budget. Pause or disable automatic rollover to stop this progression.

The keeper subscribes to fills, resolution and creator events. It discovers authenticated successors from handler events, simulates the transition, then subscribes and rolls. No further owner signature is required for an authorized successor. Fund the account for the approved capital envelope before running multiple rounds; the daemon does not faucet or fund automatically.

The optional `--owner-rollover` fallback remains available for strategies without automatic authorization, but requires the configured signer to be the strategy owner.

A missed resolution callback is recovered by permissionless `syncStrategy(strategyId, marketId)`, using the bound market's settlement state. An expired ARMED/TRIGGERED window advances as SKIPPED. A missed fill callback is not replaced by an unverified off-chain price.

The current real-network demo in `deployments/shannon.json` is activated. Consult `liveLifecycle` and its linked proof for its observed state; initial preparation balances and allowances are historical snapshots. Pool approvals are specific to each window.

## Evidence and limitations

See [acceptance evidence](ACCEPTANCE.md). A successful subscription receipt is not proof that its callback ran. A local Anvil/Forge trace is not live testnet evidence. Do not run `prepare-live-evidence.ts` repeatedly to retry an interrupted preparation: inspect its receipt journal and existing strategy/subscriptions first.
