# `ntwork` Phase Contract

**Status:** Confirmed on 2026-08-09
**Inputs:** Approved `.ntworkflow/runs/<run-id>/SPEC.md`,
`.ntworkflow/runs/<run-id>/PLAN.md`, and
`.ntworkflow/runs/<run-id>/tasks/<id>.md`
**Completed state:** `delivery-ready`

## Purpose

`ntwork` implements one approved plan in its recorded stable order, verifies
the result with fresh evidence, obtains independent test and code review, and
leaves the work ready for the user's delivery path.

The primary user-facing agent owns every decision, task acceptance, canonical
execution result, commit, and delivery action. Supporting agents receive
bounded contexts. They never change scope, approve their own work, or replace
the primary agent's judgment.

The phase deliberately keeps a small execution surface. It has no hashes,
approval manifests, repository-drift monitoring, standalone `VALIDATION.md`,
default worktree, formal TDD ceremony, or separate fixer and advisor roles.

## Identity and states

The active workflow has one project-local ordered work ID assigned when
`nttask` creates the run, for example `NT-007`. `ntplan` derives task IDs from
that work ID and the approved stable order:

```text
NT-007-01
NT-007-02
NT-007-03
```

The exact allocator and storage schema belong to the cross-cutting runtime
contract. `ntwork` treats a missing, duplicate, or malformed required ID as an
invalid input rather than inventing one.

The minimal work-state progression is:

```text
plan-approved -> work-active -> delivery-ready
```

`delivery-ready` is the next passive workflow phase, not another state owned
by `ntwork`. The cross-cutting lifecycle later closes it as `work-complete`.

Task state is separate:

```text
pending -> active -> completed
```

A blocker is a stop reason recorded in execution status, not another normal
workflow state. Mutable execution status records the assigned branch and base,
pull request when present, next and active task, completed tasks, task and fix
commits, concise fresh evidence, verdicts, and the current blocker. It does not
rewrite the approved artifacts during ordinary execution.

## Invocation gate and authority

`ntwork` may start only when:

- the active run is `plan-approved` or already `work-active`;
- SPEC, PLAN, and every indexed task packet exist and are readable;
- artifact structure, acceptance ownership, dependency graph, and stable order
  remain valid;
- at least one task exists;
- the current session can acquire sole phase ownership;
- the repository is on a normal branch rather than detached HEAD; and
- the recorded branch and pull-request identity, when present, still identify
  the current work.

The phase may read the approved artifacts, repository instructions, relevant
repository files, tests, Git and pull-request state, and sources needed to
resolve an execution fact. It may change project code and tests only for the
active task or an accepted in-scope finding. The primary may write mutable
execution status in `.ntworkflow/state.json`; provider hooks may independently
append telemetry.

It does not repeat normal planning research, criticism, or approval. The sole
exception is the explicitly user-authorized amendment path defined below.

## Git working context and optional delivery

`ntwork` works in the current checkout and records the current branch before
the first task commit. By default it does not require a dedicated branch, push,
pull request, hosting provider, or CI. When the user, repository, or approved
plan requires one, the primary performs that delivery action and records its
identity when applicable.

`ntwork` does not create a Git worktree unless the user explicitly requests
one. It never stashes, cleans, resets, rebases, force-pushes, or resolves a Git
conflict automatically.

Pre-existing project-file changes require explicit user permission before they
can be included. They must fit an approved packet; otherwise the amendment path
is required. Workflow-owned `.ntworkflow/` changes do not by themselves block
execution, but they are never staged into task commits automatically.

When a pull request is used, one pull request carries the whole work. Later
task and fix commits update it, and re-entry reuses it while its recorded
identity still matches. A pull-request mismatch blocks only that delivery path
for a user decision; absence of a pull request is valid only when none is
required.

## Modes, readiness, and order

- `ntwork` and `ntwork all` execute all remaining tasks sequentially.
- `ntwork one` executes exactly the next task.
- `ntwork one <id>` executes only when `<id>` is exactly the next task.

The next task is the first incomplete task in PLAN's approved stable order. It
is ready only when every dependency and every earlier task in that order is
completed and no other task is active. A later independent task cannot be
selected early. Unknown, completed, dependency-blocked, or out-of-order IDs
stop without project mutation and report the correct next task.

