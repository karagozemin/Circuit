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
- a live BinaryPool authorization diagnostic;
- a Solidity Reactivity handler with emitter/topic validation and callback idempotency;
- a `CircuitEngine` with manifest anchoring, market binding, risk caps, state transitions, replay protection, IOC execution and actual-balance accounting;
- deterministic frontend manifest hashing and Solidity config encoding.
- real injected-wallet connection with account restoration, STT balance, Shannon network switching, account/chain event handling and local disconnect.

The UI does not present local simulation as a completed on-chain strategy. `Activate` requires a real connected Shannon wallet and verified live market, then fails closed while the engine/subscription deployment is absent. The current BinaryPool deployment limits `placeBinaryOrderFor` to dreamDEX-approved system contracts; the user-managed operator registry documented for SpotPool does not authorize Circuit for Event Contracts. Real activation therefore requires dreamDEX to allowlist the engine (or publish a supported binary delegation path), followed by deployment and a funded testnet proof.

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

See [the integration spike](docs/INTEGRATION_SPIKE.md) for network configuration, observed failure modes, authorization checks and the Reactivity subscription flow. See [the engine notes](docs/ENGINE.md) for state-machine and risk invariants.

## Product Scope

The implementation follows `Circuit_PRD_v1.0_LOCKED.md`. P0 remains the only active scope until all acceptance criteria pass.
