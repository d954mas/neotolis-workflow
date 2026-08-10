# Neotolis Workflow — Project Specification

**Created:** 2026-08-09
**Ambiguity score:** 0.05 (gate: ≤ 0.20)
**Requirements:** 13 locked

## Goal

Provide an installable, provider-neutral development workflow for Claude Code
and Codex that carries a free-form task through context gathering, grilling,
research-backed planning, task execution, review, telemetry, and optional
reflection while preserving durable local state between fresh sessions.

## Background

The project currently contains a charter and reference research but no skills,
runtime, schemas, or tests. GSD provides disciplined sequencing and durable
state but brings milestone coupling and substantial ceremony. Matt Pocock's
skills provide concise, high-quality phase techniques but no durable ordering,
state machine, or telemetry. `game-67-idle` demonstrates exact local transcript
and tool-usage measurement but packages it as project-specific harness code.

Neotolis Workflow combines the strongest parts of those systems while keeping
the public workflow small and milestone-agnostic.

## Requirements

1. **Dual-provider package**: The project provides an installable workflow for Claude Code and Codex on Windows, macOS, and Linux.
   - Current: No installable package or provider integration exists.
   - Target: A native user-level plugin for each provider exposes the same six logical skills, native supporting-agent definitions, canonical artifacts, state semantics, and completion gates. Provider differences remain explicit.
   - Acceptance: Global installation exposes the six skills, required native agent definitions, and bundled or exactly discoverable `ntworkflow` CLI in clean Claude Code and Codex fixtures; adapter contract tests pass on Windows and at least one Unix environment.

2. **Local runtime state**: Every consumer project stores workflow-owned state and artifacts under `.ntworkflow/`.
   - Current: No runtime directory or state schema exists.
   - Target: One strict `.ntworkflow/state.json` holds current mutable state. Permanent `.ntworkflow/runs/<run-id>/` directories hold canonical Markdown artifacts, and `.ntworkflow/telemetry/<provider>/<native-session-id>.jsonl` holds optional session telemetry. There is no runtime handoff, event journal, artifact registry, or report artifact. Git tracking policy remains entirely under user control.
   - Acceptance: Initializing a fixture project creates `.ntworkflow/`, neither edits nor validates Git ignore rules, and writes no workflow runtime artifact outside it.

3. **Small public surface**: The user-facing workflow consists of `nttask`, `ntgrill`, `ntplan`, `ntwork`, `ntstats`, and `ntreflect`; the `ntworkflow` CLI is an internal agent interface.
   - Current: No public skills or internal CLI exist.
   - Target: Users work through skills or natural-language equivalents while agents use the CLI for state, task, telemetry, and transition operations.
   - Acceptance: Each public skill is installable in both providers, and invoking it in an invalid state stops with a narrated diagnosis and correct next action without mutating workflow state.

4. **Primary and supporting agents**: Each major phase runs in a fresh primary user-facing session whose main agent owns decisions, synthesis, and canonical outputs.
   - Current: No role or session contract exists.
   - Target: Bounded supporting agents perform research, repository exploration, criticism, checks, review, and transcript analysis without replacing the primary author's output. Each provider's native agent definitions are the sole source of role prompts, models, and reasoning or effort settings. The runtime knows expected role names but does not translate a common profile schema or launch agents. The read-only `ntstats` and `ntreflect` queries do not require a fresh primary session because they create no canonical phase artifact or workflow transition.
   - Acceptance: Provider fixtures prove that every phase-required native role is discoverable and invoked through the provider's native subagent mechanism with its native configuration. Missing roles follow the owning phase contract: optional scouting may be skipped, required planning or work roles stop the phase, and transcript analysis is required only for causal claims. No implicit fallback exists.

5. **Free-form task intake**: `nttask` accepts a non-empty task description written by the user.
   - Current: No intake contract exists.
   - Target: Arbitrary links in the description are treated as task context, not as specially modeled GitHub, Google Docs, Linear, or other provider records. The agent researches the repository, asks primary questions, and writes the initial brief.
   - Acceptance: Intake accepts Unicode free-form text and links without technical corruption, rejects an empty task, stops and asks the user when a directly referenced source cannot be read, and produces a concise brief containing the best current formulation of intent, relevant repository context, boundaries, constraints, top-level success, and decision questions. The brief does not preserve obsolete wording or conversation history.

