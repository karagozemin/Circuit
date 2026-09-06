# Circuit Integration Spike

Verified against the official packages and Somnia Shannon Testnet on 4 September 2026.

## Locked Runtime Configuration

- Chain: Somnia Shannon Testnet (`50312`)
- RPC: `https://api.infra.testnet.somnia.network`
- Fallback RPC: `https://dream-rpc.somnia.network`
- WebSocket RPC: `wss://api.infra.testnet.somnia.network/ws`
- dreamDEX indexer: `https://dev.smk.somnia.host/v1/graphql`
- Markets SDK: `@somnia-chain/markets-sdk@0.29.0`
- Reactivity SDK/contracts: `0.2.1`
- Spot `placeOrderFor` selector: `0x80054449`
- Binary `placeBinaryOrderFor` selector: `0x5d97c566`

Contract addresses come from `SOMNIA_TESTNET_ADDRESSES`. Per-window market and pool addresses never do: they are resolved for each market ID.

## Proven Read Path

Run:

```bash
npm run spike:discover
```

The command:

1. fetches live BTC 15m candidates from the indexer;
2. reads the Shannon block timestamp;
3. re-reads each candidate from `BinaryMarketsModule` through the SDK;
4. requires on-chain status `1` (`Trading`);
5. enforces the 120-second expiry buffer;
6. resolves the current market, pool, collateral and outcome symbols;
7. reads the current YES order book.

The spike observed a real stale indexer row marked `Trading` whose on-chain status was already `2` (`Locked`). The implementation rejected it and selected the current on-chain Trading window.

The primary Shannon RPC also returned a transient `502` during verification. Public reads and subscription writes use the official backup endpoint through `viem` fallback transport.

## Bounded Order Dry Run and Wallet SDK Write

```bash
npm run spike:order -- --side=DOWN
```

This is dry-run only by default. It derives an IOC limit order from the current book and proves that worst-case spend stays under `CIRCUIT_MAX_COLLATERAL` (default `1`, hard script ceiling `10`). Broadcasting additionally requires `--execute` and `CIRCUIT_OPERATOR_PRIVATE_KEY`.

The browser uses the same unified SDK route with an injected `WalletClient`: `exchange.setSigner({ walletClient })` followed by `exchange.createOrder(symbol, 'limit', 'buy', quantity, limitPrice, { timeInForce: 'IOC' })`. For binary markets the SDK maps this to `placeBinaryOrder`, not `placeBinaryOrderFor`, and waits for the receipt. Collateral allowance or outcome-token operator approval is sent as a separate user-approved wallet transaction when needed.

## Binary Delegation Diagnostic

```bash
npm run spike:operator -- --owner=0x... --operator=0x...
```

This simulates `placeBinaryOrderFor` from the proposed engine address against a recent BinaryPool. It does not broadcast or require a private key.

SDK `0.29.0` introduced explicit binary placement kinds. Binary pools reject generic `placeOrderFor` with `UseBinaryPlacement`, so the PRD's documented SpotPool selector `0x80054449` cannot execute an Event Contract order. The deployed pool exposes `placeBinaryOrderFor` (`0x5d97c566`) but rejects an arbitrary engine with `OnlyApprovedContracts()` (`0x3fb0ba2e`). The direct wallet SDK route is different: it calls `placeBinaryOrder` as the wallet caller and does not require the Engine to be allowlisted.

The PRD-aligned autonomous alternative is `CircuitSmartAccount`: the user owns and funds the account, the Engine is its immutable executor, and the account forwards only the direct `placeBinaryOrder` selector. A session key can be granted one exact pool/selector until an expiry, so a relayer can submit a pre-approved action without custody of the user's key.

The engine keeps the non-custodial `placeBinaryOrderFor` adapter for a future dreamDEX system-contract approval. Until then, the browser's direct wallet SDK path is a supported manual execution probe, not an autonomous Engine action: it does not update Engine cumulative accounting or state. Circuit will not silently replace either path with pooled custody or an unrestricted hot key.

## Reactivity Handler

`CircuitReactivityHandler` inherits the official `SomniaEventHandler` implementation. It rejects non-precompile callers, checks the bound pool and `OrderFilled` topic, de-duplicates callbacks, decodes `fillPrice`, and forwards only the validated payload to `ICircuitEngine`.

Deploy and wire the Engine/handler pair with:

```bash
npm run contracts:deploy
```

The deploy command verifies the chain ID, deploy receipts, and Engine-to-handler pointer before printing the two public `VITE_CIRCUIT_*` values. Market binding is performed atomically by `CircuitEngine.bindMarket`; a strategy owner does not need handler-admin authority.

For a standalone subscription proof, create the real on-chain subscription with:

```bash
npm run spike:subscribe
```

The subscription script requires a funded owner with at least 32 STT and a deployed `CIRCUIT_HANDLER_ADDRESS`. It filters by the current pool and exact `OrderFilled` topic. The browser activation review performs the same subscription through the connected wallet and records the receipt and subscription ID.

## Remaining External Proofs

- Broadcast one funded BUY UP and BUY DOWN testnet IOC order and record actual fills.
- Deploy the handler, bind the active pool, create the on-chain subscription, and record one callback transaction.
- Obtain dreamDEX system-contract approval for the Circuit engine, then prove `placeBinaryOrderFor` passes the live authorization gate if autonomous Engine-side execution is required.

These steps require dreamDEX coordination, a funded testnet signer and deployed engine/handler addresses. No private key may be exposed through a `VITE_*` variable.
