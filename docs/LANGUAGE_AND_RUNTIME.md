# Circuit: strategy language, compiler and runtime

> Circuit gives Event Contracts a programmable strategy language.

The demo should make that statement inspectable: change a graph, break a connection, show a compiler error, repair it, inspect the emitted manifest and run different programs through the same Engine. The optional intent assistant drafts rules; it is not the product's execution authority.

## Claims and evidence

| Claim | Inspectable evidence | Scope |
| --- | --- | --- |
| Graph editing changes the program | Node/port editor, persisted graph document and compilation invalidation | Supported v1 grammar |
| The compiler is real | `src/lib/graph.ts`, exact graph → manifest → Engine adapter tests, manifest hash | Rejects missing stops, disconnected branches and unsupported edges |
| One runtime runs different programs | [Three-program experiment](../deployments/evidence/local-three-programs.json) | One Engine instance, three different manifests, eight settled rounds; local mocks |
| Outcome rules affect execution | Recorded order budgets: Contrarian 10 → 2 → 10; Ladder 5 → 7.5 → 10; Streak 3 → 2 | Fixture fills/outcomes; actual spending recorded separately |
| Reactivity drives real transitions | [Historical live audit](../deployments/evidence/live-demo/audit.json) | A recorded Shannon lifecycle; not live proof for all three programs |
| The user owns execution constraints | Contract checks on order budget, cumulative spending, rounds and losses | Deterministic enforcement, explicit wallet authorization |

## Reproduce the shared-runtime experiment

```bash
npm install
npm run test:programs
```

Foundry/Anvil must be installed. The script starts an isolated localhost chain (31337), generates a temporary test signer, deploys one Engine and handler, compiles the three shipped graphs, and dispatches simulated validator callbacks through the real handler code. It does not load `.env.local`, use an existing wallet, call public RPCs or send live transactions. The local process is stopped when the experiment finishes.

Each program has its own smart account and market fixtures. The experiment is sequential; it does not establish concurrent multi-user service capacity. The single-session browser UX remains unchanged. This is correctness evidence, not a throughput, returns or liquidity benchmark.

The JSON contains the input graph, compiled manifest, hash verified on the Engine, strategy ID, local transaction hashes, per-round budget/spend, settled position checks and final stop reason. The script checks the Engine's `StrategyStopped` receipt and corresponding state: Ladder reaches its three-round limit, Contrarian reaches two consecutive losses, and Streak stops on its first loss. Before execution the compiler must also reject a deliberately disconnected loss branch. The script exits with an error on any failed invariant.

## Language boundary

The current implementation is a domain-specific, bounded language. Its compiler accepts one MARKET, CONDITION, BUY, WIN/LOSS, ROLL and STOP node with typed connections and a STOP-guarded next-window loop. Programs differ in entry predicates, direction, sizing progression and stop rules.

The graph is editable; the grammar is deliberately constrained. Arbitrary DAGs, nested/multiple conditions, concurrent orders, user-defined instructions and a general-purpose bytecode interpreter are not implemented. Three working programs demonstrate reusable execution within this language; they do not establish arbitrary computation or unrestricted composability.

## Jury delivery

Lead with the editable graph and a deliberate compile failure, then the actual manifest and its hash. Show the three-program proof with its local/mock label. Close with separately labelled real Shannon receipts. Prefer these inspectable artifacts over exclusivity claims about what other teams can or cannot do.
