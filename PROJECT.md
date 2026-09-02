# Neotolis Workflow

## Status

Contract design is confirmed. TB-01–TB-11 and the separate `ntgrill` slice are
merged through `cde0eab1fdd4fd576fc4dd98da7c570ccf559df4`; the local baseline for
this work is `54460a730521fa0d1707ad73208f4d500710d511`. The uncommitted working
tree implements `ntplan` and the separate `ntwork` slice: `plan-approved` →
sequential task commits with scoped evidence and independent review → whole-plan
validation and three final review gates → applicable CI decision → passive
`delivery-ready`. Its bounded plan is
[implementation/NTWORK.md](implementation/NTWORK.md). Four of the six skills
are implemented. Telemetry, `ntstats`, and `ntreflect` remain unimplemented;
the working-tree changes require fresh CI and exact-byte live-provider smoke.

## Goal

Build a compact, provider-neutral development workflow inspired by GSD, Matt
Pocock's skills, and the measured workflow in `game-67-idle`.

The workflow must preserve GSD's ordered phases and review discipline without
requiring its milestone and roadmap layer.

## Scope boundary

Neotolis Workflow is deliberately a rigorous workflow for large, complex, or
decision-heavy development tasks whose planning, execution, and verification
benefit from durable state, fresh sessions, and independent review.

Small, routine, or already well-scoped changes are outside this workflow. They
should use the provider's normal lightweight coding flow or another suitable
process. Neotolis does not provide a quick path and does not weaken its phase
contracts for small work; invoking it means choosing the full rigorous flow.

## Confirmed constraints

- Support both Claude Code and Codex.
- Store workflow runtime data in `.ntworkflow/`. Whether that directory is
  tracked or ignored by Git is entirely the user's choice. Do not use
  `.planning/`, which belongs to GSD.
- Keep durable current state, specifications, plans, task packets, and session
  telemetry on local disk. Derive metrics on demand.
- Start every major phase in a fresh main session.
- Use a set of phase skills rather than one monolithic skill.
- Let each phase skill validate workflow state before it runs.
- Use a small CLI as the source of truth for state and legal transitions.
- Keep one primary agent in the user-facing phase session. It owns synthesis,
  decisions, and the canonical phase artifact.
- Configure models and reasoning for supporting agents owned by phases, not for
  arbitrary individual invocations.
- Keep milestone management outside this workflow.
- Accept a task from text, an issue, or both.
- Do not impose universal time, token, cost, or task-size budgets. The workflow
  handles tasks with materially different scopes, and correctness gates must
  not depend on one arbitrary limit.
- Keep deterministic tests focused on workflow code, state, adapters, and data
  contracts. Skill and model output quality is nondeterministic and is not a
  deterministic CI gate.

## Confirmed public surface

The six skills are `nttask`, `ntgrill`, `ntplan`, `ntwork`, `ntstats`, and
`ntreflect`. Review is part of `ntwork`; `delivery-ready` is passive.

## Agent configuration contract

Each phase has a primary agent: the agent running the current user-facing chat.
That agent owns the phase result. For example, the primary planning agent reads
the context, directs research, writes the plan, evaluates criticism, and makes
the final revisions.

Supporting agents handle bounded, independently verifiable work such as
research, repository exploration, plan criticism, specification checks,
code-quality review, security review, and test/result analysis. They return
evidence and findings; they do not silently replace the primary agent's
canonical artifact.

Phase contracts name the few supporting roles they need and bound each role's
scope. Each provider supplies those roles in its native agent format, including
model and effort settings. The runtime validates availability but has no shared
role schema, model translation, per-invocation profiles, or implicit fallback.

## Architecture

- Phase skills own phase behavior and their supporting-agent topology.
- The primary agent owns synthesis, user interaction, and canonical outputs.
- The CLI owns current state, legal-transition validation, artifact validation
  at phase boundaries, and telemetry queries.