6. **Decision grilling**: `ntgrill` resolves decision ambiguity before planning.
   - Current: No durable decision frontier exists.
   - Target: A self-contained adapted copy of Matt Pocock's `grilling` skill reads the current brief and repository, discovers facts itself, walks a dynamic conversational decision frontier, asks the user only about actual decisions with a recommended answer, and blocks planning until shared understanding is confirmed. The frontier has no separate registry or durable artifact.
   - Acceptance: A run with unresolved product choices cannot enter planning; after the user confirms the complete shared understanding, `ntgrill` fully rewrites the brief with only current agreed context, leaves no `Open questions`, and the run becomes `plan-ready`. Invocation in any later state fails with a diagnosis and correct next action rather than redirecting automatically.

7. **Research-backed approved plan**: `ntplan` always performs research before producing an approved plan.
   - Current: No research, specification, planning, or approval pipeline exists.
   - Target: A bounded supporting researcher returns a temporary evidence packet that includes the applicable test, build, validation, and benchmark infrastructure, repository conventions, canonical local and full-suite commands, and material gaps. The primary agent first synthesizes research, the approved brief, and any user-confirmed planning decision into the specification, then performs an inline self-review before writing the coordination plan and task packets. One final independent critic receives the brief, complete evidence packet, specification, plan, and all task packets and checks them through two lenses: evidence to specification, then specification to plan and tasks. No standalone research artifact is retained. Contradictions and materially better alternatives are discussed with the user; approval uses a short summary and task list.
   - Acceptance: Planning enters `plan-approved` only after mandatory research completes, the primary self-reviews the specification before technical planning, the final independent critic passes, findings requiring user judgment are resolved, the user explicitly approves the unchanged reviewed specification, plan, and ordered task list, at least one executable task exists, and no blocker remains. Any material change after critic PASS requires a fresh critic round. `ntplan` never starts `ntwork` automatically.

8. **Executable task packets**: An approved plan is divided into separate dependency-aware Markdown task packets for fresh implementation contexts.
   - Current: No task representation exists.
   - Target: Each run has a project-local ordered work ID such as `NT-007`; task IDs derive from it and the stable order, such as `NT-007-01`. Specification acceptance criteria use simple local IDs such as `AC-1`. `.ntworkflow/runs/<run-id>/PLAN.md` is a short map of the overall technical approach, cross-task decisions, dependency graph, stable order, and task index; its final-validation section owns only whole-plan criteria and gives exact commands or procedures, expected pass conditions, and fresh-evidence requirements. Each `.ntworkflow/runs/<run-id>/tasks/<id>.md` packet requires an ID and goal, scope, direct dependencies, covered acceptance IDs, and exact verification. A task proves the result it completes after its dependencies are complete. A task owns an integration check only when its dependency closure contains every producer required by that check. Each acceptance ID is owned by the task that completes it or by final plan-wide validation when it is inherently cross-task or whole-result. Tests are mandatory for every testable behavior or logic change, but formal test-first TDD ordering and a new test per task are not required; existing direct coverage may be reused. When changed executable behavior lacks practical automated coverage, the packet explains why and defines reproducible alternative evidence. Non-code work uses the applicable automated check or reproducible inspection without artificial tests. Missing shared or substantial test infrastructure may be its own prerequisite task; otherwise the earliest task that needs it owns setup. Rationale, out-of-scope notes, and review risks are otherwise included only when useful. Task dependencies are canonical; the graph and order in the plan are their human-readable projection. Mutable execution status lives only in `.ntworkflow/state.json`, not in approved task definitions.
   - Acceptance: Before critic dispatch and again before `plan-approved`, the CLI rejects duplicate IDs, dependency cycles, missing required sections, unknown dependencies, disagreement between task dependencies and the plan graph, unknown or multiply owned acceptance IDs, and acceptance IDs with no task or final-validation owner. The critic blocks a task that defers proof of its own result, an integration check whose required producers are outside the owner's dependency closure, changed behavior or logic that is testable without relevant automated coverage, and any test exception without a justified reproducible alternative. Verification must be capable of distinguishing the old or incorrect result from the required result; a pre-change run is optional unless specifically useful. Approved definitions remain unchanged during ordinary execution; the only exception is an explicit user-authorized `ntwork` amendment followed by structural validation, independent criticism, and renewed approval.

