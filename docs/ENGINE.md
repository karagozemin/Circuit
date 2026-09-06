# Circuit Engine

`CircuitEngine` is the P0 policy and state-machine core. It stores the canonical manifest hash and immutable bounded config, binds each round to an authoritative BinaryMarket/Pool tuple, and accepts market evidence only through the configured Reactivity handler.

## State Flow

```text
VALIDATED -> ARMED -> TRIGGERED -> ORDER_SUBMITTED -> WAITING_RESOLUTION
                 ^                                      |
                 |                                      v
                 +--------- ROLLING <-------------------+

Any active state -> PAUSED -> prior active state
Any non-terminal state -> CANCELLED
Policy limit -> STOPPED
```

## Enforced Invariants

- non-zero hard capital cap and per-order cap;
- maximum rounds, consecutive-loss stop and rollover limit;
- exact `marketId`, market, pool, collateral and outcome-token binding;
- on-chain `Trading` status and expiry buffer before each write;
- trigger, slippage and remaining-budget checks using integer fixed-point math;
- IOC-only BUY UP / BUY DOWN placement;
- callback and action replay protection;
- risk accounting from actual owner balance deltas, not requested quantity;
- owner-controlled activation, pause and automatic-rollover consent; authenticated handler callbacks and bounded permissionless execution/sync;
- atomic Engine-to-handler market binding, so strategy owners never need handler-admin authority;
- rejection of attempts to replace another strategy's active pool binding;
- reentrancy protection around the external pool call.

## Execution Paths

The engine retains a bounded `placeBinaryOrderFor` adapter for a future dreamDEX-approved system-contract deployment. On Shannon, an arbitrary contract currently reverts that delegated call with `OnlyApprovedContracts()`; the autonomous keeper therefore uses the linked smart-account path.

The current browser path does not use delegated execution. Once a strategy is armed, the Live screen exposes a bounded manual execution probe that calls `@somnia-chain/markets-sdk` with the connected `WalletClient`; the SDK sends the user's own `placeBinaryOrder` transaction and handles the pool approval flow. Each order remains explicitly wallet-signed. This preserves non-custody, but the probe does not mutate Engine cumulative accounting or autonomously advance its state; the keeper instead calls the Engine through the linked smart account.

For the PRD-aligned autonomous path, deploy `CircuitSmartAccount(owner, engine)`, then use the activation review's `Prepare account` action. The connected owner signs only the missing testnet collateral faucet/transfer and an exact current-pool allowance through `account.execute`. The owner links it with `setExecutionAccount(strategyId, account)`. The Engine's policy checks remain in force, while the pool sees the smart account as `msg.sender` and therefore does not apply the foreign-contract allowlist to `placeBinaryOrder`.


## Resolution and backstop

The immutable BinaryMarketsModule validates market records at binding. Both first and successor bindings must match the configured cadence. Successors must have a later expiry and preserve collateral/outcome singleton; old emitter bindings are removed.

The handler subscribes to `StatusChanged(uint8,uint8)` from the bound BinaryMarket. Its payload only wakes the Engine. The Engine independently reads resolution/void flags and the payout vector, approves exactly its recorded ERC-6909 position to the module, redeems it through the user-owned account and measures actual collateral proceeds before calculating rollover. Callers cannot supply a winner or proceeds.

`syncStrategy(strategyId, marketId)` exposes the same settlement path permissionlessly. Paused strategies do not advance; duplicate sync is a no-op. An expired untriggered window or a no-fill order is SKIPPED and does not increment losses. A void redeems its actual payout and preserves the existing loss counter. The account cannot be swapped while a tracked position is open.

With explicit owner consent, `rollToNextMarket` allows a keeper to bind an authenticated successor from the same creator, asset and cadence, revoke the previous pool allowance and grant exactly the next-round budget. See [keeper operations](AUTOMATION.md).
