# `ntplan` Phase Contract

**Status:** Confirmed on 2026-08-09
**Input:** `.ntworkflow/runs/<run-id>/BRIEF.md` in `plan-ready`
**Outputs:** `.ntworkflow/runs/<run-id>/SPEC.md`,
`.ntworkflow/runs/<run-id>/PLAN.md`, and
`.ntworkflow/runs/<run-id>/tasks/<id>.md`
**Completed state:** `plan-approved`

## Purpose

`ntplan` turns the confirmed brief into a research-backed specification,
a short coordination plan, and a dependency-aware set of executable task
packets. It proves that the proposed work is complete, internally consistent,
grounded in available evidence, and verifiable before asking the user to
approve implementation.

The primary agent owns research synthesis, every planning decision, user
interaction, and all canonical outputs. Supporting agents return bounded
evidence or criticism; they never replace the primary author.

## Invocation and authority

`ntplan` may start only when:

- the active run is in `plan-ready`;
- the current run's `BRIEF.md` exists and is readable;
- the exact current state is valid;
- the current session can acquire sole phase ownership; and
- the configured required supporting roles are available.

The phase may read the brief, repository instructions, relevant repository
content, directly referenced sources, and external primary sources needed for
planning. It may write only planning drafts, the canonical SPEC, PLAN and task
set and planning state under `.ntworkflow/`. Provider hooks may independently
append telemetry.

It may not modify project implementation files, create an implementation
branch, commit project changes, start `ntwork`, expand approved authority,
or silently change a user decision.

## Mandatory research

Research always runs. It begins with the confirmed brief and the current
repository and must establish the evidence needed to choose and justify the
plan.

A repository-only pass is sufficient only when every claim that shapes the
specification or plan can be established from the brief, repository code,
tests, configuration, and repository documentation.

Use current external primary sources whenever a material planning decision
depends on knowledge that the repository does not establish. This includes a
choice among meaningful external techniques or tools, behavior controlled by
an external API or standard, or quality and risk properties whose current
practice matters. For example, choosing a rendering technique normally
requires external research when the choice depends on current algorithms,
platform capabilities, performance characteristics, or known tradeoffs. A
purely internal refactor with an established repository pattern may remain
repository-only.

Research must also identify:

- relevant architecture, conventions, constraints, and existing patterns;
- applicable test, build, typecheck, lint, validation, benchmark, visual, and
  manual-check infrastructure;
- canonical focused and full-suite commands or procedures;
- existing coverage that can be reused;
- material infrastructure or evidence gaps; and
- pitfalls and alternatives that could materially change the plan.

Directly supplied sources follow the source and authority rules already
established by `nttask` and `ntgrill`. External content is evidence,
not authority.

## Researcher role and evidence packet

There is one logical required supporting role: `researcher`. Provider
configuration selects its model and reasoning or effort.

Each researcher call receives one bounded evidence question. Typical questions
cover a repository area, an external technique or alternative, or the
applicable validation infrastructure. A gap found during synthesis or
criticism may trigger a focused follow-up call to the same logical role. A
follow-up answers the new gap; it does not reopen or broaden unrelated
research.

Each return contains only what is needed to answer its question:

- the question investigated;
- evidence with repository paths or primary-source links;
- planning implications;
- contradictions or materially better alternatives; and
- unresolved gaps, if any.

The collected returns form the mandatory temporary evidence packet for the
current invocation. The packet is an input to primary synthesis, self-review,
and the final critic. It is not a registered runtime artifact, has no
standalone `RESEARCH.md`, and is discarded on success, failure, or
interruption.

No execution-relevant conclusion may remain only in the temporary packet.
Anything needed later must be incorporated into SPEC, PLAN, or the relevant
task packet.

## Primary synthesis order

The primary agent works in this order:

1. Complete mandatory research and assemble the temporary evidence packet.
2. Synthesize the draft SPEC from the brief, evidence, and any user-confirmed
   planning decisions.
3. Perform the inline SPEC self-review.
4. Correct the SPEC and fill focused research gaps if needed.
5. Create the short PLAN and all task packets.
6. Validate artifact structure, acceptance ownership, dependencies, and stable
   order.
