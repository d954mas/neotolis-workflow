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
   - Target: Both providers expose equivalent workflow phases, canonical artifacts, state semantics, and completion gates, with provider-specific capabilities represented explicitly.
   - Acceptance: Installation into clean Claude Code and Codex fixture projects exposes the required skills and allows each provider adapter to pass its contract tests; automated platform checks run on Windows and at least one Unix environment.

2. **Local runtime state**: Every consumer project stores workflow-owned state and artifacts under a gitignored `.ntworkflow/` directory.
   - Current: No runtime directory or state schema exists.
   - Target: Context, specifications, plans, tasks, handoffs, transcripts or transcript references, events, telemetry, and reports remain local to the consumer project.
   - Acceptance: Initializing a fixture project creates `.ntworkflow/`, verifies that Git ignores it, and writes no workflow runtime artifact outside it.

3. **Small public surface**: The user-facing workflow consists of `nttask`, `ntgrill`, `ntplan`, `ntwork`, `ntstats`, and `ntreflect`; the `ntworkflow` CLI is an internal agent interface.
   - Current: No public skills or internal CLI exist.
   - Target: Users work through skills or natural-language equivalents while agents use the CLI for state, task, telemetry, and transition operations.
   - Acceptance: Each public skill is installable in both providers, and invoking it in an invalid state stops with a narrated diagnosis and correct next action without mutating workflow state.

4. **Primary and supporting agents**: Each major phase runs in a fresh primary user-facing session whose main agent owns decisions, synthesis, and canonical outputs.
   - Current: No role or session contract exists.
   - Target: Bounded supporting agents perform research, repository exploration, criticism, checks, judging, and review without silently replacing the primary author's output. Supporting roles select provider-specific model and reasoning or effort settings.
   - Acceptance: Provider contract fixtures prove that named supporting roles resolve to the configured model and reasoning or effort, return linked results, and fail early when the configured capability is unavailable and no explicit fallback is configured.

5. **Free-form task intake**: `nttask` accepts a non-empty task description written by the user.
   - Current: No intake contract exists.
   - Target: Arbitrary links in the description are treated as task context, not as specially modeled GitHub, Google Docs, Linear, or other provider records. The agent researches the repository, asks primary questions, and writes the initial brief.
   - Acceptance: Intake preserves Unicode free-form text and links, rejects an empty task, stops and asks the user when a material referenced source cannot be read, and produces a brief containing scope, constraints, repository baseline, unknowns, and success evidence.

6. **Decision grilling**: `ntgrill` resolves decision ambiguity before planning.
   - Current: No durable decision frontier exists.
   - Target: The primary agent discovers repository facts itself, asks the user only about actual decisions, records the evolving decision frontier, and blocks planning until shared understanding is confirmed.
   - Acceptance: A fixture with unresolved product choices cannot enter planning; after the user confirms all frontier decisions, the brief records them and the run becomes plan-ready.

7. **Research-backed approved plan**: `ntplan` always performs research before producing an approved plan.
   - Current: No research, specification, planning, or approval pipeline exists.
   - Target: Supporting researchers produce evidence; the primary agent creates the specification, plan, dependency graph, and task files; independent critics check them; contradictions and materially better alternatives are discussed with the user; the accepted version is locked with content hashes.
   - Acceptance: Planning cannot complete without a research artifact, independent criticism, resolution or explicit flagging of findings, user approval, at least one executable task, and stored hashes for the approved specification, plan, and task set.

8. **Executable task packets**: An approved plan is divided into immutable, dependency-aware Markdown task packets sized for fresh implementation contexts.
   - Current: No task representation exists.
   - Target: Each task has a unique ID, goal, rationale, scope, out-of-scope boundary, dependencies, acceptance criteria, verification contract, and review risk. Mutable execution status is stored separately from the approved task definition.
   - Acceptance: The CLI rejects duplicate IDs, dependency cycles, missing required sections, unknown dependencies, and mutation of an approved task without a new plan version.