9. **One-task and all-task execution**: `ntwork` implements either all remaining ready tasks sequentially or exactly one ready task.
   - Current: No implementation workflow exists.
   - Target: `ntwork` starts only from `plan-approved` with readable `.ntworkflow/runs/<run-id>/SPEC.md`, `.ntworkflow/runs/<run-id>/PLAN.md`, and task packets. It creates one dedicated implementation branch in the current checkout and executes tasks strictly in PLAN's stable order: `ntwork` or `ntwork all` processes all remaining tasks, `ntwork one` processes the next task, and `ntwork one <id>` succeeds only when `<id>` is that exact next task. A fresh bounded implementer writes each task while the primary agent owns decisions, canonical verification, review adjudication, status, and commits. Tests are mandatory for every testable behavior or logic change without requiring formal test-first TDD. One read-only task reviewer returns separate packet-compliance and code/test-quality verdicts. The first task commit opens one draft plan-level pull request; later task and linked fix commits update it while CI runs in the background. After all tasks, whole-plan validation, a read-only Nyquist audit, independent specification/integration review, code review, and required CI must PASS on the same current pull-request head. `ntwork` then enters the separate passive `delivery-ready` phase. The user controls any later review, fixes, and delivery; the workflow does not validate that work or inspect Git or GitHub for a merge.
   - Acceptance: Wrong state, unreadable mandatory artifacts, out-of-order selection, concurrent ownership, or an external branch or pull-request mismatch blocks `ntwork` without silent repair or fallback. Each task requires its dedicated primary commit, fresh applicable tests and other verification, and both task-review verdicts; completed tasks are not rerun. CI does not delay a pending next task, but a known required CI failure stops the following task until a bounded non-parallel fix is verified, reviewed, committed, and pushed. After all tasks, PLAN's exact full-suite, build, check, benchmark, visual, and manual procedures run with fresh evidence. Delivery is blocked until the current head receives Nyquist PASS, specification/integration PASS, code-review PASS, and required CI PASS. In-scope findings are fixed by a bounded implementer under primary ownership. A finding that changes the approved contract pauses implementation and may change artifacts only after explicit user permission, structural validation, fresh independent criticism, and renewed approval. Any project change that affects a final gate invalidates that gate and downstream gates; any production-code or test change restarts the complete final sequence. No standalone validation artifact is created. The run reaches `delivery-ready` only with a ready pull request. It reaches `work-complete` when the user explicitly reports delivery or atomically when a new non-empty task starts, never through automated merge inspection.

10. **Explicit authority and fail-early behavior**: Agents act only within authority granted by the invoked phase and approved artifacts.
   - Current: No enforceable authority boundary exists.
   - Target: Invalid exact state shape, unsupported telemetry format, missing required native roles, violated invariants, concurrent ownership, and changes outside approved scope stop immediately with a narrated diagnosis. State has no schema version or migration path; telemetry rows carry a format version. The workflow never silently repairs, migrates, resets, falls back, changes the plan, or expands scope.
   - Acceptance: Negative preflight fixtures leave project files and workflow state unchanged. A failure detected after ordinary code or Markdown edits prevents the state transition and leaves the actual files for explicit user resolution; it never triggers automatic rollback or repair. Provider hooks may independently record telemetry, but no diagnostic journal is required. Review fixes apply automatically only when they unambiguously restore an existing acceptance criterion.

11. **Durable clean-session recovery**: A fresh primary reconstructs workflow context from canonical state and artifacts.
   - Current: Context survives only in conversation history and the initial research notes.
   - Target: `.ntworkflow/state.json` supplies current identity, lifecycle, ownership, blockers, and mutable execution data; canonical Markdown in the current run directory supplies intent, decisions, plan, and task scope. No runtime handoff file exists. Interrupted state-changing phase invocations restart from their last durable boundary; only an interrupted task implementation inside `ntwork` may continue under the `ntwork` contract. Read-only `ntstats` and `ntreflect` simply run again from a fresh snapshot.
   - Acceptance: A fresh-session fixture restarts an interrupted phase only after user confirmation, refuses concurrent takeover or automatic recovery from corrupt state, and resumes work only for an interrupted task implementation explicitly permitted by `ntwork`.