Implementation is never parallel. Only one primary session and one bounded
implementation or fix call may own project writes at a time.

## Agent topology and context

### Primary agent

The primary agent owns:

- preflight, readiness, stable-order selection, and phase ownership;
- all user interaction and scope decisions;
- the bounded prompt for each implementer and reviewer;
- inspection of the resulting diff;
- canonical verification evidence;
- finding adjudication and amendment decisions;
- task completion, commits, Git working context, optional delivery, and
  workflow status; and
- final synthesis and delivery reporting.

### Task implementer

Every task receives one fresh logical `implementer`. It may edit production
code, tests, and necessary test infrastructure inside the current task's
approved scope. It may run focused checks for author feedback.

It may not edit SPEC, PLAN, task packets, execution status, branch configuration,
or Git history; expand scope; decide a user question; mark a task complete; or
commit. Questions, gaps, contradictions, and material alternatives return to
the primary agent before further affected work.

The implementer receives:

- the complete current task packet;
- the approved SPEC;
- relevant overall approach and cross-task constraints from PLAN;
- repository instructions;
- the identities of completed direct dependencies; and
- any prior ruling that directly constrains this task.

It does not receive future or unrelated packets, planning transcripts, raw
telemetry, or accumulated histories from earlier implementers. Current code is
the source of truth for completed dependency results.

### Task reviewer

One required read-only `task-reviewer` receives the current packet, applicable
SPEC and PLAN constraints, the complete current task diff, and the primary
agent's fresh verification evidence. It returns two separate verdicts:

```text
Packet compliance: PASS | BLOCK
Code and test quality: PASS | BLOCK
```

Both must PASS after the last relevant project change. The reviewer does not
edit files, fix findings, change scope, commit, or close the task.

### Final reviewers

After whole-plan validation, the read-only `nyquist-auditor`,
`spec-integration-reviewer`, and `code-reviewer` independently inspect the same
current revision. They may run in parallel. Each returns its own verdict; no
verdict can mask another.

### Review inputs

For each task or final review boundary, the primary gives every applicable
reviewer the same current revision, relevant approved artifacts and diff, and
concise verification results, plus the reviewer's own lens. This input is not
a new artifact or durable evidence packet.

## Scope and amendment

`ntwork` owns implementation details, local instruction errors, necessary file
selection, tests, test infrastructure, approved edge cases, regressions, and
small refactors required to deliver the existing contract. A materially better
alternative may be adopted without user discussion only when it remains a
local implementation detail and preserves the approved observable result,
public contract, acceptance ownership, dependencies, and stable order.

If execution requires changing SPEC, PLAN, a task packet, acceptance ownership,
the task set, dependencies, stable order, scope, public behavior, compatibility,
or a confirmed user decision, implementation stops and the primary agent:

1. explains the defect, proposed artifact changes, and impact;
2. waits for explicit user permission;
3. changes only the permitted artifacts;
4. performs only the focused research needed by new claims, structural
   validation of the complete current artifact set, and a fresh independent
   critic review;
5. presents the revised result and stable order; and
6. waits for explicit reapproval before project implementation continues.

This is an exceptional amendment path, not a routine planning loop and not an
automatic invocation of `ntplan`. Historical task commits and recorded status
remain historical facts. Packet and acceptance metadata may be corrected as
needed to restore a valid uniquely owned artifact set. If already completed
behavior needs new implementation, the revised plan adds a corrective task.

## Task lifecycle

For each ready task, the primary agent:

1. marks it active and records the preceding completed-task boundary;
2. launches a fresh implementer with the bounded context;
3. inspects the resulting project diff;
4. runs one canonical fresh task-local and cumulative verification pass;
5. dispatches the task reviewer on that diff and evidence;
6. sends confirmed in-scope findings to the same active implementer;
7. repeats verification and both reviewer verdicts after every relevant fix;
8. creates one dedicated primary task commit after both verdicts PASS;
9. verifies that all task project changes are committed while workflow-runtime
   dirt remains excluded;
10. pushes or updates the pull request only when that delivery path is in use;
    and
11. marks the task completed.