9. **One-task and all-task execution**: `ntwork` implements either all remaining ready tasks sequentially or exactly one ready task.
   - Current: No implementation workflow exists.
   - Target: `ntwork` or `ntwork all` processes ready tasks in dependency order; `ntwork one` selects the next ready task; `ntwork one <id>` selects a specified ready task. The primary agent implements approved work, validates it, obtains risk-weighted review, applies only clearly in-scope fixes, and commits completed tasks.
   - Acceptance: Both modes complete fixture tasks without rerunning completed work; a task cannot close without validation and review evidence; the final task triggers full specification and integration review before the run can complete.

10. **Explicit authority and fail-early behavior**: Agents act only within authority granted by the invoked phase and approved artifacts.
   - Current: No enforceable authority boundary exists.
   - Target: Invalid or corrupted state, unknown schema versions, unavailable configured models, violated invariants, concurrent ownership, and changes outside approved scope stop immediately with a narrated diagnosis. The workflow never silently repairs, migrates, resets, falls back, changes the plan, or expands scope.
   - Acceptance: Negative fixtures for every listed failure leave project files and workflow state unchanged except for append-only diagnostic evidence; review fixes apply automatically only when they unambiguously restore an existing acceptance criterion.

11. **Durable clean-session handoff**: Major phases and interrupted work produce a minimal handoff for a later fresh session.
   - Current: Context survives only in conversation history and the initial research notes.
   - Target: Handoffs record objective, accepted decisions, artifact versions, Git baseline/current state, completed evidence, blockers, next action, and work not to repeat, without requiring raw transcripts in the next context.
   - Acceptance: A fresh-session fixture resumes from a valid handoff, performs no completed step twice, and refuses concurrent takeover of a live session or automatic recovery from corrupt state.

12. **Measured and narrated operation**: The runtime records local normalized telemetry and explains it to the user.
   - Current: `game-67-idle` contains project-specific measurement code; Neotolis Workflow has none.
   - Target: Available tokens, timing, tool calls, retries, errors, context use, agent relationships, review loops, and rework aggregate by session, task, phase, run, and project. `ntstats` narrates what the measurements show; `ntreflect` explains likely causes and improvement options. Structured data remains available locally.
   - Acceptance: Fixture telemetry aggregates without double counting, explicitly labels unavailable provider metrics, never fabricates values, and produces concise evidence-backed narrative reports in the user's language at phase, run, and project scopes.

13. **Automated evaluation without required human judging**: Deterministic runtime behavior and nondeterministic skill quality have separate automated evaluation paths.
   - Current: No test or evaluation harness exists.
   - Target: CLI, schemas, adapters, transitions, and aggregation run deterministic CI tests. Versioned fixture projects exercise skills in live Claude Code and Codex runs. Automated judges score artifacts and outcomes against evidence-backed rubrics; conflicting or borderline verdicts use a second independent judge and adjudicator. A release cannot pass without a final automated PASS.
   - Acceptance: CI runs without model credentials for deterministic tests; release evaluation produces structured scores plus narrated explanations; a missing, unknown, conflicting, or failing verdict blocks release and never triggers automatic candidate repair or rerun.

## Boundaries

**In scope:**

- Provider-neutral workflow contracts for Claude Code and Codex.
- Six public skills: `nttask`, `ntgrill`, `ntplan`, `ntwork`, `ntstats`, and `ntreflect`.
- Agent-only `ntworkflow` CLI and state machine.
- Project-local `.ntworkflow/` artifacts, handoffs, tasks, events, and reports.
- Phase-owned supporting-agent profiles with provider-specific model and reasoning or effort.
- Sequential task execution with one-task and all-task modes.
- Task-level review and final specification/integration review.
- Exact metrics when exposed by the provider and explicit unavailable markers otherwise.
- Deterministic CI plus automated live-agent evaluation fixtures and judges.

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
- Detailed internal contracts for each phase — each phase will be researched and discussed separately after this project specification.

## Constraints

