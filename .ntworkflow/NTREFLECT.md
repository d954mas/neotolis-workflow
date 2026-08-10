# `ntreflect` Phase Contract

**Status:** Confirmed on 2026-08-10
**Public entry point:** `ntreflect`
**Legal input:** Any workflow state, including no active run
**Workflow transition:** None
**Canonical artifact:** None
**Fresh primary session:** Not required

## Purpose

`ntreflect` investigates how the work was performed. It finds material process
problems that are visible in the available evidence, identifies a confirmed or
probable cause, and recommends the simplest well-supported improvement.

It does not validate implementation quality, repeat tests, CI, Nyquist, or
reviews, or reopen completed gates. Existing gate results are process signals
only, for example evidence of late discovery or repeated fix work.

The phase does not promise to discover every process problem. Its conclusions
are limited to what the selected evidence can support.

## Scope

`ntreflect` inherits selector resolution, session, task, phase, run, and project
scope semantics, default selection, active-scope handling, and availability
semantics from `.ntworkflow/NTSTATS.md`.

Unlike the concise `ntstats` presentation, `ntreflect` receives the complete
normalized dataset for the selected scope without the top-20 or other display
limits. An unfinished scope remains preliminary.

`ntstats` and `ntreflect` are read-only queries rather than major
state-changing phases. Neither requires a fresh primary session.

## Evidence

The internal CLI supplies one complete normalized snapshot under the existing
`ntstats` telemetry contract, including availability markers and the source
identities needed to locate related evidence. It does not create another
telemetry schema, cache, database, or report artifact.

Invoking `ntreflect` is explicit read-only permission to open available
provider transcripts and tool results inside the selected scope. No additional
confirmation is required for each session, and raw content is not copied into
`.ntworkflow/`.

Workflow state, canonical artifacts, execution evidence, and existing gate
results may also be read when they help explain the process. External research
is used only when a recommendation depends on a current provider capability,
setting, API, version, or other external fact; such claims use current primary
sources.

All causal evidence uses the same logical snapshot cutoff. Later events from
the current reflection are not mixed into its input. An active scope remains
preliminary rather than pretending to be closed.

## Analysis and supporting agents

The primary agent:

1. examines the complete normalized data and relevant workflow context;
2. gives bounded transcript questions or regions to read-only supporting
   analysts; and
3. compares the returned evidence and writes the user-facing conclusion.

Transcript investigation is not limited to numerical anomalies. Workflow
context or a bounded transcript overview may expose an incorrect assumption,
premature choice, unnecessary question, or other problem that aggregates do
not reveal.

One logical phase-owned supporting role handles transcript analysis. The
primary may make as many independent bounded calls as the material evidence
requires, including parallel calls, without a fixed quota or review loop. Each
call returns a concise evidence-backed conclusion or an explicit uncertainty.

If an analyst needed for a causal conclusion fails to launch, the primary does
not silently replace it or claim the unsupported cause.

## Interpretation

High token, tool-call, duration, or result-character values are investigation
signals, not problems by themselves. Terms such as unnecessary, excessive,
caused, or wrong require transcript or workflow evidence rather than an
aggregate alone.

Each material finding distinguishes:

- the observed evidence;
- the process impact;
- the cause; and
- the recommended change.

A cause is:

- **confirmed** when direct evidence establishes it;
- **probable** when independent signals converge without direct proof; or
- **unknown** when the available evidence cannot distinguish explanations.

There are no numerical confidence scores. An unknown cause is not replaced by
an invented root cause.

## Materiality and comparison

`ntreflect` has no efficiency score, universal token or time budget, fixed
threshold, mandatory finding count, or comparison between unlike tasks.

A finding is reported only when the evidence shows material impact on time,
context, cost, repeated work, or process reliability. Cross-run comparison is
used in project scope or on explicit request only for genuinely comparable
actions or recurring patterns.

## Recommendations and output

Each problem receives one primary recommendation chosen for simplicity,
reliability, expected effect, and compatibility with Claude Code and Codex.
Alternatives appear only when there is a real tradeoff or user decision.

A recommendation is the simplest well-supported change, not a promise of
guaranteed improvement. There is no mandatory verification section.

The answer stays natural and concise rather than following a rigid report
template. It normally identifies the selected scope, material evidence limits,
and findings in impact order. Each finding explains the problem, cause, and
recommended change. If no material problem is supported, `ntreflect` says so
without padding the answer with generic advice, artificial praise, or a fixed
top-ten list.

## Authority and continuation

`ntreflect` is read-only. It changes neither project files nor workflow state
and creates no canonical artifact.

The conversation continues after the answer. A later user request to apply an
improvement or create tasks is new explicit authority and is not an automatic
part of `ntreflect`.

Provider hooks may independently append telemetry governed by the
cross-cutting runtime contract.

## Failure boundary

`ntreflect` inherits corruption and unsupported-telemetry-format behavior from
`.ntworkflow/NTSTATS.md`. Corrupt in-scope Neotolis telemetry stops the query
without silent skipping, repair, migration, or fallback.

Missing provider evidence makes the affected causal conclusion partial or
unknown; it is never treated as zero or proof that no problem exists.

An interrupted invocation has no resumable state or partial artifact. A later
invocation starts again from a new snapshot.

## Expected behavior

- A large observed result selects evidence for investigation but does not by
  itself prove noise or context pollution.
- A proved failure loop receives an evidence-backed cause and one recommended
  change.
- Ordinary-looking aggregates do not prevent bounded transcript review when
  workflow evidence suggests a problem.
- Existing tests and reviews can explain rework but never become a new quality
  judgment by `ntreflect`.
- Active-run reflection is marked preliminary.
- A follow-up request to fix a finding starts only with separate user
  authority.
- No path through `ntreflect` changes files or workflow state.
