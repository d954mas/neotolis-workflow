# Neotolis Workflow Runtime Contract

**Status:** Confirmed on 2026-08-10
**Implementation:** Not started

## Purpose

The runtime provides the smallest shared contract needed by `nttask`,
`ntgrill`, `ntplan`, `ntwork`, `ntstats`, and `ntreflect`: legal transitions,
one current owner, durable current state, fixed artifact locations, native
provider identity, and local telemetry. Phase contracts own all phase-specific
reasoning and gates.

The runtime is not an orchestrator, scheduler, replay engine, model router, or
agent launcher.

## Public and internal surfaces

The public surface is exactly the six skills above. `ntworkflow` is an
agent-only, non-interactive CLI. It accepts machine-readable input, emits JSON,
and uses stable nonzero exit codes for failures. Users are never required to
invoke it directly.

The internal semantic operations are:

```text
status
run start | cancel | complete
phase begin | complete | stop
task begin | complete
plan validate
work record
telemetry ingest | query
```

Artifact checks are part of the transitions they protect. `plan validate`
remains separate because `ntplan` requires the same complete-set validation
before critic review and before approval. There is no generic `set-state`,
`force`, `repair`, `migrate`, `reset`, `route`, `launch-agent`, or fallback
operation.

## Project layout

Every run owns one permanent directory from creation:

```text
.ntworkflow/
  state.json
  runs/
    NT-007/
      BRIEF.md
      SPEC.md
      PLAN.md
      tasks/
        NT-007-01.md
  telemetry/
    claude/
      <native-session-id>.jsonl
    codex/
      <native-session-id>.jsonl
```

Files appear only when their phase creates them. A run directory is never
moved. It remains in place after `work-complete` or `canceled`, including any
useful partial artifacts from a canceled run.

There is no artifact registry, manifest, runtime handoff, event journal,
separate work-status file, retained research packet, or artifact-version
archive. Git tracking policy remains entirely the user's choice.

## Current state

`.ntworkflow/state.json` is the only mutable workflow-state file. Its
normative shape is:

```text
State {
  next_work_number: integer >= 1,
  current: null | Current
}
Current {
  run_id: NT-xxx,
  lifecycle: intake-active | brief-ready | plan-ready | plan-approved |
             work-active | delivery-ready,
  phase: null | nttask | ntgrill | ntplan | ntwork | delivery-ready,
  owner: null | { session_id: claude:<native-id> | codex:<native-id> },
  blocker: null | string,
  work: null | Work
}
Work {
  tasks: [Task],
  provider: null | claude | codex,
  branch: null | string,
  base_branch: null | string,
  pull_request: null | { id: string, url: string },
  head_commit: null | string,
  fix_commits: [string],
  evidence: [{
    gate: string,
    procedure: string,
    revision: string,
    result: string,
    expected: string,
    source_ids: [string]
  }],
  verdicts: {
    whole_plan: pending | pass | fail,
    nyquist: pending | pass | block,
    spec_integration: pending | pass | block,
    code_review: pending | pass | block,
    ci: pending | pass | fail
  }
}
Task {
  task_id: NT-xxx-yy,
  status: pending | active | completed,
  start_commit: null | string,
  commit_id: null | string,
  packet_review: pending | pass | block,
  quality_review: pending | pass | block
}
```

`work` is `null` before `plan-approved` and is initialized from the approved
task set for `plan-approved`, `work-active`, and `delivery-ready`. At most one
task is `active`. `provider` is set on entry to `work-active` and remains
unchanged through `delivery-ready`. Native reviewer `PASS | BLOCK` values are
stored as lowercase `pass | block`; executable validation and CI use
`pass | fail`. Evidence stores the concise procedure, revision, observed
result, expected condition, and native source IDs required by `ntwork`; raw
evidence content remains in its native source.

It does not retain completed session history, subagent relationships, or event
timelines. It is not copied into run directories.

State has no schema-version field. The runtime accepts one exact structure.
Missing, unknown, or wrongly typed fields stop the operation. There is no
migration or compatibility fallback.

## Lifecycle

The only normal progression is:

```text
intake-active
  -> brief-ready
  -> plan-ready
  -> plan-approved
  -> work-active
  -> delivery-ready
  -> work-complete
```

`canceled` is terminal and is legal from `intake-active`, `brief-ready`,
`plan-ready`, `plan-approved`, or `work-active`.

