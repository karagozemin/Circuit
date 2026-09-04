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
- a receipt-driven activation review that creates the strategy, atomically binds the live market and handler, creates the on-chain Reactivity subscription, then arms the strategy;
- real owner-signed pause and resume transactions with explorer-linked receipts;
- a deterministic Engine/handler Shannon deployment script with post-deploy wiring verification.

The UI does not present local simulation as a completed on-chain strategy. `Activate` requires a real connected Shannon wallet, verified live market, deployed Engine/handler bytecode, correct wiring, the 32 STT Reactivity minimum, and a passing dreamDEX BinaryPool operator probe. Missing deployment configuration or system allowlisting is shown as a blocking preflight result and no wallet write is requested.

## Run

```bash
npm install
npm run dev
```

Open `http://localhost:5173`.

## Deploy and Configure

```bash
CIRCUIT_OPERATOR_PRIVATE_KEY=0x... npm run contracts:deploy
```

The command prints the deployed addresses and transaction hashes. Put only the public addresses in local frontend configuration:

```bash
VITE_CIRCUIT_ENGINE_ADDRESS=0x...
VITE_CIRCUIT_HANDLER_ADDRESS=0x...
```

Then restart Vite and run the read-only authorization proof printed by the deploy command. The Engine must pass dreamDEX's BinaryPool system-contract gate before the activation review enables writes. Never put the deployer key in a `VITE_*` variable.

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
