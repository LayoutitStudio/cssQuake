# cssQuake Harness Guide

Use `package.json` as the canonical command menu. Local files under ignored `scripts/` are exploratory unless the user names them or a committed runner points to them.

| Situation | Command | Notes |
| --- | --- | --- |
| Code-only TS/CSS/runtime change | `pnpm test:dev && pnpm build` | no shared asset prepare |
| Generated asset or manifest concern | `pnpm test:assets` | requires ready prepared assets |
| Browser startup/link concern | `pnpm test:browser:smoke` | requires ready prepared assets |
| Browser gameplay fixture concern | `pnpm test:browser` | heavier; requires ready prepared assets |
| Unsure which gate applies | `pnpm test:harness` | dry-run planner from current changed files |
| Perf claim or monster-render work | `pnpm test:perf`, then an explicit ignored local perf harness command if needed | read `notes/monster-render-spike.md` first when present; package gates do not run ignored scripts |
| Source/gameplay parity concern | use the named committed oracle runner | keep oracle scope narrow |

## Gate Meanings

- `pnpm test`: fast contract tests.
- `pnpm test:asset-state`: manifest/status/process preflight for prepared assets.
- `pnpm test:assets`: manifest and prepared scene integrity.
- `pnpm test:browser:smoke`: fast URL/API browser smoke.
- `pnpm test:browser`: explicit browser gameplay fixtures from committed fixture definitions. Use `pnpm test:browser -- --list`, `pnpm test:browser -- --family <name>`, or `pnpm test:browser -- --fixture <id>` for focused runs.
- `pnpm test:harness`: dry-run changed-file planner that prints exact recommended committed gates.
- `pnpm test:perf`: no-asset preflight for the committed perf command surface and harness guidance.
- `pnpm test:dev`: normal no-asset confidence gate.
- `pnpm test:all`: all committed stable gates that require prepared assets, including browser fixtures.

Prepared-asset gates must not run shared asset prepare. If assets are missing, regenerating, or a shared prepare is active, report the environment/prep issue and stop.

Committed runners should print what they validate, prerequisites, whether they require prepared assets, artifact paths, and whether failures are likely product behavior, missing prepared assets, or local environment.

## Contract Test Layout

`pnpm test` discovers `test/**/*.test.mjs`. Keep standalone contract tests under broad domain folders: `test/gameplay/` for Quake/game rules and combat behavior, and `test/runtime/` for app/runtime presentation, input, preload, and scheduling behavior. Use a feature folder when related tests need shared builders or protocol fixtures.

Multiplayer contract tests live under `test/multiplayer/`. Use `test/multiplayer/harness.mjs` for room keys, protocol envelopes, loopback sessions, authoritative player fixtures, input fixtures, correction defaults, and message lookup helpers. Do not duplicate those builders in individual multiplayer tests.

## Browser Coverage

`pnpm test:browser` is selective, not exhaustive. It currently covers committed DOM monster visibility, combat budget caps, logical weapon targetability, player rocket fire/touch behavior, forced enemy projectile chains for ogre/wizard/zombie, ogre grenade bounce and timeout lifecycle, zombie projectile world-stop, map trigger/target/mover logic, liquid damage, and pickup gameplay fixtures.

Browser gameplay fixtures are assembled in `test/browser/browserFixtureDefinitions.mjs`; family implementations live beside it as `test/browser/browserFixture*.mjs`. `test/browser/runBrowserFixtures.mjs` is the only committed gameplay-fixture runner.

Browser fixture files should use `test/browser/fixtureHarness.mjs` for fixture metadata, debug-page open/close lifecycle, page-error assertions, and small shared fixture utilities. Prepared asset readers for tests live in `test/assets/preparedAssets.mjs`; keep generated asset path knowledge there instead of duplicating `build/generated/public` paths in browser fixtures.

Current fixture families:

| Family | Command | Covers |
| --- | --- | --- |
| `monster` | `pnpm test:browser -- --family monster` | representative monster DOM visibility |
| `combat` | `pnpm test:browser -- --family combat` | combat budget and logical targetability |
| `projectile` | `pnpm test:browser -- --family projectile` | player and enemy projectile fixture paths |
| `map-logic` | `pnpm test:browser -- --family map-logic` | trigger/mover, liquid, and pickup gameplay |

Current fixture IDs:

| Fixture ID | Covers |
| --- | --- |
| `monster-dom` | representative monster DOM visibility and mounted leaves |
| `combat-budget` | combat budget caps and event-bound weapon target counters |
| `logical-targetability` | logical weapon damage against an unmounted combat-interest target |
| `rocket-fire` | player rocket projectile fire path |
| `rocket-touch` | player rocket direct/splash touch path |
| `ogre-grenade-chain` | forced ogre grenade attack chain |
| `ogre-grenade-bounce` | ogre grenade bounce impact behavior |
| `ogre-grenade-lifecycle` | ogre grenade timeout, explosion, and removal |
| `wizard-spike-chain` | forced wizard spike attack chain |
| `zombie-projectile-chain` | forced zombie projectile attack chain |
| `zombie-projectile-stop` | zombie projectile world-stop behavior |
| `map-logic` | trigger_multiple target dispatch, cooldown, refire, and mover activation |
| `liquid-damage` | liquid contents damage through debug gameplay pose |
| `pickup` | pickup stat deltas, removal, and repeat prevention |

Enemy projectile chain fixtures use debug-only hooks exposed through `window.__cssQuakeDebug` to force named QuakeC attack chains and step the enemy projectile runtime deterministically. Treat those hooks as harness surface, not normal gameplay API.

Debug poses with `{ gameplay: true }` synchronize the player controller origin and bypass the click-to-play pause gate only for the explicit debug gameplay sync. Use that shape for browser fixtures that need pickup, hazard, or trigger collision to run headlessly.

Mover/pusher browser coverage is intentionally deferred. The existing ignored local pusher fixture fails on the E1M4 train/knight crush watchpoint, so it should not become a committed acceptance gate until either the fixture expectation or product behavior is repaired.