`delivery-ready` is passive. It becomes `work-complete` when the user says the
work is finished or starts a new non-empty `nttask`. This records the user's
decision to close the run; Neotolis never inspects Git or a hosting service to
prove delivery or merge.

`work-complete` and `canceled` release the current slot while leaving the run
directory intact. A blocker is data, not a lifecycle state. There are no
`failed`, `paused`, `retrying`, `recovering`, `grill-active`, or `plan-active`
states.

An empty `nttask` creates nothing. A different intent before `delivery-ready`
requires explicit cancellation. An illegal invocation reports the actual
state and correct next action without mutation. No phase starts another phase
automatically. `ntstats` and `ntreflect` never transition state.

## Identity

The runtime uses only:

```text
run       NT-007
task      NT-007-01
phase     ntplan
session   claude:<native-id> | codex:<native-id>
subagent  <provider-native-id> + phase-owned role
```

There is no extra run UUID, phase-invocation ID, synthetic session ID, hash,
or fingerprint.

## Ownership and concurrency

A state-changing phase has exactly one primary owner, identified by provider,
native primary-session ID, and phase. Only that primary may mutate state,
canonical workflow artifacts, task status, Git history, branch, or pull
request.

Supporting agents never mutate workflow state or canonical workflow
artifacts. The `ntwork` implementer is the sole exception for project files:
it may edit code and tests inside the active task's approved scope. It may not
commit, change Git or pull-request identity, edit planning artifacts, or close
its task. At most one implementation or fix call owns project writes at a
time. Read-only supporting calls may run in parallel only where their phase
contract permits it.

Ownership has no timeout or TTL. A new primary may replace a recorded owner
only after the provider reports that the old invocation ended or the user
explicitly confirms its interruption. A user instruction to cancel is itself
sufficient authority to stop current work and cancel the run; no additional
runtime ceremony is required. Late supporting-agent results are ignored and
cannot mutate state.

`phase begin` atomically records `phase` and `owner` only when the lifecycle
allows that phase and no owner exists. A non-null blocker stops begin unless
the user explicitly confirms that it is resolved; that begin commit clears the
blocker. Successful `phase complete` by the same owner validates the phase
artifacts, requires `blocker: null`, advances lifecycle, and clears that
state-changing phase and owner in one state commit; `delivery-ready` remains
as a passive phase label with no owner. Controlled `phase stop` by the owner,
or after provider-confirmed or user-confirmed interruption, clears phase and
owner without advancing lifecycle and may record a blocker. Cancellation uses
`run cancel`, not `phase stop`. Unexpected interruption leaves ownership
recorded until one of those explicit release conditions occurs.

## Supporting roles

Provider-native agent definitions are the only source of each role's prompt,
model, and effort or reasoning setting. The runtime knows the expected role
name and whether its native invocation succeeded; it has no shared profile
schema, model translation, override layer, or fallback.

Phase-owned roles are:

- `nttask`: optional `scout`;
- `ntplan`: required `researcher` and `critic`;
- `ntwork`: required `implementer`, `task-reviewer`, `nyquist-auditor`,
  `spec-integration-reviewer`, and `code-reviewer`;
- `ntreflect`: `transcript-analyst` when a causal claim requires transcript
  evidence;
- `ntgrill` and `ntstats`: none.

Failure behavior remains phase-owned. Missing optional scouting does not stop
intake. A missing required planning or work role stops that phase. A missing
analyst prevents an unsupported causal claim rather than inventing one.

## Provider adapters and installation

Claude Code and Codex each receive one native user-level plugin. Each plugin
contains the same six logical skills, native agent definitions, a thin
provider adapter, telemetry hooks, and an exact bundled or discoverable
`ntworkflow` executable.

Adapters only:

- expose native session and agent identities;
- call the internal CLI from skills and hooks;
- normalize documented provider telemetry;
- locate installed native definitions and the CLI.

They do not spawn headless provider processes, launch supporting agents,
select roles, translate models, or choose fallbacks. The primary invokes a
known native definition through the current chat's native subagent tool.

Neotolis supports global installation only in v1. Project-local role, model,
or effort overrides are not supported. A missing required installed component
stops the invocation without downloading, repairing, or substituting anything.

## Provider switching

The provider may change at a completed phase boundary. After confirmed
interruption, a non-resumable `nttask`, `ntgrill`, or `ntplan` invocation may
also restart from its previous durable boundary under the other provider; this
is a new invocation, not continuation.