12. **Measured local operation**: The runtime records local normalized telemetry and exposes simple trustworthy statistics.
   - Current: `game-67-idle` contains project-specific measurement code; Neotolis Workflow has none.
   - Target: Available normalized input, cache, and output tokens; canonical tool calls; observed textual result characters; and calendar or observed time aggregate by session, task, phase, run, and project. `ntstats` presents concise numeric results. `ntreflect` reads the complete untruncated normalized dataset, uses bounded read-only supporting agents to inspect relevant provider transcripts, explains only material process problems supported by the evidence, and recommends one simple improvement without validating implementation quality or mutating project or workflow state. Project-local append-only JSONL contains no raw prompts, reasoning, tool arguments, commands, model responses, or tool-result content.
   - Acceptance: Deterministic Claude Code and Codex fixtures aggregate without double counting, correlate sources only by stable provider IDs, distinguish exact, partial, and unavailable data, never treat missing data as zero, and mark active-run results preliminary. Supported local, custom, and MCP calls use hook lifecycle evidence; versioned native adapters fill only documented provider gaps. `ntreflect` inherits `ntstats` scope and availability semantics, treats invocation as read-only permission to inspect available raw evidence inside the selected scope, distinguishes confirmed, probable, and unknown causes without scores or universal thresholds, and creates no report artifact or state transition. Corrupt in-scope Neotolis telemetry fails the query instead of silently producing a report.

13. **Deterministic runtime verification**: Workflow code and data contracts have an automated deterministic test path.
   - Current: No test harness exists.
   - Target: CLI behavior, exact state shape, telemetry formats, provider adapters, state transitions, file operations, and telemetry aggregation run deterministic CI tests without model credentials. Automated verification scope is limited to deterministic workflow runtime and provider-adapter behavior.
   - Acceptance: Applicable deterministic suites pass on supported platforms and failures block release of the affected runtime code.

## Boundaries

**In scope:**

- Provider-neutral workflow contracts for Claude Code and Codex.
- Six public skills: `nttask`, `ntgrill`, `ntplan`, `ntwork`, `ntstats`, and `ntreflect`.
- Agent-only `ntworkflow` CLI and state machine.
- Project-local current state, permanent run artifacts, tasks, and per-session telemetry.
- Phase-owned native supporting-agent definitions with provider-specific model and reasoning or effort.
- Sequential task execution with one-task and all-task modes.
- Task-level review, read-only Nyquist audit, and final
  specification/integration review.
- Exact metrics when exposed by the provider and explicit unavailable markers otherwise.
- Deterministic CI for workflow runtime code and data contracts.

**Out of scope:**

- Milestones, roadmaps, portfolio management, and cross-project orchestration — owned by systems above this workflow.
- GitHub, Google Docs, Linear, Jira, or other task-source adapters — links remain ordinary user-provided context.
- A user-facing `ntworkflow` CLI — the CLI is an internal agent contract.
- Parallel implementation of multiple tasks — the initial workflow executes tasks sequentially.
- A mandatory standalone public review skill — review is part of `ntwork`; a later audit entry point may reuse it.
- Cloud state, hosted dashboards, remote databases, or team synchronization — runtime state is project-local.
- Strict telemetry parity between providers — unavailable native metrics are reported, not invented.
- Automatic state repair, schema migration, model fallback, candidate rerun, or plan mutation.
- Mandatory secret redaction or privacy/compliance hardening in v1 — this is a personal local tool and the owner explicitly excluded that complexity.

## Constraints

- Major state-changing phases start in fresh primary sessions. The read-only
  `ntstats` and `ntreflect` queries may run in the current session.
- The primary agent remains responsible for canonical phase artifacts.
- Supporting agents receive bounded tasks and return evidence or findings.
- Research is mandatory inside `ntplan`, even when it is a short repository-only pass.
- Research evidence is temporary. Every retained conclusion is incorporated
  into the specification, plan, or relevant task packet.