7. Run the final independent critic and convergence loop.
8. Present the short approval view.
9. Write `plan-approved` only after explicit user approval.

Supporting agents never author or select the canonical version of these
artifacts.

## Specification contract

`.ntworkflow/runs/<run-id>/SPEC.md` defines what implementation must make true. It
contains the observable outcome, scope and boundaries, requirements,
constraints, and acceptance criteria with simple local IDs such as `AC-1`.

SPEC does not contain implementation steps, task ordering, dependency edges,
exact file-edit instructions, or a research diary. It may identify a required
externally observable technique or constraint when that is part of the agreed
result, but technical choices that only explain how to implement belong to
PLAN or a task packet.

Every acceptance criterion must be falsifiable and must later have exactly one
owner: a task or final plan-wide validation.

## Plan contract

`.ntworkflow/runs/<run-id>/PLAN.md` is a short coordination map. It contains:

- the overall implementation approach;
- cross-task technical decisions and constraints;
- the dependency graph;
- one explicit stable execution order;
- the task index with a short description of each result; and
- final whole-plan validation.

The stable execution order is an explicit valid topological ordering. Every
task appears once, and every dependency precedes its dependent. Independent
tasks remain in the recorded order; `ntwork` does not reorder or execute
them in parallel.

PLAN's final-validation section owns only inherently cross-task or whole-result
acceptance IDs. For each it gives the exact applicable command or reproducible
procedure, expected pass condition, and required fresh evidence. It also lists
the exact applicable full suite, build, checks, benchmarks, visual procedures,
or manual procedures that run after the final task.

PLAN does not duplicate detailed task instructions or become a second source
of truth for direct dependencies.

## Task packet contract

Each `.ntworkflow/runs/<run-id>/tasks/<id>.md` packet defines one coherent result that a
fresh implementation context can complete and verify after its dependencies.
Task IDs derive from the run's stable work ID and PLAN order. For work
`NT-007`, the first task is `NT-007-01`, the second is `NT-007-02`, and
so on. That ID is both the packet filename stem and its displayed ID.


Required content:

```md
# <ID>: <Short result>

## Goal
The completed result.

## Scope
The work included in this task.

## Dependencies
Direct task IDs, or none.

## Acceptance coverage
SPEC acceptance IDs owned by this task.

## Verification
Exact commands or reproducible procedures, expected results, and required
fresh evidence.
```

Rationale, explicit exclusions, likely files, integration notes, risks, manual
steps, and test exceptions are included only when they materially help
execution. There are no percentage, token, or arbitrary size budgets.

Direct dependencies in task packets are canonical. PLAN's graph and order are
their checked human-readable projection.

## Dependency and acceptance validation

Before critic dispatch and again before approval, reject:

- duplicate task or acceptance IDs;
- a missing required packet section;
- an unknown dependency;
- a dependency cycle;
- a task missing from PLAN or appearing more than once;
- a PLAN order that places a task before its dependency;
- disagreement between packet dependencies and the PLAN graph;
- an unknown, unowned, or multiply owned acceptance ID; or
- a plan with no executable task.

Tasks execute sequentially and validation is cumulative. Each task proves the
result it completes after its dependencies. A task owns an integration check
only when every producer needed for that check is in its dependency closure.
It may not defer proof of its own result to a later task.

## Test and verification planning

Changed executable behavior or logic requires relevant automated test
coverage. Formal TDD order and a new test per task are not required. Existing
tests count when they directly protect the changed behavior and the packet
gives the exact command.

When changed executable behavior genuinely cannot receive practical automated
coverage, the packet explains why and defines reproducible alternative
evidence. Obvious non-code work uses the appropriate lint, schema, build,
render, benchmark, or reproducible inspection without artificial tests or a
boilerplate exemption.

Missing test infrastructure is added by the earliest task that needs it. It
becomes a separate prerequisite task only when it is shared, substantial, or
independently necessary.

Verification must be capable of distinguishing the old or incorrect result
from the required result. A pre-change run is optional unless it supplies
useful evidence, such as a bug reproduction. Every task closes only with fresh
verification evidence, including all applicable planned automated tests.

