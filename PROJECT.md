# Neotolis Workflow

## Status

Contract design is confirmed. The first tracer bullet, TB-01–TB-11, is complete
at `3db1f4c5e66b02aa1bfd65cf07d7bf84545e786d`. The separate ntgrill slice is implemented:
`ntgrill`: `brief-ready` → confirmed shared understanding → rewritten BRIEF →
`plan-ready`. Its bounded plan is [implementation/NTGRILL.md](implementation/NTGRILL.md).
`ntplan`, `ntwork`, telemetry, `ntstats`, and `ntreflect` are not implemented.
The full six-skill workflow is not complete. New changes require fresh CI.

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

The packaged slice exposes `nttask` and `ntgrill`; the other four skills and
supporting roles are not implemented. `ntgrill` uses only its primary agent.
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
`[features]` section of the user configuration; preserve other settings. Open
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
   status, transaction, run, phase, nttask, ntgrill, clean native provider installation
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
These jobs do not cover ntgrill or any later changes. A local Windows pass is
not three-platform evidence; fresh CI needs an authorized commit and push.

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
   naming ntplan. Do not attempt the unimplemented planning phase.
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

Record the release commit, OS, provider versions, session references, and
observed results. Failures block release; do not repair state or weaken the
skill contract to finish the smoke.

## Local ntgrill validation — 2026-08-31

The uncommitted follow-on worktree passed Windows verification: 207 tests
passed, one platform skip, and packaging 5/5. This includes 12 E2E tests and
six cross-provider conformance scenarios. The first green gate preceded live
model calls; a later gate includes the review fixes. These results do not
replace fresh Linux/macOS/Windows CI on a new commit.

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
is **31/32**, not fully green: this model-compliance limitation remains open
alongside the requirement for fresh CI before release.

Generated logs, assertions, release hashes and limitations are collected in
`build/live-smoke-ntgrill/REPORT.md`, with original evidence retained in temporary
fixtures outside build. Initial failed attempts remain recorded: unsupported
model-invented CLI flags, a Claude retry after a runtime error, and omitted late
diagnostic labels are not claimed as passing evidence. Model compliance remains
nondeterministic. This tests process restart, not an OS reboot. Headless native
flows were used; the interactive Codex /hooks screen was not tested. Hook trust
used native hooks/list and config/batchWrite only after installed release-byte
and currentHash verification. No credentials were copied into fixtures.

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
