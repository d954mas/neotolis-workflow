# ntwork implementation report

- Date: 2026-09-02
- Baseline and current HEAD: `54460a730521fa0d1707ad73208f4d500710d511`
- Status: implemented and locally verified; intentionally uncommitted and not
  release-ready.

## Delivered

- Runtime and CLI for `plan-approved` through passive `delivery-ready`.
- Exact Git branch/HEAD and cleanliness boundaries without a tree fingerprint.
- Sequential task selection, scoped pre-commit evidence, independent task review,
  dedicated task/fix commits, interrupted-task reuse, and red-CI repair.
- Whole-plan validation plus independent Nyquist, specification/integration, and
  code review; negative gates are sticky only for the same revision.
- Atomic plan-amendment validation and strict, user-confirmed recovery from its
  durable boundary.
- Native Claude Code and Codex skills, five ntwork roles per provider, manifests,
  checked bundles, deterministic installation fixtures, and complete parity tests.

Telemetry, `ntstats`, `ntreflect`, automatic delivery, and a lightweight quick
path remain outside this slice.

## Verification

| Gate | Result |
| --- | --- |
| Full `npm run verify` | 248 total; 247 pass; 1 platform skip |
| Packaging verification | 5/5 |
| Focused ntwork | 25/25 |
| E2E | 15/15 |
| Focused conformance | 2/2 |
| Provider tests | 42/42 |
| `git diff --check` | Pass |

The skip is the existing Windows platform case for a cwd that cannot be
traversed. Deterministic verification makes no live-model quality claim.

## Independent review and criticism

Exactly three read-only agents reviewed the slice. All returned final PASS.

1. Simplicity and reference alignment removed excess ceremony: no Git-tree hash,
   uncontracted evidence verdict, new operation, state, registry, or fallback.
2. Architecture and recovery verified ordinary interrupted-task commit reuse while
   rejecting ambiguous direct-child amendment recovery without mutation.
3. Correctness and evidence verified durable amendment restart, state/Git agreement,
   user-controlled interruption, scoped evidence, independent PASS review, and
   revision-aware CI/final gates.

Material findings fixed during convergence also included atomic amendment
reconciliation, red-CI placement, first-task evidence rejection, delivery-ready
diagnosis ordering, all seven Codex role registrations, read-only Claude reviewer
tools, structured provider normalization, negative edge tests, and exact checked
bundle synchronization.

## Reference and competitor comparison

| Reference | Retained | Simplified or omitted |
| --- | --- | --- |
| GSD | Ordered phases, durable state, acceptance ownership, Nyquist validation, independent reviews | Milestones, roadmaps, waves, central orchestration, separate validation artifact |
| Matt Pocock / Superpowers | Falsifiable acceptance, verifiable tasks, compact grilling, inline self-review | Added durable ownership, state, and recovery for long-running work |
| Spec Kit | SPEC → PLAN → task structure and structural validation | Broader intake and template ceremony |
| OpenSpec | Explicit change specification and reviewable task boundary | Registry and extended exploration layers |
| BMAD | Deliberate phase/document boundaries | Product-document ceremony beyond the task contract |
| `game-67-idle` | Local measurement direction and evidence discipline | Fixed project pipeline; telemetry remains future work |

The comparison is based on authoritative local contracts and the synthesis in
`PROJECT.md`. `.ntworkflow/DESIGN-REFERENCES.md` is referenced by the project but
absent from this checkout; no external or missing-source claim is treated as
verified evidence. Five ntwork supporting roles are heavier than a normal coding
flow, but match the confirmed boundary for large, decision-heavy tasks.

## Live-provider boundary

Deterministic provider installation and discovery passed. A Claude model launch
was blocked by host safety before model execution. The Codex model run was aborted
by the user before it produced evidence. The installed packages also predate the
last review fixes. Therefore no end-to-end live ntwork success or exact-byte model
evidence is claimed.

Release remains blocked until explicit authorization permits live smoke against
the final package bytes and a fresh release commit passes Windows, Ubuntu, and
macOS CI. The failed/aborted attempts were not retried, repaired, or counted green.

## Release artifacts

- `build/release/npm/neotolis-workflow-0.0.0.tgz` — SHA-256:
  `17E0D091A3C964A409CB58B09D459208178271C6AAB55356D18A2E4F6B647857`
- `plugins/claude-code/runtime/ntworkflow.mjs` and
  `plugins/codex/runtime/ntworkflow.mjs` — SHA-256:
  `10C6B0FF73491D6EE492E469FF3211A1BD20924C42C74EC390B638F2CA116AD8`
- Claude ntwork skill — SHA-256:
  `8BF1D17D1879FC335A499896C5B096BBC6F0ED013D73B0DD01AC3B95221032F8`
- Codex ntwork skill — SHA-256:
  `6D1A393C9E1757FF3ED20ECA4DEFFC3B1E0C19BFAD7ECAC9B6F4331DE328388B`

No commit, push, merge, publication, or release was performed. All ntwork changes
remain local and uncommitted on the exact baseline HEAD.
