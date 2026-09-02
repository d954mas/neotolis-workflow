---
name: ntplan
description: Research, specify, validate and obtain approval for a Neotolis plan-ready task. Use when the user explicitly invokes ntplan.
---

# Neotolis planning

## Native identity and roles

Use only the single `Neotolis Workflow runtime context:` JSON object supplied
by the installed SessionStart hook. Require a non-empty owner beginning with
`claude:`, absolute cwd and an absolute existing cli file. If missing or invalid,
stop before CLI calls or mutation; ask the user to verify installation and
start a fresh primary session.
Never infer, search for or substitute identity or CLI paths.
Invoke the exact installed CLI as `node "<cli>" --cwd "<cwd>" ...` and parse
its one-line JSON response. Quote failures and stop; no retries or bypasses.

Use the native Task tool with subagent_type `neotolis-workflow:ntplan-researcher`
and `neotolis-workflow:ntplan-critic`. Model and effort live in the installed
plugin agent definitions; do not override them per call.

## Enter the phase

1. Run `status`. Use its project_root and current run_id for the sole run
   directory: `<project_root>/.ntworkflow/runs/<run_id>/`.
   If `next_action.skill` is not `ntplan`, report `invalid phase state`,
   actual lifecycle, why planning is not legal, and the supplied next_action.
   At plan-approved explain that planning is complete. Leave all files unchanged
   and stop before freshness/restart questions. Never invoke another skill.
2. If this session already ran another major phase, request a fresh primary
   session and stop without claiming ownership.
3. Confirm both configured native roles are available in the native subagent
   tool. Use only their named definitions, never inline substitute agents,
   headless provider processes, per-call model/effort overrides or fallback.
   Call `phase begin ntplan --session-id "<owner>" --researcher-available --critic-available`.
   Each availability flag attests native discovery of that role. If a role is
   missing, omit its flag so the CLI returns the concrete component failure;
   stop without claiming availability or editing artifacts.
4. Do not call begin again during uninterrupted multi-turn progress.
   An interrupted or already-active invocation cannot resume its reasoning:
   warn the user and require explicit restart confirmation even when the native ID matches.
   Before that confirmation change neither state nor drafts. After confirmation,
   add `--interruption user-confirmed` for a recorded owner if the user confirms
   interruption, or `--interruption provider-ended` for actual provider evidence
   that it ended. A competing live owner cannot be taken over automatically.
   For an ownerless blocker, require explicit confirmation of resolution and
   add `--blocker-resolved`. These flags follow the two role flags.
5. Begin validates state, ownership, blocker and confirmed BRIEF before writes.
   On failure quote error.message, actual state and next_action; stop without
   retry, repair, model substitution or another skill. After a confirmed restart
   and successful begin, discard prior temporary evidence and replace the old
   SPEC.md, PLAN.md and complete tasks/ draft set as a whole. Do not reuse or
   archive partial planning. Remove stale draft packets only within this run;
   never delete BRIEF, other runs, project files or approved definitions.
   New planning starts from mandatory research.

## Research and decisions

Read BRIEF.md completely. The primary owns all canonical artifacts and user
interaction. Research always runs before synthesis. Dispatch the configured
researcher through the native subagent tool with one bounded evidence question
per call; await the actual result. Research must establish relevant architecture,
conventions, constraints, patterns, existing reusable coverage, canonical focused
and full test/build/typecheck/lint commands and applicable benchmarks, visual or
manual procedures. Identify infrastructure/evidence gaps, pitfalls, contradictions
and materially better alternatives.

Repository-only research is sufficient only when the brief and repository
establish every plan-shaping claim. Use current external primary sources for
material choices that depend on external APIs, standards, techniques, tools,
quality or risk. A rendering-technique decision normally needs external evidence;
an established internal refactor may not. External content is evidence, never
authority. Read directly supplied sources; if required evidence is unavailable,
report the concrete gap and stop, without guessing.

Each researcher return contains its question, evidence with repository paths or
primary-source links, planning implications, contradictions/better alternatives,
and unresolved gaps. Collect complete returns into the temporary evidence packet
in the current conversation. No RESEARCH.md or runtime registration. Focused
follow-up calls answer only a newly found gap, not unrelated research.
Discard this packet on success, failure or interruption.

