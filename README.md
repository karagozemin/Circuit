<p align="center">
  <img src="./circuit_logo.png" alt="Circuit" width="320" />
</p>

# Circuit

Programmable, bounded strategies for dreamDEX Event Contracts.

Circuit compiles a visual or natural-language strategy into a deterministic manifest, shows the risk envelope before activation, and progresses through rolling dreamDEX markets using Somnia on-chain Reactivity.

## Current Status

The lifecycle implementation and current verification limits are tracked in [acceptance evidence](docs/ACCEPTANCE.md). The complete live PRD Definition of Done is still open. See [keeper operations](docs/AUTOMATION.md) for event-driven execution, settlement sync and owner-run rollover.


The repository contains:

- a working React strategy builder and risk review surface;
- canonical Strategy Manifest v1 validation;
- live BTC/ETH Event Contract discovery through `@somnia-chain/markets-sdk`;
- chain-head status and expiry gating before activation;
- a bounded IOC order dry-run and guarded broadcast script;
- a browser wallet execution path that sends bounded manual IOC orders through `@somnia-chain/markets-sdk` and asks the connected wallet to sign;
- a live BinaryPool authorization diagnostic;
- a Solidity Reactivity handler with emitter/topic validation and callback idempotency;
- a `CircuitEngine` with manifest anchoring, market binding, risk caps, state transitions, replay protection, IOC execution and actual-balance accounting;
- deterministic frontend manifest hashing and Solidity config encoding.
- real injected-wallet connection with account restoration, STT balance, Shannon network switching, account/chain event handling and local disconnect.
- a receipt-driven activation review that creates the strategy, atomically binds the live market and handler, creates the on-chain Reactivity subscription, then arms the strategy;
- a user-owned `CircuitSmartAccount` path: the account can be linked to a strategy, prepared from the activation review with explicit owner-signed funding/approval transactions, and called by the Engine for a bounded direct BinaryPool `placeBinaryOrder` and exact-position module redemption;
- real owner-signed pause and resume transactions with explorer-linked receipts;
- a deterministic Engine/handler Shannon deployment script with post-deploy wiring verification.

The UI does not present local simulation as a completed on-chain strategy. `Activate` requires a real connected Shannon wallet, verified live market, deployed Engine/handler bytecode, a deployed user-owned smart account linked to that Engine, correct wiring and the 32 STT Reactivity minimum. The activation review exposes `Prepare account` when collateral or the current-pool allowance is missing; it requests only the manifest's max order amount through explicit owner-signed transactions. The live “Send SDK IOC” action remains available as a bounded manual probe; it does not mutate Engine accounting.

## Run

```bash
npm install
npm run dev
```

Open `http://localhost:5173`.

## Deploy and Configure

```bash
npm run contracts:deploy
npm run smart-account:deploy
```

The command reads `CIRCUIT_OPERATOR_PRIVATE_KEY` from the Git-ignored `.env.local`, then prints the deployed addresses and transaction hashes. Put only the public addresses in the same local frontend configuration:

```bash
VITE_CIRCUIT_ENGINE_ADDRESS=0x...
VITE_CIRCUIT_HANDLER_ADDRESS=0x...
```

Then restart Vite. The frontend activation review uses the public addresses only; no operator key is bundled into the browser. Never put the deployer key in a `VITE_*` variable.

`smart-account:deploy` creates one account owned by the deployer address and restricted to the deployed Engine. Copy its `VITE_CIRCUIT_SMART_ACCOUNT_ADDRESS` output into `.env.local`, restart Vite, connect that owner wallet, choose an eligible live market, and use `Prepare account` in the activation review. Circuit then requests only the missing tUSDC funding and current-pool approval before activation.

The current Shannon deployment and receipt references are recorded in [`deployments/shannon.json`](deployments/shannon.json). The linked smart-account path does not require dreamDEX delegated-operator allowlisting. Current subscription IDs, funding/approval receipts and explicit missing live callback/settlement evidence are recorded there.

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