An active `ntwork` task may resume only under the same provider. Read-only
`ntstats` and `ntreflect` may use either provider at any time.

## Interruption and re-entry

Only one active `ntwork` task lifecycle may continue after interruption. A
fresh primary validates ownership, state, the assigned branch and pull
request, the actual diff, completed-task boundaries, and native Git or hosting
identities before continuing. It uses a fresh implementer when more project
changes are required.

Interrupted intake, grilling, planning, amendment reasoning, whole-plan
validation, Nyquist, final reviews, and delivery judgment restart from their
last durable boundary. Partial reasoning is never resumed.

Existing commit, push, or pull-request work is reused only when run ID, task
ID, assigned branch, saved commit boundary, and native IDs prove one exact
match. Missing or competing matches block; the runtime never creates a
duplicate or selects the closest candidate.

## Artifacts and amendment

Artifact identity comes from fixed run-relative paths, never registration:

```text
.ntworkflow/runs/<run-id>/BRIEF.md
.ntworkflow/runs/<run-id>/SPEC.md
.ntworkflow/runs/<run-id>/PLAN.md
.ntworkflow/runs/<run-id>/tasks/<task-id>.md
```

Markdown artifacts have no schema versions. Each protected transition checks
the exact structural contract owned by its phase. State advances only after
the required current artifacts were written and validated.

A user-authorized `ntwork` amendment edits the canonical planning files in
place. It is not approved until complete-set validation, a fresh critic PASS,
and explicit user reapproval. There is no draft generation, backup, or
rollback. If interruption leaves a mixed or invalid set, the next invocation
stops and the user decides whether to correct it, repeat the amendment, or
cancel the run.

## Atomicity and failure

State mutations take a short project-local lock and replace `state.json`
atomically. Code and Markdown edits are ordinary file operations; the runtime
does not pretend that a multi-file artifact rewrite is one filesystem
transaction.

A transition validates its preconditions and required artifacts before the
state commit. Failed state replacement leaves the previous state intact. A
new run directory is prepared before switching state to it. An unexpected
partial directory blocks instead of being repaired or removed automatically.

Telemetry is attempted after the state commit and is never part of its commit
point. Invalid state, illegal transitions, ownership conflicts, missing
required roles, inconsistent artifacts, scope violations, ambiguous external
results fail early. There is no silent
repair, migration, reset, retry state, plan change, scope expansion, guessing,
or fallback.

A telemetry ingest failure rejects only that telemetry record and returns a
warning; it never reverses a committed state change or turns the workflow
operation into failure. An unsupported format fails only the affected
`telemetry query`, `ntstats`, or `ntreflect` request.

## Runtime events and telemetry

There is no separate runtime event stream. Run, phase, task, session, agent,
and tool boundaries are telemetry event types.

Telemetry is stored per provider-native session. Each JSONL row carries a
telemetry `format` version plus available provider, native identity,
timestamps, `run_id`, phase, task, lifecycle status, and numeric metrics. A
row contains no prompts, hidden reasoning, commands, tool arguments, model
responses, tool-result content, or binary/base64 payloads.

`ntstats` finds a run by scanning session journals for its `run_id`; there is
no index or aggregate cache. Telemetry never determines legal state,
ownership, completion, or approval, and state is never reconstructed from it.
Missing telemetry makes statistics partial, unavailable, or empty but cannot
block workflow work. An unsupported telemetry format stops only the affected
`ntstats` or `ntreflect` query.

If every record proving a deleted session journal is also gone, the runtime
reports no data rather than claiming to know that a journal was deleted.

Read-only means that `ntstats` and `ntreflect` do not mutate state, canonical
artifacts, or project files. Provider hooks may independently append telemetry
for their own sessions. Human-readable failures are returned in CLI or skill
output; there is no diagnostic journal.

## Deterministic verification

Required runtime tests use no model credentials or network service. They use
temporary fixture repositories, recorded Claude Code and Codex hook payloads,
fake native-agent outcomes, local Git repositories, a fake pull-request
adapter, a controllable clock, fault injection, and native filesystem/locking
primitives.

The suite covers all legal and illegal transitions, ID allocation, concurrent
ownership, cancellation, interruption, restart versus resume, provider
switching, sequential task execution, role availability, strict state shape,
artifact failures, state commit failures, Git and pull-request idempotency,
telemetry attribution and availability, unsupported telemetry formats, and
Windows/macOS/Linux path and locking behavior.

Live provider smoke tests may exist separately. They are not deterministic CI
gates.
