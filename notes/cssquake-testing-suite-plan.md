# cssQuake Testing Suite Plan

Keep the suite small enough to run, but strong enough to catch the regressions cssQuake actually gets.

## Commands

Use these as the source of truth:

```sh
pnpm test
pnpm test:assets
pnpm test:all
pnpm test:browser
pnpm test:perf
```

What they mean:

- `pnpm test`: fast non-browser contracts. This is the everyday command.
- `pnpm test:assets`: generated asset integrity. This checks existing assets but does not regenerate them.
- `pnpm test:all`: build plus contracts, assets, and the fast URL browser smoke.
- `pnpm test:browser`: expensive browser gameplay fixtures. Run before gameplay/runtime claims.
- `pnpm test:perf`: performance preflight only. Real traces still need explicit commands and notes.

## Coverage

### Fast Contracts

`pnpm test` runs:

- route and `view=` parsing
- save/load schema handling
- inventory and weapon-selection rules
- source-backed movement constants
- multiplayer protocol validation
- QuakeC fact and runtime audits for program facts, game logic, preloads, shootables, pickups, triggers, and movers

Rules:

- Use Node's built-in `node:test`.
- Keep tests pure when possible.
- Do not start a browser.
- Do not regenerate assets.

### Asset Integrity

`pnpm test:assets` checks:

- manifest exists and is ready
- map entries resolve to scene JSON
- scene JSON includes entity manifest, game logic, collision, and render bundle data
- game logic model and sound preloads cover runtime references

Rules:

- Never run `pnpm prepare:quake` as a side effect.
- If assets are missing or regenerating, fail with an asset-specific error.
- Keep Playwright out of this command.

Run render parity only when render-bundle output matters:

```sh
node scripts/smokeRenderBundleParity.mjs
```

### Browser Gameplay

`pnpm test:all` includes the fast URL/debug browser smoke.

`pnpm test:browser` runs:

- 9 representative monster DOM poses
- 9 monster combat cases
- pickup fixture
- pusher fixture
- elevator/platform carry fixture

Rules:

- Browser summaries go under ignored `bench/results/quake/`.
- Prefer deterministic debug poses over long manual movement chains.
- Keep this out of the default `pnpm test`.

### Performance

`pnpm test:perf` only proves the trace setup and monster-render ledger are present.

For real performance claims:

1. Add or update a row in `notes/monster-render-spike.md`.
2. Run A/A if noise could hide the result.
3. Run the exact before/after trace commands.
4. Put artifacts under `bench/results/quake/`.
5. State accepted, rejected, or probe only.

## When To Run

| Change area | Run |
| --- | --- |
| Docs/copy | `pnpm build` |
| Pure route/save/inventory/protocol logic | `pnpm test` |
| Asset or preload behavior | `pnpm test`, `pnpm test:assets` |
| Startup URL behavior | `pnpm test:all` |
| Gameplay runtime behavior | `pnpm test:all`, `pnpm test:browser` |
| Render-bundle output | `pnpm test:assets`, `node scripts/smokeRenderBundleParity.mjs` |
| Performance claims | `pnpm test:perf`, then explicit trace workflow |

## Done Criteria

The suite is sane if:

- `pnpm test` is fast and non-browser.
- `pnpm test:all` is the normal confidence gate.
- expensive browser and trace checks are explicit.
- failures say whether the problem is contract logic, assets, browser gameplay, or performance setup.
- local probes stay ignored; suite scripts are tracked.