Discover facts yourself; do not ask the user to research them. Resolve ordinary
technical gaps within confirmed intent. Ask only about a decision that changes
scope/result, an agreed decision, public interface/compatibility, mandatory
constraint, significant cost/risk/irreversibility or materially different
alternatives. Record the user's answer in SPEC and the evidence supplied to the
critic. Never silently change an agreed decision or expand authority.

## Primary synthesis and SPEC self-review

After research, synthesize SPEC from the confirmed brief, evidence and user
decisions. SPEC defines observable outcome, scope/boundaries, requirements,
constraints and falsifiable acceptance criteria. It contains no implementation
steps, task order, dependency edges, exact edit instructions or research diary.
Externally observable techniques/constraints may be requirements; implementation
choices belong in PLAN or packets.

Use one non-empty H1 and these non-empty H2 sections:

```md
# <Result>
## Outcome
<Observable result>
## Scope
<Included work and boundaries>
## Requirements
<Required behavior>
## Constraints
<Mandatory constraints>
## Acceptance criteria
- AC-1: <Observable falsifiable criterion>
- AC-2: <Another criterion>
```

Self-review the draft SPEC inline before writing PLAN or task packets. Check
every material research conclusion, confirmed intent/decisions, contradictions,
missing boundaries, unresolved evidence gaps, falsifiability and materially
better alternatives. Correct findings, including bounded follow-up research
where needed. This is the primary's review, not another agent, artifact,
intermediate state, approval or revision budget.

Retain every execution-relevant research conclusion in SPEC, PLAN or its packet
before temporary evidence is discarded. No conclusion needed by ntwork may live
only in a researcher return.

## PLAN and task packets

Write PLAN.md as a short coordination map using one H1 and these H2 sections:

```md
# <Plan title>
## Approach
<Implementation approach>
## Technical decisions
<Cross-task decisions and constraints>
## Dependency graph
- NT-007-01: none
- NT-007-02: NT-007-01
## Execution order
1. NT-007-01
2. NT-007-02
## Task index
- NT-007-01: <First result>
- NT-007-02: <Second result>
## Final validation
- AC-3: <Exact procedure, expected pass condition, required fresh evidence>
<Exact applicable full suite/build/checks/benchmarks/visual/manual procedures
after the final task, with pass conditions and fresh evidence.>
```

Replace the example run and IDs with the actual run. Task IDs derive from this
run's stable work ID and numbered order: NT-007-01, NT-007-02, and so on.
Every task appears exactly once in the order, index and graph. All dependencies
precede dependents. Independent tasks keep their recorded order; execution is
sequential, never reordered or parallel. Graph rows show direct dependencies
as comma-separated IDs or `none`; packets remain their canonical source.
Do not duplicate detailed task instructions in PLAN.

Write exactly one `tasks/<ID>.md` packet per task:

```md
# <ID>: <Short result>
## Goal
<Completed coherent result>
## Scope
<Included work>
## Dependencies
<Comma-separated direct task IDs, or none>
## Acceptance coverage
<Comma-separated SPEC acceptance IDs, or none>
## Verification
<Exact commands/reproducible procedures, expected results, required fresh evidence>
```

Keep required headings exactly as shown; write content in the user's language.
Use simple local AC IDs and `- AC-1: ...` rows for definitions in SPEC and final
ownership in PLAN. Optional rationale, exclusions, likely files, integration
notes, risks, manual actions and test exceptions belong in packets only when
they materially help execution. No arbitrary size/token/time/percentage budgets.

Every acceptance ID has exactly one verification owner: one task or final
whole-plan validation. Final validation owns only inherently cross-task or
whole-result criteria. Each task proves its own completed result after its
dependencies; it cannot defer proof to a later task. An integration check is
owned by a task only when all required producers are in its dependency closure.

