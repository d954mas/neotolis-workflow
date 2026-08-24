# `ntgrill` Phase Contract

**Status:** Confirmed on 2026-08-09
**Input:** `.ntworkflow/runs/<run-id>/BRIEF.md` in `brief-ready`
**Output:** Rewritten `.ntworkflow/runs/<run-id>/BRIEF.md`
**Completed state:** `plan-ready`

## Purpose

`ntgrill` resolves decision ambiguity between intake and planning. It walks the
task's decision tree branch by branch, discovers available facts itself, asks
the user only about real decisions, and blocks planning until the user confirms
shared understanding.

The phase deliberately preserves the interaction method of Matt Pocock's
`grilling` skill as closely as possible. Neotolis adapts its workflow input,
output, validation, and state transition without redesigning the interview.

## Vendored skill policy

`ntgrill` is a self-contained adapted copy of `grilling`, not a wrapper that
requires or invokes an externally installed skill at runtime.

- Preserve the original interview behavior and wording where practical.
- Pin the imported source to a specific upstream commit during implementation.
- Preserve the upstream MIT attribution and license notice.
- Apply upstream changes deliberately and only after explicit review.
- Keep Claude Code and Codex behavior equivalent without a nested skill load.

Primary references:

- https://github.com/mattpocock/skills/blob/main/skills/productivity/grilling/SKILL.md
- https://github.com/mattpocock/skills/blob/main/docs/productivity/grilling.md
- https://github.com/mattpocock/skills/blob/main/LICENSE

## Invocation and authority

`ntgrill` may start only when an active run is in the legal input state,
initially `brief-ready`, the current run's `BRIEF.md` exists and is readable,
the exact current state is valid, and the current session can acquire sole phase
ownership.

The phase may:

- read the brief, repository instructions, relevant repository content, and
  directly referenced context needed for the current decision branch;
- ask questions and compare meaningful alternatives;
- rewrite `BRIEF.md` once after final user confirmation;
- request the CLI transition to `plan-ready`;
- allow provider hooks to append ordinary telemetry.

The phase may not modify project code, create a specification, plan, or task
packets, commit changes, expand scope, start another phase, or implement work.

## Decision-frontier discovery

The decision frontier is a dynamic reasoning technique, not a separate durable
artifact.

1. Read the current brief and relevant repository context.
2. Treat the subject as a decision tree whose child decisions depend on parent
   decisions.
3. Separate discoverable facts from decisions that belong to the user.
4. Investigate discoverable facts instead of asking the user.
5. Ask about the nearest unresolved decision whose dependencies are understood.
6. Follow any new branches opened by the answer.
7. Continue until no material silent assumptions remain.
8. Perform one final self-sweep before presenting the complete understanding.

There is no frontier file, decision registry, graph, ID scheme, confidence
score, status taxonomy, progress denominator, or fixed question budget. The
frontier is inferred from `BRIEF.md`, the current repository, and the current
conversation.

## Questions

Ask exactly one question at a time and wait for its answer. Every question
includes the primary agent's recommended answer and, when useful, a concise
explanation of alternatives and consequences.

Ask only when the answer is a genuine user decision that materially affects
scope, boundaries, observable behavior, UX, a public API or CLI contract,
architecture direction, mandatory constraints, compatibility, significant
edge behavior, or the desired result.

Do not ask about:

- facts already present in the brief;
- facts available from repository exploration or approved tools;
- decisions the user already made;
- low-level details safely left to planning;
- questions included only to satisfy a template or count.

An unambiguous acceptance of the recommendation is an answer. Clarify an
ambiguous response before continuing. A correction replaces the previous
working understanding and may reopen dependent branches.

`ntgrill` remains mandatory when the input brief has no `Open questions`: the
fresh session still checks for hidden branches and may complete quickly.

## Shared understanding

Shared understanding exists when the primary agent can present one coherent
account of the task, boundaries, material decisions, repository context, and
desired result; its final frontier sweep finds no known unresolved user
decision; and the user explicitly confirms that account.

Any correction, added constraint, disputed decision, or missing branch means
shared understanding has not yet been reached. Reopen the affected branch,
continue grilling, and present the complete understanding again.

Any unambiguous user agreement counts as confirmation. No special confirmation
phrase is required.

## Brief update

During a normal interview, `BRIEF.md` remains unchanged. `ntgrill` does not
incrementally persist answers or maintain a phase-specific scratch artifact.