- Provider adapters expose native identity, plugin and CLI discovery,
  transcript/session integration, and telemetry normalization. Supporting
  agents are invoked through each provider's native subagent mechanism.
- Canonical artifacts stay small and are loaded by the next phase.
- Raw transcripts and tool outputs remain audit-only unless explicitly opened.
- No central orchestrator skill is required for correctness.

## Quality target

For the large tasks it targets, the workflow should be materially simpler than
GSD while retaining:

- explicit phase gates;
- isolated research, planning, and criticism where useful;
- approval of decision-rich artifacts;
- goal-backward plan verification;
- implementation evidence;
- independent specification and code-quality review;
- exact, local operational telemetry where the provider exposes it.

## Installation

The packaged slice exposes `nttask`, `ntgrill`, `ntplan`, and `ntwork`; `ntstats`
and `ntreflect` are not implemented. `ntgrill` uses only its primary agent.
`ntplan` requires its packaged read-only researcher and critic definitions;
`ntwork` requires its implementer and four read-only reviewer definitions.
Use Node.js 24 and Git. Verification pins Claude Code
2.1.220 and Codex CLI 0.144.6 through `package-lock.json`; do not replace them with
an unpinned download during a test run.

Development checkouts must preserve LF for byte-exact bundle checks. For a
new clone, use `git clone --config core.autocrlf=false <repository-url>`; do not rewrite
an existing worktree that contains user changes.

From this checkout, prepare and verify the release locally:

```text
npm ci
npm run verify
```

Keep each generated marketplace directory intact, including hidden manifests
and its `plugins/` subtree. Install at user scope from an absolute path to the
complete directory, not from a standalone marketplace JSON file:

```text
claude plugin marketplace add "<absolute-checkout>/build/release/marketplaces/claude-code" --scope user
claude plugin install neotolis-workflow@neotolis-local --scope user
claude plugin list --json

codex -c features.remote_plugin=false plugin marketplace add "<absolute-checkout>/build/release/marketplaces/codex" --json
codex -c features.remote_plugin=false plugin add neotolis-workflow@neotolis-local --json
codex -c features.remote_plugin=false plugin list --json
```

For pinned Codex, enable `plugins = true` and `hooks = true` in the existing
`[features]` section of the user configuration; preserve other settings. Codex
does not register plugin `agents/` automatically: add native global declarations
whose `config_file` values are the absolute installed plugin paths:

```toml
[agents.ntplan_researcher]
config_file = "<installed-plugin>/agents/ntplan_researcher.toml"

[agents.ntplan_critic]
config_file = "<installed-plugin>/agents/ntplan_critic.toml"

[agents.ntwork_implementer]
config_file = "<installed-plugin>/agents/ntwork_implementer.toml"

[agents.ntwork_task_reviewer]
config_file = "<installed-plugin>/agents/ntwork_task_reviewer.toml"

[agents.ntwork_nyquist_auditor]
config_file = "<installed-plugin>/agents/ntwork_nyquist_auditor.toml"

[agents.ntwork_spec_integration_reviewer]
config_file = "<installed-plugin>/agents/ntwork_spec_integration_reviewer.toml"

[agents.ntwork_code_reviewer]
config_file = "<installed-plugin>/agents/ntwork_code_reviewer.toml"
```

The provider owns the model and effort in those TOMLs. Do not copy the role
contents into the global config and do not substitute a generic agent. Open
`/hooks`, review and trust the Neotolis SessionStart hook, and start a fresh
session. Claude also needs a fresh session after installation. The hook supplies
the native owner, consumer cwd, and exact bundled CLI path; absent context must
stop intake. Never copy or edit provider caches to simulate installation.

The npm tarball is an alternative CLI distribution, not a skill installer:

```text
npm install --global "<absolute-checkout>/build/release/npm/neotolis-workflow-0.0.0.tgz"
```

Provider plugins already bundle this CLI. Users invoke the skill; agents invoke
`ntworkflow`. Run workflow tasks in a separate consumer Git repository, never in
this checkout's contract-bearing `.ntworkflow/`.

