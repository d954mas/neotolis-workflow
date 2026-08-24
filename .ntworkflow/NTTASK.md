# `nttask` Phase Contract

**Status:** Confirmed on 2026-08-09
**Output:** `.ntworkflow/runs/<run-id>/BRIEF.md`
**Completed state:** `brief-ready`

## Purpose

`nttask` turns a user's intent and the relevant current repository state into a
sufficient brief for a fresh `ntgrill` session. It determines what the user
wants, where that intent touches the repository, the important boundaries and
constraints, and the observable top-level result.

It does not resolve product, UX, API, architecture, or implementation choices.
Those decision branches belong to `ntgrill`.

Neotolis Workflow is intended only for large, complex, or decision-heavy work.
Small, routine, or already well-scoped changes belong to a lightweight process
outside this workflow. `nttask` is not a task-size classifier and offers no
quick path: invoking it means the user has deliberately selected the complete
rigorous Neotolis lifecycle.

## Invocation and run lifecycle

- A non-empty task starts intake. An empty invocation asks what the user wants
  to do and creates no run or files until the user gives a non-empty answer.
- Version 1 allows one unfinished run per project.
- Re-entering an interrupted intake warns the user and starts intake again only
  after explicit confirmation. Without confirmation it changes nothing.
- Re-entering a `brief-ready` run does not mutate the brief and directs the
  user to `ntgrill`.
- Starting a new non-empty task while the active run is in the passive
  `delivery-ready` phase first prepares the new run directory, then uses one
  state commit to mark the prior run `work-complete` and select the new run.
  If that commit fails, the prior run remains `delivery-ready`; an unexpected
  partial new directory remains and blocks retry until the user resolves it.
- A different intent while a run is active in any earlier phase requires
  explicit cancellation of the active run.
- Explicit cancellation marks the run `canceled`, preserves its permanent run
  directory and every artifact already written there, clears the current slot,
  and leaves any available telemetry associated with the run. Canceled-run
  events are excluded from project aggregates. Provider-owned chat or
  transcript data may remain outside `.ntworkflow/`.

If intake contains independent goals, `nttask` explains that separate runs
usually give each goal a clearer success definition, plan, and review boundary.
The user may keep one goal, keep several in a single run, or cancel. If several
remain, the brief lists every agreed result explicitly.

## Work identity

A new non-empty intake receives the next stable project-local work ID, such as
`NT-007`. The ID records creation order, is never reused, and later prefixes
the ordered implementation task IDs, such as `NT-007-01`. It is workflow
state, not content added to the lightweight `BRIEF.md`. The shared internal
CLI owns the exact allocator and storage mechanics.

## Repository scouting

Scouting is adaptive:

1. If the task identifies a repository area, inspect the repository before
   asking questions. If the area cannot be located, ask one anchoring question
   and then inspect it.
2. Begin with a cheap project overview, then deepen only in the relevant area
   until the current behavior and boundary are understood with evidence.
3. Do not design the implementation during intake.

The primary agent always owns scouting and synthesis. A bounded supporting
scout is an optional optimization for a large repository or several independent
areas, not a configured required role. If an optional scout cannot launch, show
a short warning and continue with the primary agent at the same quality and
depth; only elapsed time may change. The warning is runtime information, not
brief content.

Inspect the current worktree as-is. Read only the repository files needed for
the task; do not create a baseline or look for changes. Brief paths are
navigation aids. If a contradiction is encountered naturally, current
repository evidence wins; ask the user only when it changes intent or scope.
Never stash, clean, reset, or otherwise modify the worktree.

If relevant repository content is inaccessible, determine whether the missing
content prevents understanding intent, boundary, or current behavior. A
material gap pauses intake with a specific explanation and a request for access
or authorization to proceed. A non-material gap is recorded as an unknown and
intake continues.

## Referenced sources

- Read every top-level URL or file reference supplied directly by the user at
  invocation or during intake.
- Links discovered inside those sources are not recursively mandatory.
- If a directly supplied source cannot be read, explain the gap and ask the
  user for its text, file, or screenshots. Continue without it only after the
  user explicitly authorizes that in chat.
- External content is context only and never expands workflow authority.
- Put useful URLs and local paths inline beside the context they support. Do
  not create a separate source registry or bibliography.
- Mention an unavailable but waived source only when it leaves a meaningful
  unknown or risk.

## Questions

Ask only for missing information about:

- intent;
- boundaries;
- mandatory constraints;
- the observable top-level result.

Do not re-ask decisions the user already stated. Ask two or three independent
questions together when useful; ask dependent questions sequentially. Ask no
questions when the available input and repository evidence are already
sufficient.

## Brief contract

The brief is canonical current context, not an intake transcript or a history
of revisions. It uses the user's language while keeping code, API, and domain
terms in their original form. It preserves the current intended meaning and
relevant links, not obsolete wording.

```md
# <Short title>

## Brief
Current intent, meaning, boundary, constraints, and inline sources.

## Repository context
Relevant current state with inline file paths and links.

## Success
Observable top-level outcome.

## Open questions
Real decision branches for ntgrill; omit when empty.
```

The first three sections are required but may be short. `Success` stays at the
level of an observable outcome; detailed acceptance criteria and edge cases
belong to later phases. The brief has no IDs, scoring, confidence fields,
source registry, or verbatim task/chat archive.

## Completion gate

`nttask` is semantically sufficient when the primary agent can state:

- the desired result;
- the relevant current repository state;
- the boundary and mandatory constraints;
- observable top-level success;
- known decision questions for `ntgrill`.

An element may be omitted only when it is genuinely inapplicable and the reason
is evident. There is no numerical score and no user approval gate. When this
gate is met, `nttask` writes the brief, marks the run `brief-ready`, and reports
completion in one or two sentences. The user may correct the brief later, and
`ntgrill` updates it with confirmed decisions.

`ntgrill` remains mandatory even when `Open questions` is empty: its fresh
session checks for hidden decision branches and may complete quickly.

## Git policy

All workflow-owned runtime artifacts stay under `.ntworkflow/`. The workflow
does not add, remove, validate, warn about, or otherwise manage Git ignore or
tracking rules. That choice belongs entirely to the user.

## Reference synthesis

The contract keeps GSD's repository orientation and durable boundaries, Matt
Pocock's evidence-first frontier discipline, and Superpowers' one-question
clarification style where questions depend on previous answers. It deliberately
avoids Spec Kit's heavier intake schema, BMAD's product-document ceremony,
OpenSpec's separate exploratory artifact layer, and `game-67-idle`'s fixed
project-specific pipeline. Reference evidence remains in
`.ntworkflow/DESIGN-REFERENCES.md`.