After shared understanding is confirmed, rewrite `BRIEF.md` completely rather
than editing the intake text in place. Keep only the current information needed
by `ntplan`:

```md
# <Short title>

## Brief
Current task, boundaries, constraints, and agreed decisions.

## Repository context
Only material current repository context, paths, and useful links.

## Success
The observable desired result.
```

Old wording, rejected alternatives, questions, and interview history are not
preserved. A successful `ntgrill` brief has no `Open questions` section and no
separate decision log.

## Completion gate

The run becomes `plan-ready` only when all of the following are true:

1. The best available frontier is exhausted.
2. The primary agent completed its final self-sweep.
3. The user explicitly confirmed the complete understanding.
4. The rewritten `BRIEF.md` was stored successfully.
5. The CLI accepted the legal state transition.

There is no ambiguity score, checklist, supporting reviewer, or second-model
gate. If the brief write fails, the run is not `plan-ready`. If the state
transition fails after a successful write, the state remains `brief-ready`
and the written brief remains on disk; there is no automatic rollback.

## Review boundary

`ntgrill` has no independent review pass. The primary agent owns repository
exploration, questions, recommendations, the final self-sweep, synthesis, and
the canonical brief.

Mandatory research, specification creation, independent criticism, and plan
verification belong to `ntplan`. New material decisions discovered from new
planning research may be discussed there; their later discovery does not by
itself invalidate a correctly completed `ntgrill` run.

## Repository evidence

`ntgrill` reads only the repository files needed for the current decision. It
does not create a baseline, look for changes, or run background monitoring. If
a contradiction is encountered naturally, current repository evidence wins;
reopen only a decision it actually affects. Never stash, clean, reset, or
otherwise modify the worktree.

## Interruption

An interrupted `ntgrill` cannot resume. A later legal invocation warns the user
and starts again from the current durable brief only after explicit confirmation.
Without confirmation it changes nothing. `ntgrill` has no separate pause,
resume, or frontier format.

## Repeated and invalid invocation

`ntgrill` never redirects to or invokes another phase automatically.

An invocation in an invalid state fails early with `invalid phase state`,
reports the actual state, explains why `ntgrill` is not legal, and names the
correct next action without mutating workflow state or `BRIEF.md`.

In particular, invocation at `plan-ready` reports that grilling is complete
and tells the user to invoke `ntplan` explicitly. Invocation after planning has
started fails the same way with the correct state-specific next action.

## Errors

Stop without guessing or implicit recovery when:

- the required brief is missing or unreadable;
- current workflow state is invalid or corrupt;
- another live session owns the phase;
- a fact required for the current decision cannot be obtained;
- an authority boundary is violated;
- the final brief cannot be stored safely;
- the CLI rejects the state transition.

Explain the concrete problem and required next action. Do not modify canonical
files or mark the run `plan-ready`. Provider hooks may independently append
telemetry. Automatic repair, reset, migration, fallback, and scope change are
forbidden.

State validation and the transition commit are cross-cutting runtime
responsibilities rather than prompt logic in `ntgrill`.

## Output

A successful `ntgrill` produces only:

- the fully rewritten `.ntworkflow/runs/<run-id>/BRIEF.md`;
- the legal transition to `plan-ready`;
- any telemetry independently captured by provider hooks.

It does not produce a grill log, decision register, frontier artifact,
specification, plan, task set, or review report.

## Expected behavior

- Repository facts are discovered instead of asked of the user.
- An already settled decision is not asked again.
- An answer opens a dependent branch and that branch is discussed next.
- An empty input `Open questions` section does not skip hidden-frontier checks.
- A correction to the proposed shared understanding continues grilling.
- Confirmation rewrites the brief without questions or interview history.
- A failed brief write never produces `plan-ready`.
- Invocation at `plan-ready` fails and tells the user to invoke `ntplan`.
- A repository contradiction encountered during normal work reopens only the
  affected decision.
- No path through `ntgrill` starts planning or implementation.

## Reference synthesis

This contract intentionally vendors Matt Pocock's compact grilling interaction
instead of combining it with GSD-style area selection, Spec Kit question caps,
or an independent review loop. Neotolis adds only the minimum workflow edges:
validated input, a canonical rewritten brief, explicit confirmation, legal
state transition, and fail-early behavior.