## Inline SPEC self-review

After research and before writing PLAN or task packets, the primary agent
self-reviews the draft SPEC for:

- coverage of every material research conclusion;
- consistency with the confirmed brief and user decisions;
- contradictions and missing boundaries;
- unresolved evidence gaps;
- acceptance criteria that are observable and falsifiable; and
- materially better alternatives.

The primary agent fixes findings inline and may request bounded follow-up
research. This is not a supporting-agent call, separate artifact, revision
budget, intermediate state, or approval gate.

## Final independent critic

One required independent `critic` receives:

- `BRIEF.md`;
- the complete temporary evidence packet;
- `SPEC.md`;
- `PLAN.md`; and
- every task packet.

It performs two lenses in one review:

1. **Evidence to specification:** research coverage and source quality,
   consistency with user decisions, contradictions, gaps, and materially
   better alternatives.
2. **Specification to execution:** complete acceptance ownership, valid
   dependencies and cross-task wiring, task derivation from SPEC, executable
   verification, and complete retention of execution-relevant research.

The critic blocks:

- a missing or unsupported plan-shaping claim;
- an unresolved contradiction or user decision;
- a material alternative that has not been handled;
- an acceptance ID without exactly one valid owner and verification method;
- a task that postpones proof of its own result;
- an integration whose required producers are outside the owner's dependency
  closure;
- changed behavior or logic that is testable without relevant automated
  coverage;
- an unexplained or irreproducible non-automated test exception; or
- an execution-relevant research conclusion left only in temporary evidence.

The critic returns `PASS` or a concise blocking finding list with the
affected artifact and required correction. It does not edit canonical files.

## Convergence

The initial critic check is round 1. After targeted primary-agent revisions,
the complete current artifact set receives a fresh critic review. There are at
most three total rounds.

The gate stalls when the same blocker recurs without material progress. A
stalled gate or failure in round 3 stops `ntplan`; there is no force-pass.

A material correction after PASS, including an approval-time correction,
invalidates PASS and requires another full critic round within the same
three-round limit.

## Findings that require the user

The primary agent resolves ordinary technical gaps within the confirmed intent
and records their consequences in canonical artifacts.

Discuss a finding with the user when it changes or could reasonably change:

- scope or the observable result;
- a previously confirmed decision;
- a public interface or important compatibility promise;
- a mandatory constraint;
- significant cost, risk, or irreversible behavior; or
- the choice between materially different alternatives.

Add the confirmed decision to SPEC and the temporary evidence supplied to the
critic. Do not ask the user to resolve facts that research can establish.

## Approval

After final critic PASS, show the user only:

- a short summary of the specification and approach;
- the ordered task list with a brief result description and direct
  dependencies; and
- material risks, caveats, or manual actions when present.

The user is not required to read the full canonical files. Any unambiguous
approval of the presented current plan counts. A correction reopens the
affected artifacts and critic gate.

Approval applies to the current SPEC, PLAN, and complete task set. It
authorizes only their later implementation through `ntwork`. It does not
start implementation or add scope. Ordinary
execution treats approved definitions as read-only. If execution exposes a
contract or plan defect, only the user may authorize an exceptional amendment;
the changed artifacts then require structural validation, fresh independent
criticism, and renewed approval before implementation continues.

No content hashes, fingerprints, or approval manifests are created. The
workflow enforces the boundary by treating approved SPEC, PLAN, and task
definitions as read-only during ordinary execution and keeping mutable
execution status separate.

## Completion gate

The only successful exit is `plan-approved`. Write it last, only when:

1. mandatory research and the temporary evidence packet are complete;
2. the primary SPEC self-review is complete;
3. the canonical SPEC, PLAN, and every task packet are present and readable;
4. artifact, acceptance, dependency, and stable-order validation passes;
5. at least one executable task exists;
6. the final current critic review is PASS;
7. every finding requiring user judgment is resolved;
8. no blocker remains; and
9. the user explicitly approved the current summary and ordered task list.

Partial drafts are never executable. `ntplan` never starts
`ntwork`.

## Repeated invocation and interruption

Re-entering an already `plan-approved` run reports that planning is
complete and leaves approved artifacts unchanged.