Installation references: [Claude local marketplaces and user scope](https://code.claude.com/docs/en/plugin-marketplaces#plugin-marketplace-add),
[Codex plugins and hook trust](https://developers.openai.com/codex/plugins),
[npm local packages](https://docs.npmjs.com/cli/v11/commands/npm-install/).
The deterministic installation fixtures exercise the exact pinned CLI commands.

## Deterministic testing and CI

`npm run verify` stops on the first failure and runs these stages sequentially:

1. `npm run check`: TypeScript checking and ESLint.
2. `npm run build`: compile the dependency-free CLI.
3. `npm --offline test`: all `tests/**/*.test.ts`, including tooling, state,
   status, transaction, run, phase, nttask, ntgrill, ntplan, clean native provider installation
   and discovery fixtures, conformance, and E2E.
4. `npm --offline run package`: rebuild and package both complete marketplaces
   and the npm tarball.
5. `npm --offline run package:verify`: verify exact inventories, install the
   tarball, and install both packaged marketplaces in clean provider fixtures.

The tooling build test deletes `build/`. Packaging runs only after the full
suite exits; never run package verification concurrently with that suite.
Successful verification leaves these release artifacts available:

- `build/release/npm/neotolis-workflow-0.0.0.tgz`
- `build/release/marketplaces/claude-code/`
- `build/release/marketplaces/codex/`

Use `npm run test:e2e` or `npm run test:conformance` for focused checks. The E2E
harness reuses recorded SessionStart payloads and the checked provider bundles,
then replays explicit CLI operations in separate temporary Git repositories
with spaces and Unicode in their paths. It compares complete responses and
filesystem trees, including empty directories and exact binary file bytes, replacing only native
provider/session identities and absolute fixture paths. No error code, message,
warning, state field, or artifact content is omitted from parity.

Coverage includes empty intake, first start, native ownership, Unicode BRIEF
with a URL, completion and owner release, fresh read-only re-entry to `ntgrill`,
competing owners, confirmed cross-provider takeover, cancellation and permanent
run retention, corruption, invalid BRIEF, held locks, partial directories, and
delivery-ready replacement. Grilling coverage includes begin/stop/complete,
ownership, same-session restart, cross-provider takeover, explicit completion
confirmation, missing/invalid BRIEF, rejection of any Open questions section,
blockers, failed state replacement, and later-state diagnosis. The conformance
corpus compares complete JSON responses, including every error field.
Planning coverage includes required native-role availability, begin/stop/restart
and takeover ownership, strict grilled-BRIEF input, SPEC/PLAN/task packet
structure, stable dependency order, exact acceptance ownership, fenced-content
exclusion, locked atomic completion, approval and critic attestations, late
read-only diagnosis, and initialized pending work tasks. Semantic research
quality, criticism and truthful approval remain live-model gates rather than CI
claims.
Work coverage includes clean Git and exact branch/HEAD boundaries, deterministic
next-task selection, scoped pre-commit evidence, task and fix commits, independent
task and code reviews, interrupted-task reuse, red-CI repair, whole-plan validation,
Nyquist and specification/integration review, sticky same-revision gate failures,
strict amendment recovery, delivery-ready diagnosis, and full Claude/Codex bundle
and response parity. The runtime does not introduce a Git-tree fingerprint or
claim model-authored evidence as a deterministic proof system.
Commit-boundary checks additionally reuse the
existing runtime fault-injection seam to prove that the old state remains until
replacement and survives a failed commit; these checks do not add CLI options.

After `npm ci`, deterministic verification needs no model credentials or network
service. Provider fixtures use local marketplaces and isolated settings; they
make no model calls. npm subprocesses run offline, Claude nonessential traffic
and updates are disabled, and Codex remote plugins are disabled in fixtures.
This is not an operating-system network firewall. Recorded empty-input and
re-entry decisions do not prove a live model's interpretation of the skills,
source reading, questions, or BRIEF quality.

CI disables Git line-ending conversion before checkout, so Windows retains the
same tracked bytes ([Git core.autocrlf](https://git-scm.com/docs/git-config#Documentation/git-config.txt-coreautocrlf)).
CI runs the same `npm ci` and `npm run verify` gate on `windows-latest`,
`ubuntu-latest`, and `macos-latest`, each with Node.js 24. Matrix jobs do not
cancel one another on failure. **TB-AC-11 passed on the tracer commit above**:
[Windows](https://github.com/d954mas/neotolis-workflow/actions/runs/33370135714/job/99419111324)
(188 passed, 1 platform skip),
[Ubuntu](https://github.com/d954mas/neotolis-workflow/actions/runs/33370135714/job/99419111676)
and [macOS](https://github.com/d954mas/neotolis-workflow/actions/runs/33370135714/job/99419111512)
(189 passed each). Packaging was 5/5 per job; E2E was 10/10.
Those tracer jobs do not cover ntgrill. The separate ntgrill slice passed
[CI run 33386366276](https://github.com/d954mas/neotolis-workflow/actions/runs/33386366276)
on commit `02ec60bb2f4b2e8f0edb9b965e08e37f9fafb7ae`: Windows had 207 passed
and one platform skip; Ubuntu and macOS had 208 passed each. Packaging was
5/5 on every platform. This is commit-specific evidence; subsequent changes
require their own CI run. The final pre-merge review commit
`72c48b7768038d71d2faf4c9f9e259d0a672c467` passed
[run 33401226507](https://github.com/d954mas/neotolis-workflow/actions/runs/33401226507):
Windows 207 passed and one skip; Ubuntu and macOS 208 passed; packaging 5/5,
E2E 12 and conformance six on every platform. The merged `main` SHA
`cde0eab1fdd4fd576fc4dd98da7c570ccf559df4` passed post-merge
[run 33401772202](https://github.com/d954mas/neotolis-workflow/actions/runs/33401772202).
Neither run covers the current ntplan/ntwork working tree.

CI references: [GitHub matrix jobs](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/run-job-variations),
[setup-node v6](https://github.com/actions/setup-node/tree/v6),
[npm ci and lockfiles](https://docs.npmjs.com/cli/v11/commands/npm-ci/).

## Release-only live smoke

Run this separately after the local deterministic gate, with explicit
authorization for live model use. It is not part of `verify` or CI. Publishing
still requires fresh three-platform CI on the release commit.

1. Install each packaged plugin at user scope and use a separate disposable
   consumer Git repository per provider. Authenticate through the provider's
   normal flow; never place credentials in fixtures or repository files.
2. Start a fresh session, verify discovery and SessionStart context, and trust
   the Codex hook through `/hooks`. Invoke empty `nttask`: it must ask for intent
   without a CLI call or new files.
3. Supply a Unicode task with an accessible direct URL. Confirm source reading,
   relevant repository scouting and questions, and a concise current BRIEF.
   Confirm `brief-ready`, no owner, and no edits outside `.ntworkflow/`.
4. In a fresh session, invoke `nttask` again. Confirm no mutation and a handoff
   to `ntgrill`. In a fresh primary session invoke `ntgrill`, confirm one
   recommended decision at a time, correct the proposed complete understanding,
   and verify that the brief remains unchanged until the revised account is
   explicitly confirmed. Then check plan-ready, a full current BRIEF without
   Open questions, no project-code edits, and read-only late ntgrill rejection
   naming ntplan.
5. In another disposable run, verify that a competing session stops, an
   explicitly confirmed interruption allows cross-provider takeover, and
   explicit cancellation preserves the run directory and partial BRIEF.
6. Start intake in a durable native session, end the provider process, start a
   new process, and resume that exact session from disk. Verify unchanged
   identity, valid SessionStart context, and preserved consumer files. Native
   resume does not authorize workflow reasoning to resume: interrupted intake
   and grilling require explicit restart confirmation even for the same ID.
   Confirm restart and verify phase begin includes interruption authority when
   an owner remains recorded. A fresh session is not disk-resume evidence;
   neither test establishes an operating-system reboot.
7. From a grilled plan-ready run, invoke `ntplan` in a fresh primary session.
   Confirm native researcher discovery, primary-owned SPEC/PLAN/task packets,
   structural validation, an independent native critic and convergence. Make a
   material correction to the first approval view; require a fresh critic PASS,
   then explicitly approve and confirm `plan-approved`. No project-code file may
   change. A late call diagnoses lifecycle and `next_action` without invoking
   another skill. Interrupted planning requires explicit restart confirmation,
   discards every old planning draft, and repeats research.
8. From the resulting plan-approved run, invoke `ntwork` in a fresh primary
   session. Confirm all five native roles, exact Git branch/HEAD preflight,
   sequential task ownership, scoped evidence before each dedicated commit, and
   independent PASS task review. Exercise interrupted-task reuse and one red-CI
   repair without accepting unrelated or stale evidence.
9. Confirm whole-plan validation, independent Nyquist, specification/integration,
   and code-review PASS verdicts, the applicable CI decision, and passive
   `delivery-ready`. Exercise one material plan amendment and its explicit
   critic/user reapproval. A late call must diagnose the lifecycle without
   mutation or automatic delivery.

Record the release commit, OS, provider versions, session references, and
observed results. Failures block release; do not repair state or weaken the
skill contract to finish the smoke.

## Initial local ntgrill validation — 2026-08-31

Before the initial ntgrill commit, the worktree passed Windows verification: 207 tests
passed, one platform skip, and packaging 5/5. This includes 12 E2E tests and
six cross-provider conformance scenarios. The first green gate preceded live
model calls; a later gate included the review fixes. The subsequent
Linux/macOS/Windows CI result is recorded above.

Native process/disk resume was exercised with Claude Code 2.1.220 / Claude
Sonnet 5 and Codex 0.144.6 / gpt-5.6-sol on Node 24.15.0. New provider processes
loaded the same saved session identities and supplied valid SessionStart
context. State and files remained unchanged before explicit restart confirmation.
The smoke exposed a missing same-owner interruption instruction in nttask;
both skills now pass the existing runtime's interruption authority after
confirmation. Runtime restart semantics were not relaxed.

Both real models completed ntgrill from the same explicitly seeded intake
brief: repository scouting, a recommended format question, dependent CSV
choices, correction of the complete understanding from CRLF to LF, renewed
confirmation, full BRIEF rewrite, and plan-ready with no owner. During the
interview and correction the BRIEF stayed byte-identical; only BRIEF and state
changed overall. Full normalized CLI responses agree. The final native BRIEFs
have different prose; evidence retains that difference instead of normalizing
it away. Deterministic E2E uses an explicit approved rewrite, not model output.

Three read-only reviewers found the same ordering defect: freshness stopped a
late invocation before status/next_action diagnosis. Moving diagnosis ahead of
freshness/restart fixed it; all three rechecked the change without further
findings. Late live calls then exposed omission of the contract's literal
invalid-phase diagnostic; its wording is now explicit in both skills.
On the final package Codex emitted the required `invalid phase state` marker;
Claude still omitted it despite loading the updated instruction. Its actual
plan-ready/ntplan diagnosis and non-mutation were correct. The final live audit
is **31/32**, not fully green: this model-compliance limitation remains open.
The ntgrill CI requirement was satisfied on the commit recorded above;
any later release candidate still requires CI on its own commit.

Generated logs, assertions, release hashes and limitations are collected in
`build/live-smoke-ntgrill/REPORT.md`, with original evidence retained in temporary
fixtures outside build. Initial failed attempts remain recorded: unsupported
model-invented CLI flags, a Claude retry after a runtime error, and omitted late
diagnostic labels are not claimed as passing evidence. Model compliance remains
nondeterministic. This tests process restart, not an OS reboot. Headless native
flows were used; the interactive Codex /hooks screen was not tested. Hook trust
used native hooks/list and config/batchWrite only after installed release-byte
and currentHash verification. No credentials were copied into fixtures.

## Local ntplan validation — 2026-09-02

The current working tree passes Windows `npm run verify`: 221 tests total,
220 passed and one platform skip; packaging 5/5. This includes 14 E2E cases and
eight full-response cross-provider conformance scenarios. The final tarball
SHA-256 is `F91A3067BE974EE04F1929D74E60CA26820D70C17640CDDD1AE25C8A43206720`.
This is local evidence for an uncommitted working tree, not CI evidence.

Three independent read-only reviews covered simplicity and ceremony,
architecture and extensibility, and correctness and evidence. One confirmed
external-artifact bypass let a fenced `- AC-*` example claim final acceptance
ownership. The validator now uses the existing Markdown fence visibility when
reading those rows; focused re-review passed 15/15. No registry, scanner,
fallback, repair path, extra approval or impossible-internal-state guard was
added. The other reviews reported no findings.

The fresh late-`ntgrill` smoke made one model call per provider. Both emitted the
required literal `invalid phase state`, named actual `plan-ready` and `ntplan`,
and left full trees unchanged. Codex began with the marker. Claude placed one
explanatory paragraph before it, so the stricter begin-with-marker instruction
remains a live model-compliance limitation. This new observation does not
rewrite the historical 31/32 audit or turn it into a new aggregate score.

Claude Code 2.1.220 / Claude Sonnet 5 completed the ntplan smoke in a disposable
Unicode-path Git repository. Native discovery exposed both packaged agents. A
terminated provider process interrupted critic round one; disk resume retained
the same native session ID, diagnosed the recorded owner, requested explicit
restart confirmation, discarded SPEC/PLAN/tasks, and repeated research. The
fresh researcher ran, structural validation passed, and critic round one passed.
The first approval view was rejected with the material `--name` to
`--exact-name` correction; canonical artifacts changed, the old PASS was
invalidated, and a fresh full critic round passed before explicit approval.
Completion produced `plan-approved` with two pending tasks. A late invocation
named `ntwork`, did not invoke it, and did not mutate files. Consumer files,
including an opaque binary, remained byte-identical.

Codex 0.144.6 / gpt-5.6-sol discovered the skill and loaded both native global
role declarations through `agents.<name>.config_file`; `config/read` confirmed
them. Its app-server primary tool surface nevertheless did not expose the
required `agent_type` parameter. It therefore omitted both availability flags,
received the required researcher-unavailable artifact failure, and left the
plan-ready state and complete tree unchanged. One diagnostic restart proved the
same boundary with persisted configuration; no generic agent, fallback, retry
until green, or state repair was used. Full Codex research/criticism/approval is
therefore not proven and blocks release.

The model smoke used the package generated before the review-only fenced-row
fix. Its ntplan skill bytes are identical to the final package; the runtime bytes
differ only by that deterministic structural validation fix, which the final
verify covers. No model claim is presented as exact-byte live evidence for the
final runtime bundle. Evidence and exact boundaries are retained outside
`build/` and copied after verification to `build/live-smoke-ntplan/REPORT.md`.
No credentials were copied into fixtures, no project implementation began, and
the exercise proves process restart rather than an operating-system reboot.

## Local ntwork validation — 2026-09-02

The uncommitted working tree remains on exact HEAD
`54460a730521fa0d1707ad73208f4d500710d511` and passes Windows
`npm run verify`: 248 tests total, 247 passed, one platform skip, and packaging
5/5. Focused ntwork tests passed 25/25; the E2E suite passed 15/15, focused
conformance passed 2/2, and provider tests passed 42/42. The final npm tarball
SHA-256 is `17E0D091A3C964A409CB58B09D459208178271C6AAB55356D18A2E4F6B647857`.

Three independent read-only reviews covered simplicity and reference alignment,
architecture and recovery, and correctness and evidence. All finished PASS after
fixes. Their criticism removed a forbidden Git-tree fingerprint and an
uncontracted evidence verdict, tightened evidence freshness and fix-commit review,
made red-CI and sticky-gate behavior revision-aware, reconciled plan amendments
atomically, rejected ambiguous direct-child amendment recovery, restricted Claude
reviewers to read-only tools, registered all seven Codex roles, and restored exact
source/bundle parity. No extra workflow state, artifact, registry, fallback, or
orchestrator was added.

The comparison retained GSD's ordered phases, durable state, acceptance ownership,
Nyquist validation, and independent review while omitting milestones, roadmaps,
waves, and a central orchestrator. From Matt Pocock/Superpowers it retained
falsifiable acceptance, verifiable tasks, compact grilling, and inline self-review,
adding durable ownership and recovery. Spec Kit and OpenSpec align with the compact
SPEC → PLAN → task structure and structural validation; their broader intake,
registry, and exploration layers remain outside scope. BMAD is represented only by
the deliberate omission of product-document ceremony. The `game-67-idle` reference
supports local measurement direction, but its fixed project pipeline is omitted and
telemetry remains future work. This comparison uses the authoritative local
contracts and the synthesis already recorded in this file; the referenced
`.ntworkflow/DESIGN-REFERENCES.md` is absent, so no missing source is presented as
reviewed evidence.

Deterministic installation and discovery passed for both providers. An actual
Claude model launch was blocked by host safety before model execution; the Codex
run was aborted by the user before producing model evidence. Those installed
packages also predate the last review fixes, so no successful exact-byte live
ntwork run is claimed. Release remains blocked on explicitly authorized live smoke
against the final bytes and fresh Windows, Ubuntu, and macOS CI.

Final release artifacts are `build/release/npm/neotolis-workflow-0.0.0.tgz`,
`build/release/marketplaces/claude-code/`, and
`build/release/marketplaces/codex/`. Runtime bundle SHA-256 is
`10C6B0FF73491D6EE492E469FF3211A1BD20924C42C74EC390B638F2CA116AD8` for both
providers. The Claude ntwork skill hash is
`8BF1D17D1879FC335A499896C5B096BBC6F0ED013D73B0DD01AC3B95221032F8`; the Codex
skill hash is `6D1A393C9E1757FF3ED20ECA4DEFFC3B1E0C19BFAD7ECAC9B6F4331DE328388B`.
No commit, push, merge, publication, or release was performed.

## ntgrill contract and provenance

The primary discovers repository facts, asks one material decision question
with a recommendation at a time, follows dependent branches and performs a
final self-sweep. The user confirms the complete understanding; corrections
reopen affected branches. BRIEF stays unchanged during the interview and is
fully rewritten only after that confirmation. No frontier files, scores,
supporting reviewers or automatic phase chaining are added.

Both self-contained skills adapt Matt Pocock's
[grilling source](https://github.com/mattpocock/skills/blob/6654f6b60cd9d5be8b54c6fafe44346dabeb3b76/skills/productivity/grilling/SKILL.md)
and [documentation](https://github.com/mattpocock/skills/blob/6654f6b60cd9d5be8b54c6fafe44346dabeb3b76/docs/productivity/grilling.md),
pinned to `6654f6b60cd9d5be8b54c6fafe44346dabeb3b76`, with the full
[MIT notice](https://github.com/mattpocock/skills/blob/6654f6b60cd9d5be8b54c6fafe44346dabeb3b76/LICENSE)
included in each plugin. Neotolis explicitly replaces upstream question rounds
with one question and subagent exploration with primary exploration, per its
confirmed phase contract. Runtime checks structure and confirmation input;
the skill owns semantic completeness and truthful user confirmation.
