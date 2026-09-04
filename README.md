# Circuit

Programmable, bounded strategies for dreamDEX Event Contracts.

Circuit compiles a visual or natural-language strategy into a deterministic manifest, shows the risk envelope before activation, and progresses through rolling dreamDEX markets using Somnia on-chain Reactivity.

## Current Status

The repository contains:

- a working React strategy builder and risk review surface;
- canonical Strategy Manifest v1 validation;
- live BTC/ETH Event Contract discovery through `@somnia-chain/markets-sdk`;
- chain-head status and expiry gating before activation;
- a bounded IOC order dry-run and guarded broadcast script;
- a narrow `placeOrderFor` operator diagnostic;
- a Solidity Reactivity handler with emitter/topic validation and callback idempotency.

The UI simulation is not presented as a completed on-chain strategy. Real activation remains blocked until the engine, permissions and Reactivity subscription are deployed and verified.

## Run

```bash
npm install
npm run dev
```

Open `http://localhost:5173`.

## Verification

```bash
npm run build
npm test
npm run typecheck:tools
npm run contracts:test
npm run spike:discover
npm run spike:order -- --side=DOWN
```

The order spike is dry-run only unless `--execute` is explicitly passed. Never expose a private key in a `VITE_*` environment variable.

See [the integration spike](docs/INTEGRATION_SPIKE.md) for network configuration, observed failure modes, operator checks and the Reactivity subscription flow.

## Product Scope

The implementation follows `Circuit_PRD_v1.0_LOCKED.md`. P0 remains the only active scope until all acceptance criteria pass.