The implementer's own focused checks are useful author feedback but are not a
second completion gate. The primary agent's post-change run is the canonical
task evidence.

Each task has one dedicated primary commit. A failure discovered only after
that commit, including CI, Nyquist, or final review, may require an ordinary
clearly linked fix commit. Published commits are not amended or force-pushed.

## Production code, tests, and verification

Tests are mandatory for every testable behavior or logic change. Formal
test-first TDD ordering is not required.

A task adds or updates relevant automated tests in the same task unless
existing direct coverage already protects the changed behavior. Existing tests
count only when they can distinguish the incorrect result from the required
one. A task cannot close by deferring proof of its own result.

Missing test infrastructure is added by the earliest task that needs it. It is
a separate prerequisite task only when it is shared, substantial, or
independently necessary. When automated coverage is genuinely impractical, the
approved packet must explain why and provide reproducible alternative evidence.
Non-code work uses the applicable automated check or reproducible inspection.

The canonical task verification includes:

- every command or procedure in the current packet;
- relevant tests for the changed behavior;
- regression checks for completed behavior the current diff can affect;
- integration checks first enabled by the task's dependency closure; and
- applicable repository gates for this kind of change.

This is impact-based cumulative verification, not a mechanical rerun of every
previous task's tests. Uncertain impact selects the broader safe check. Fresh
evidence is produced after the last relevant project change and records the
procedure, current revision, result, and expected condition concisely in
execution status. Raw logs remain audit data. No standalone validation artifact
is created.

## CI when required

When the user, repository, or approved plan requires CI, it runs on the
accumulating work without making every successful run a task checkpoint.
`ntwork` does not wait for a pending run before starting the next task.

If required CI becomes known to be red, the current active task may reach its
normal boundary, but no new task starts. The primary agent maps the finding to
the affected approved task or integration boundary, launches a fresh bounded
implementer for that finding, runs applicable verification and task review,
commits the fix, and resumes stable-order execution. Fix work never runs in
parallel with an active task implementer.

Required CI must PASS on the final current revision before `delivery-ready`.
When no CI is required, the CI gate is satisfied without creating a pull
request. Conflicting or materially flaky evidence cannot become PASS merely
through retries; it must be fixed or reported as a blocker.

## Whole-plan validation

After every task is completed and known CI findings are resolved, the primary
agent runs PLAN's exact final-validation procedures on the current branch. This
includes every applicable full suite, build, typecheck, lint, integration,
regression, benchmark, visual, and manual procedure, with its expected pass
condition and fresh-evidence requirement.

Failure remains in the bounded fix loop when it is inside the approved
contract. A finding that changes that contract uses the amendment path.

## Read-only Nyquist audit

One required read-only `nyquist-auditor` receives the complete current SPEC,
PLAN, task set, implementation, tests, concise executed evidence, and relevant
CI results. It maps every acceptance ID to an executed automated test or the
approved reproducible alternative and checks:

- test presence and relevance;
- correctness and behavioral strength;
- meaningful edge and error paths;
- regression coverage;
- disabled, skipped, circular, or mock-only assertions;
- isolation and reproducibility; and
- material flakiness risk.

It returns `PASS` or `BLOCK` with concise gaps. It never edits production code,
tests, planning artifacts, or status and never invents new product requirements.

## Final reviews and fix loop

The final order is:

```text
whole-plan validation
-> independent Nyquist, specification/integration, and code reviews
-> required CI, when configured
-> delivery-ready
```

The three read-only final reviews may run in parallel on the same current
revision. All applicable final PASS results must apply to that revision. An
in-scope review or CI finding receives one fresh bounded implementer call for
the affected task or integration boundary, followed by affected verification
and review.

When no finding or fix remains, the complete final gate runs once on the
resulting revision. A later change invalidates that candidate and requires one
new final gate. There is no separate fixer role or arbitrary round limit. The
same material blocker recurring without progress stops for the user.

## Interruption and re-entry

Only the lifecycle of one active task may continue after interruption. This
includes its implementation, fix, verification, task review, commit, push, or
remote-only evidence wait. A fresh primary session validates sole ownership,
execution status, the current branch, any recorded pull request, and the actual
diff, then uses a fresh implementer if more code changes are required.