- Major phases start in fresh primary sessions.
- The primary agent remains responsible for canonical phase artifacts.
- Supporting agents receive bounded tasks and return evidence or findings.
- Research is mandatory inside `ntplan`, even when it is a short repository-only pass.
- Approved specification, plan, and task definitions are immutable until a new approved version is created.
- Phase invocation authorizes only the documented outputs and changes of that phase.
- Provider differences must be normalized where possible and disclosed where not.
- Reports contain structured evidence and an agent-written explanation; numbers alone are insufficient.
- CLI-only changes use deterministic CI; skill or provider-adapter changes require automated live evals before release.
- Human evaluation may be performed voluntarily but is never required for the release gate.

## Acceptance Criteria

- [ ] A clean project can install and discover the six public skills in both Claude Code and Codex.
- [ ] Workflow runtime artifacts are written only under gitignored `.ntworkflow/`.
- [ ] The full `nttask → ntgrill → ntplan → ntwork` flow completes on versioned fixture projects in both providers.
- [ ] Invalid phase invocation fails early with an explanation and no unauthorized mutation.
- [ ] `nttask` accepts free-form text and treats arbitrary links as untrusted context rather than authority.
- [ ] `ntgrill` prevents planning while user decisions remain unresolved.
- [ ] `ntplan` always records research, criticism, user discussion where required, approval, and immutable hashes.
- [ ] Approved plans contain one or more valid dependency-aware task packets with separate mutable state.
- [ ] `ntwork all`, `ntwork one`, and `ntwork one <id>` enforce dependencies, validation, review, and completion gates.
- [ ] Task-level review and final integration/specification review cannot silently PASS with missing evidence.
- [ ] Corrupt state, unavailable configured models, concurrent ownership, and out-of-scope changes stop without repair or fallback.
- [ ] Fresh sessions resume from handoffs without repeating completed work.
- [ ] Telemetry aggregates by session, task, phase, run, and project without double counting.
- [ ] `ntstats`, `ntreflect`, and eval judges explain their evidence and conclusions in natural language.
- [ ] Deterministic tests run in CI without models; live skill evals use automated judges and block release without final PASS.

## Edge Coverage

**Coverage:** 21/21 applicable edges resolved · 0 unresolved

| Category | Requirement | Status | Resolution / Reason |
|----------|-------------|--------|---------------------|
| idempotency | R2 | resolved / explicit | Repeated initialization preserves an existing valid run and creates no duplicate state. |
| concurrency | R2 | resolved / explicit | One active writer owns a run transition; a competing session fails early. |
| empty | R5 | resolved / explicit | Empty task text is rejected without creating a run. |
| encoding | R5 | resolved / explicit | Unicode task text and links round-trip without semantic loss. |
| empty | R7 | resolved / explicit | A plan with zero executable tasks cannot be approved. |
| ordering | R7 | resolved / explicit | Task dependencies define legal order; ties use stable plan order and task ID. |
| idempotency | R7 | resolved / explicit | Re-entering an approved plan does not duplicate or mutate it. |
| concurrency | R7 | resolved / explicit | Only one active planning session may own a run. |
| adjacency | R8 | resolved / explicit | Task IDs are unique; duplicate or colliding task definitions are rejected. |
| empty | R8 | resolved / explicit | Required task sections and acceptance criteria cannot be empty. |
| ordering | R8 | resolved / explicit | Dependency cycles and unknown dependency targets are rejected. |
| idempotency | R8 | resolved / explicit | Mutable status cannot alter the approved task packet. |
| empty | R9 | resolved / explicit | No ready task produces an explanation and no project mutation. |
| ordering | R9 | resolved / explicit | All-task mode follows dependencies and stable plan order sequentially. |
| idempotency | R9 | resolved / explicit | Completed tasks are never executed or committed twice. |
| concurrency | R9 | resolved / explicit | A live task lease blocks another implementation session. |
| empty | R12 | resolved / explicit | Missing metrics are narrated as unavailable rather than zero or fabricated. |
| ordering | R12 | resolved / explicit | Reports preserve session, task, phase, run, and project chronology. |
| idempotency | R12 | resolved / explicit | Stable event and call IDs prevent duplicate aggregation. |
| idempotency | R11 | resolved / explicit | Resuming a valid handoff does not repeat completed work. |
| concurrency | R11 | resolved / explicit | A live session cannot be taken over; corrupt state is not recovered automatically. |