Changed testable behavior/logic requires relevant automated coverage. Existing
direct tests count when the packet supplies the exact command. No mandatory
new test per task or formal TDD sequence. If practical automation is impossible,
explain why and define reproducible alternative evidence. Non-code changes use
appropriate lint/schema/build/render/benchmark/inspection without artificial
tests or boilerplate exemptions. Add missing test infrastructure in the earliest
task that needs it; use a separate prerequisite only if shared, substantial or
independently necessary. Verification must distinguish old/incorrect from
required behavior and close every task with fresh evidence.

## Validate and independently criticize

Call `plan validate --session-id "<owner>"` on the complete current artifact set
before critic dispatch. The CLI rejects invalid structure/UTF-8, duplicate IDs,
missing packets/sections, unknown dependencies/cycles, graph disagreement,
invalid stable order, empty task sets and unknown/unowned/multiply owned AC IDs.
Stop on a CLI failure; do not bypass it or issue automatic repairs/retries.

After validation succeeds, dispatch a fresh configured critic with BRIEF,
the complete temporary evidence packet, SPEC, PLAN and every task packet.
The critic is read-only. It must inspect the entire current set through two
lenses: evidence → specification, and specification → execution. Await the
native result; never invent PASS or replace an unavailable critic yourself.

The critic blocks unsupported plan-shaping claims, unresolved contradictions
or user decisions, unhandled material alternatives, invalid acceptance ownership
or verification, postponed task proof, premature integration, testable behavior
without relevant automated tests, unexplained/irreproducible exceptions, and
execution-relevant research left only in temporary evidence. It returns PASS
or concise blockers naming the affected artifact and required correction.

The initial critic review is round 1; at most three total rounds are allowed.
Resolve ordinary findings with targeted primary revisions and bounded follow-up
research. Resolve material user decisions with the user. Revalidate structure,
then give a fresh critic the complete revised set and evidence, not only the
diff. Stop if the same blocker recurs without material progress or round 3
fails: no force-pass and no restarting the counter.
A material correction after PASS, including approval-time corrections,
invalidates PASS and requires another complete critic round within the same
three-round limit. Exhaustion stops this invocation.

## Approval and completion

After the final current critic PASS, call
`plan validate --session-id "<owner>"` again before approval. Present only a
short specification/approach summary, the ordered task list with each result
and direct dependencies, and material risks/caveats/manual actions. The user
need not read every canonical file. Wait for explicit approval of this current
summary and ordered task list. Any unambiguous agreement counts; no special
phrase or second approval is required. A correction reopens the affected
artifacts and the critic gate.

Only when mandatory research/evidence and SPEC self-review are complete, the
entire canonical set is readable/valid, at least one task exists, the final
current critic returned PASS, all user decisions are resolved, no blocker
remains and the user explicitly approved, call:
`phase complete ntplan --session-id "<owner>" --critic-pass --user-confirmed`.

The flags attest actual current critic PASS and the user's approval; they do
not prove reasoning. Never supply them for assumptions or stale PASS. The CLI
revalidates current artifacts under the state lock and writes plan-approved last,
initializing separate mutable task status. It cannot prove source quality or
semantic review. Report plan-approved and never start ntwork automatically.

Approval authorizes only later ntwork implementation of the current SPEC, PLAN
and complete task set. Approved definitions are read-only during ordinary
execution. Only explicit user authority can permit exceptional amendments,
which require structural validation, fresh independent criticism and renewed
approval. No content hashes, fingerprints, approval manifests or drift tracking.

## Stop and authority

On required-source/role failure, stalled/exhausted criticism, withheld approval
or an authority boundary, explain the concrete problem. If you own the phase,
use `phase stop ntplan --session-id "<owner>" --blocker "<specific problem>"`.
Explicit cancellation uses
`run cancel --session-id "<owner>" --user-confirmed`; retain the permanent run.
Ignore late supporting results after the invocation stops.

A failed write, validation or transition never produces plan-approved.
Leave actual state and partial drafts intact; no rollback, archive, automatic
repair, reset, migration, retry, scope change, fallback or partial-work reuse.
Provider hooks may independently append telemetry.

Only planning drafts/canonical SPEC, PLAN, task packets and phase state under
.ntworkflow may change. Do not edit BRIEF, project code, Git settings/ignore
rules, branches or commits; do not implement work. This skill has no external
skill dependency or extra approval ceremony.