Completed tasks are not rerun. A completed durable action on an unchanged task
revision, such as an existing commit, push, or recorded pull request, is reused
rather than duplicated. An unfinished task verdict or a verdict invalidated by
later changes is rerun.

Interrupted whole-plan validation, Nyquist, final review, amendment review, or
delivery judgment is not resumed from a partial reasoning trace. The affected
gate starts again because partial analysis cannot prove that its full checklist
was completed. Other workflow phases remain non-resumable for the same reason:
their canonical result depends on complete synthesis or review, not merely a
durable project diff.

## Repeated invocation and errors

Re-entry is idempotent: before creating a commit or performing an optional
delivery action, the primary checks recorded state and current Git or hosting
state, then reuses an existing matching result. Ambiguity blocks the affected
action rather than being silently guessed.

Ordinary product, test, build, integration, or review failures inside approved
scope enter the bounded fix loop. The invocation stops with the concrete reason
when required evidence cannot be obtained, evidence conflicts, an authority or
state invariant is violated, or safe progress requires a user decision. This
includes invalid current state, unreadable artifacts, unavailable required
evidence, actual failure to launch a configured required role, concurrent
ownership, out-of-order selection, a mismatch in the active Git or delivery
context, material flakiness, tool or authentication failure, and unresolved
Git conflicts.

There is no proactive model-availability ceremony, implicit model fallback,
automatic repair, migration, destructive Git recovery, plan mutation, or scope
expansion.

Invocation at `delivery-ready` reports that implementation is complete and
the run is in the user's passive delivery period; it does not inspect Git or
GitHub for a merge. After closure the current slot is empty, so a later
invocation reports that there is no active run; it does not infer a terminal
status from retained artifacts.

## Narration and delivery

Routine narration is deliberately minimal:

```text
Starting <task>
Completed <task>
Blocked: <reason>
```

Before delivery, the primary agent shows one concise current-revision summary:
task completion, whole-plan validation, Nyquist, both final reviews, required
CI, and the pull-request link when present. Raw tool output and full agent
reports appear only on request.

After final reviews and any required CI pass, the run enters `delivery-ready`.
When a pull request is required, the primary marks it ready as the final
delivery action.

`ntwork` never merges merely because gates passed. Its authority ends at
`delivery-ready`. During that passive phase the user decides what review,
checks, fixes, or delivery actions to perform; the workflow neither governs nor
validates them.

## Completion gates

`delivery-ready` requires all applicable results on the same current revision:

1. every approved task is completed in stable order;
2. every task has its primary commit and fresh task evidence;
3. no known scope, ownership, state, artifact, or required-CI blocker remains;
4. whole-plan validation passed;
5. Nyquist returned PASS;
6. specification/integration review returned PASS;
7. code review returned PASS;
8. every configured required CI check passed; and
9. every delivery action required by the user, repository, or approved plan is
   complete, including a ready pull request when one is required.

`delivery-ready` is the completion boundary of `ntwork`. Closing the passive
phase as `work-complete` belongs to the cross-cutting lifecycle and requires
either the user's explicit delivery report or the start of a new non-empty
task; it never depends on automated merge inspection.

## Acceptance scenarios

- `ntwork all` executes remaining tasks sequentially without waiting for green
  background CI between successful task boundaries.
- `ntwork one <id>` rejects an ID that is not the exact next task.
- Each task gets a fresh implementer, mandatory tests for testable behavior,
  canonical primary verification, two task-review verdicts, and a dedicated
  primary commit.
- A known red CI run stops the next task and receives a bounded non-parallel
  fix.
- A plan defect pauses implementation and changes artifacts only after explicit
  permission, critic review, and reapproval.
- An interrupted active task continues from durable code and status; a partial
  final audit restarts.
- Nyquist reports test gaps but never edits code or tests.
- A final code or test fix restarts validation, Nyquist, both final reviews, and
  required CI.
- A dedicated branch, push, pull request, and hosted CI are used only when
  required by the user, repository, or approved plan; their absence otherwise
  does not weaken the review gates.
- Invalid state, concurrent ownership, conflicting evidence, missing required
  evidence, or an external mismatch stops without silent recovery.
