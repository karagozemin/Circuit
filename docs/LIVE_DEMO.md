# Verified Shannon lifecycle — 6 September 2026

The real lifecycle completed at **20:00:08 UTC (23:00:08 Istanbul)**. The Engine spent **1 tUSDC**, received **50 UP shares**, processed the real market's losing resolution, redeemed/burned its tracked position, and automatically armed **round 2** through a creator-authenticated successor. The owner then paused it and the keeper stopped. Final account balance: **1 tUSDC**. Old pool allowance: **0**. Successor allowance: **1 tUSDC**, exactly the computed budget.

[Watch the recorded demo](../deployments/evidence/live-demo/circuit-live-cycle.mp4) · [Open the standalone receipt viewer](../deployments/evidence/live-demo/index.html) · [Independent audit](../deployments/evidence/live-demo/audit.json) · [Full proof](../deployments/evidence/live-demo/proof.json)

The video is a real browser recording of the receipt dashboard, accelerated **20×** and labelled accordingly. It starts after the fill and shows the earlier activation/callback/order receipts, then captures the actual live resolution and successor transition. It is not a synthetic oracle simulation or a recording of wallet activation clicks.

| Step | Shannon transaction | Block |
| --- | --- | --- |
| Activation | [0x218f4458127f…](https://shannon-explorer.somnia.network/tx/0x218f4458127fc889f2b2984c98681dca0d25df1d0a2f2de866d052047cc35159) | 481502573 |
| Fill callback and trigger | [0xfe816d658814…](https://shannon-explorer.somnia.network/tx/0xfe816d6588142202de86143f2c23a00411b51c768df2d81d2a25ff52a67a37e4) | 481502584 |
| Automatic IOC: 1 tUSDC → 50 UP | [0xb9561543c783…](https://shannon-explorer.somnia.network/tx/0xb9561543c7839b00691ffd62e488a7e497bbefd56edda18f721ec20d37c15d91) | 481502623 |
| Resolution callback and redeem: LOSS, 0 proceeds | [0xf606387aeda8…](https://shannon-explorer.somnia.network/tx/0xf606387aeda808c1906132412b62d21d9d6f767a385259923c6e3a0e6401e776) | 481516450 |
| Verified successor, round 2, exact pool approval | [0xec259cfe0e4c…](https://shannon-explorer.somnia.network/tx/0xec259cfe0e4cdc5d9d8936e5e6c040fd391c431786932d757a6069621bcf078d) | 481516509 |

Strategy: `0x20844a8dbeb64ffcdcfaa1d1934b2228358f0cd515e1ec1ed732fc93a88f67f1`. Engine: `0x4534f1b19fbf7a42df52b33309881cb4e359569a`.

The fixture explicitly approves BTC 1h, BUY_UP when the verified UP fill is below 0.70, a 1 tUSDC order cap, a 2 tUSDC capital cap, and two rounds. It used an already-running window and real public book liquidity. The seed trade and strategy signer are owner controlled; all amounts are test collateral. An earlier above-0.70 fixture was cancelled without an Engine position after its maker order matched existing public asks; its attempt receipts are retained. The demo also exercised pause/resume and keeper restart without duplicate spending.

The receipt audit matches the actual seed fill data/topics to the handler callback transaction, verifies bounded Engine execution and successful receipts, reads the final paused state and checks exact old/new allowances. Settlement source: **reactivity callback**. The proof distinguishes the round-2 ARMED snapshot from the final PAUSED state. Subscription-shape and shutdown errors from the earlier run are retained as recovered history.

To independently recheck the evidence (read-only RPC calls; local report writes):

```bash
node --env-file=.env.local --import tsx scripts/finalize-live-evidence.ts
node --import tsx scripts/serve-demo.ts --export
```

This proves the requested live cycle. The live market resolved LOSS; it does not establish live winning redemption or void acceptance. See [the remaining PRD checks](ACCEPTANCE.md).
