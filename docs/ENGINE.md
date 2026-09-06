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
- owner-only lifecycle controls and handler-only event transitions;
- atomic Engine-to-handler market binding, so strategy owners never need handler-admin authority;
- rejection of attempts to replace another strategy's active pool binding;
- reentrancy protection around the external pool call.

## Execution Paths

The engine retains a bounded `placeBinaryOrderFor` adapter for a future dreamDEX-approved system-contract deployment. On Shannon, an arbitrary contract currently reverts that delegated call with `OnlyApprovedContracts()`; this is why `deployments/shannon.json` records delegated authorization as pending.

The current browser path does not use delegated execution. Once a strategy is armed, the Live screen exposes a bounded manual execution probe that calls `@somnia-chain/markets-sdk` with the connected `WalletClient`; the SDK sends the user's own `placeBinaryOrder` transaction and handles the pool approval flow. Each order remains explicitly wallet-signed. This preserves non-custody, but the probe does not mutate Engine cumulative accounting or autonomously advance its state; that still requires the delegated path.

For the PRD-aligned autonomous path, deploy `CircuitSmartAccount(owner, engine)`, then use the activation review's `Prepare account` action. The connected owner signs only the missing testnet collateral faucet/transfer and an exact current-pool allowance through `account.execute`. The owner links it with `setExecutionAccount(strategyId, account)`. The Engine's policy checks remain in force, while the pool sees the smart account as `msg.sender` and therefore does not apply the foreign-contract allowlist to `placeBinaryOrder`.