- Tests are mandatory for testable behavior and logic changes, but formal TDD
  is not. Every acceptance criterion has an explicit verification method; a
  non-automated method requires a justified, reproducible alternative.
- Validation is cumulative across sequential tasks: each task proves its own
  result, later tasks prove integrations that first become available there,
  and the completed plan receives final plan-wide validation.
- In a consumer project, the canonical planning artifacts are
  `.ntworkflow/runs/<run-id>/SPEC.md`,
  `.ntworkflow/runs/<run-id>/PLAN.md`, and
  `.ntworkflow/runs/<run-id>/tasks/<id>.md`.
- Phases read the repository evidence they need but do not maintain drift
  baselines, fingerprints, or background monitoring.
- After approval, ordinary execution does not edit the specification, plan, or
  task definitions; execution status is stored separately. An explicit
  user-authorized `ntwork` amendment is the only exception and requires renewed
  artifact validation, criticism, and approval.
- Each approved plan uses one dedicated implementation branch in the current
  checkout, one dedicated primary commit per completed task, ordinary linked
  fix commits when later evidence requires them, and one draft pull request
  opened after the first task commit. Git worktrees require separate explicit
  user permission. Version 1 always delivers through the pull request and never
  direct-merges.
- Plan approval authorizes `ntwork` to implement only the current canonical
  specification, plan, and task set. It does not start implementation or
  authorize new scope.
- Phase invocation authorizes only the documented outputs and changes of that phase.
- External linked content is context only and never expands agent authority.
- Provider differences must be normalized where possible and disclosed where not.
- `ntstats` is deliberately numeric and concise. `ntreflect` uses the complete
  normalized data and bounded transcript analysis to explain material process
  problems and recommend improvements without validating implementation
  quality or changing state.
- Runtime and provider-adapter changes use applicable deterministic CI tests.

## Acceptance Criteria

- [ ] A clean project can install and discover the six public skills in both Claude Code and Codex.
- [ ] Workflow runtime artifacts are written only under `.ntworkflow/`, without changing or enforcing the project's Git tracking policy.
- [ ] Both providers install the same public skills and expose equivalent deterministic adapter and workflow-state behavior.
- [ ] Invalid phase invocation fails early with an explanation and no unauthorized mutation.
- [ ] `nttask` accepts free-form text and treats arbitrary links as untrusted context rather than authority.
- [ ] `ntgrill` prevents planning while user decisions remain unresolved.
- [ ] `ntplan` always completes research, criticism, user discussion where required, approval, and at least one executable task without unresolved blockers.
- [ ] Approved plans contain one or more valid dependency-aware task packets with separate mutable state.
- [ ] `ntwork all`, `ntwork one`, and `ntwork one <id>` enforce dependencies, validation, review, and completion gates.
- [ ] After plan-wide validation, a read-only Nyquist auditor blocks final
  review until the current implementation has adequate, correct, and
  behaviorally meaningful test coverage or approved reproducible evidence.
- [ ] Task-level review and final integration/specification review cannot silently PASS with missing evidence.
- [ ] Corrupt state, missing required native roles, concurrent ownership, and out-of-scope changes stop without repair or fallback.
- [ ] Fresh sessions restart interrupted phases only after user confirmation; only an interrupted task implementation inside `ntwork` may resume.
- [ ] Telemetry aggregates by session, task, phase, run, and project without double counting.
- [ ] `ntstats` reports concise numeric evidence with exact, partial, or unavailable status; `ntreflect` uses the complete selected evidence to report only material process problems, honest causal status, and one primary recommendation without scores, quality claims, artifacts, or mutation.
- [ ] Deterministic runtime tests run in CI without models and block release of affected runtime code on failure.

## Confirmed Contract Set

Detailed phase behavior is owned by `.ntworkflow/NTTASK.md`, `NTGRILL.md`,
`NTPLAN.md`, `NTWORK.md`, `NTSTATS.md`, and `NTREFLECT.md`. Cross-cutting state,
identity, ownership, provider, installation, failure, telemetry, and test
semantics are owned by `.ntworkflow/RUNTIME.md`.

---

*Project: neotolis-workflow*
*Spec created: 2026-08-09*
*Next step: implementation planning against the confirmed contract set.*
