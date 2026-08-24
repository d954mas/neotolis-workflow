# Neotolis Workflow

## Status

Contract design is confirmed. Tracer-bullet implementation is complete through
TB-07; TB-08 is next. The full six-skill workflow is not yet implemented.

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