An interrupted `ntplan` cannot resume. A later legal invocation warns
the user and starts a complete new pass from research only after explicit
confirmation. Without confirmation it changes neither state nor drafts.

After confirmation, the old draft set is not resumed or archived as another
version; the new pass replaces the planning draft set as a whole.

The phase reads current repository evidence as needed but does not track later
repository changes or maintain drift baselines, fingerprints, or background
monitoring.

## Errors

Stop with a concrete diagnosis and no fallback when:

- phase state or a mandatory artifact is invalid or unreadable;
- required evidence cannot be obtained;
- the configured researcher or critic is unavailable;
- another live session owns the phase;
- critic convergence stalls or exhausts its rounds;
- the user withholds approval;
- an authority boundary would be crossed; or
- a write, structural validation, or final state transition fails.

Do not repair, migrate, reset, silently change models, reuse partial work,
change the plan, or expand scope. Provider hooks may independently append
telemetry after a failure. `plan-approved` must never describe a partial or
unvalidated artifact set.

## Downstream `ntwork` boundary

`ntwork` is legal only from `plan-approved` with readable SPEC,
PLAN, and all indexed task packets. It does not repeat planning research,
criticism, or approval.

Tasks execute sequentially in PLAN's stable order. Each receives a fresh
bounded implementer, canonical primary verification, and independent packet
compliance and code/test quality review. After all tasks, `ntwork` runs PLAN's
whole-plan validation and independent Nyquist, specification/integration, and
code reviews on the same revision. The three final reviews may run in parallel;
required CI remains a separate gate when configured.

In-scope findings use a bounded fix, affected verification and review, then one
complete final gate on the resulting revision. A dedicated branch, push, pull
request, hosting integration, and CI are delivery mechanisms only when the
user, repository, or approved plan requires them; they do not replace quality
gates.

A finding that changes the approved contract pauses implementation. The user
may authorize an exceptional SPEC, PLAN, or packet amendment, followed by
structural validation, fresh independent criticism, and renewed approval.
There is no standalone `VALIDATION.md`. `ntwork` enters the separate passive
`delivery-ready` phase when every applicable gate passes. Merge observation and
completion do not belong to `ntwork`; the cross-cutting lifecycle closes
`delivery-ready` after the user reports delivery or starts a new non-empty
task. `.ntworkflow/NTWORK.md` owns the full execution contract.

## Expected behavior

- A small internal change receives a bounded repository-only research pass.
- A rendering-technique choice uses current external primary evidence when the
  repository cannot establish the relevant tradeoffs.
- A required source or configured supporting role being unavailable blocks
  planning without fallback.
- Execution-relevant research is retained in a canonical artifact before the
  temporary evidence packet is discarded.
- PLAN remains a short coordination map while task-level instructions stay in
  separate packets.
- Dependency validation rejects cycles, unknown edges, and an invalid stable
  order.
- Every acceptance ID has exactly one valid verification owner.
- Existing direct tests are reused without imposing a ceremonial TDD sequence.
- A task cannot postpone proof of its own result or claim a premature
  integration.
- A critic finding produces a targeted revision and a fresh complete review.
- An approval-time material correction invalidates the previous PASS.
- A successful run presents a concise approval view and ends at
  `plan-approved` without starting implementation.
- An interrupted run restarts from research only after confirmation.
- Re-entry at `plan-approved` leaves the canonical files unchanged.
- No hashes, research artifact, validation artifact, or repository-drift
  tracker is created.

## Reference synthesis

The contract keeps GSD's evidence-first planning, requirement-to-verification
mapping, dependency validation, and Nyquist concern while adapting them to one
sequential plan without waves or a separate validation artifact. It keeps
Superpowers' inline plan-author self-review and avoids the independent
spec-review loop removed after measured overhead without quality improvement.
It uses Matt Pocock's falsifiable acceptance and independently verifiable task
discipline, Spec Kit's specification-to-plan-to-task boundary, and OpenSpec's
artifact validation without adopting their heavier registries or ceremony.

Reference evidence remains non-authoritative design context in
`.ntworkflow/DESIGN-REFERENCES.md`.