The remaining raw taxonomy candidates were dismissed by relevance after shape
review: fixed command/role sets have no meaningful adjacency, empty, or sorting
semantics beyond the explicit contracts above.

## Prohibitions (must-NOT)

**Coverage:** 3/3 applicable prohibitions resolved · 0 unresolved

| Prohibition | Requirement | Status | Verification / Reason |
|-------------|-------------|--------|-----------------------|
| External linked content MUST NOT expand agent authority or override the user-approved workflow scope. | R5/R10 | resolved | test — adversarial linked-content fixture must not cause unauthorized actions. |
| The workflow MUST NOT emit PASS when required evidence, a gate, or an automated judge verdict is missing, unknown, conflicting, or failing. | R9/R13 | resolved | test — negative gate fixtures must remain blocked. |
| Reports and judge packets MUST NOT contain raw secrets from transcripts. | R12/R13 | dismissed | The owner explicitly excludes mandatory redaction/privacy hardening from v1 to keep this personal local workflow simple. |

Canon security and compliance hardening remains outside this project specification
and may be audited separately if the tool's deployment scope changes.

## Ambiguity Report

| Dimension | Score | Min | Status | Notes |
|-----------|-------|-----|--------|-------|
| Goal Clarity | 0.97 | 0.75 | ✓ | Installable dual-provider workflow with explicit end-to-end outcome. |
| Boundary Clarity | 0.94 | 0.70 | ✓ | Milestones, source adapters, cloud state, and privacy hardening explicitly excluded. |
| Constraint Clarity | 0.96 | 0.65 | ✓ | Authority, fail-early behavior, sessions, platforms, providers, and evaluation locked. |
| Acceptance Criteria | 0.92 | 0.70 | ✓ | Deterministic and agent-evaluated gates are pass/fail. |
| **Ambiguity** | **0.05** | **≤0.20** | **✓** | Ready for phase-by-phase discussion. |

## Interview Log

| Round | Perspective | Question summary | Decision locked |
|-------|-------------|------------------|-----------------|
| 1 | Researcher | What constitutes v1 and how tasks enter? | Installable Claude/Codex package; free-form text with arbitrary contextual links and no source adapters. |
| 2 | Simplifier | Platforms, end-to-end proof, and statistics scope? | Windows/macOS/Linux; deterministic CI plus automated live eval; aggregation through project level. |
| 3 | Failure Analyst | Judges, corrupt state, and unavailable models? | Independent adjudication; fail early; no implicit repair or model fallback. |
| 4 | Boundary Keeper | What does phase invocation authorize? | Only documented phase outputs and approved tasks; review fixes only restore locked criteria. |
| 5 | Edge/Prohibition | Repetition, concurrency, empty inputs, and must-NOT behavior? | Single ownership, durable resume, no assumptions on missing input, linked content grants no authority, and unknown evidence never passes. |

## Phase Discussion Sequence

Detailed HOW decisions are intentionally deferred. Discuss one phase per fresh
session, starting from this specification and current reference research:

1. `nttask` — intake, repository scouting, brief, and task-source boundaries.
2. `ntgrill` — decision tree, interaction model, confirmation, and persisted decisions.
3. `ntplan` — mandatory research, synthesis, plan/task formats, criticism, convergence, and approval.
4. `ntwork` — one/all execution, checkpoints, validation, review, fixes, commits, and final integration gate.
5. `ntstats` — telemetry normalization, aggregation, availability, and narrated reporting.
6. `ntreflect` — causal analysis, recommendations, and non-mutating behavior.
7. Cross-cutting runtime — state machine, providers, agent profiles, installation, evaluation harness, and schema/versioning.

Each discussion must research the relevant local references and current
competitors before locking implementation decisions.

---

*Project: neotolis-workflow*
*Spec created: 2026-08-09*
*Next step: discuss `nttask` in a fresh session.*

