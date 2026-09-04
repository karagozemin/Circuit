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
- reentrancy protection around the external pool call.

## External Authorization Requirement

The current Shannon BinaryPool exposes `placeBinaryOrderFor`, but live simulation from an arbitrary contract reverts with `OnlyApprovedContracts()`. Unlike SpotPool, BinaryPool does not use the user-managed OperatorPermissionsRegistry. Circuit must be approved by dreamDEX as a system contract, or dreamDEX must provide another supported binary delegation rail, before this adapter can execute non-custodially.

The repository deliberately does not substitute custody, pooled funds or an unrestricted hot key for that missing authorization.
