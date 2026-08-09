# Neotolis Workflow

## Status

Design discovery. Implementation has not started.

## Goal

Build a compact, provider-neutral development workflow inspired by GSD, Matt
Pocock's skills, and the measured workflow in `game-67-idle`.

The workflow must preserve GSD's ordered phases and review discipline without
requiring its milestone and roadmap layer.

## Confirmed constraints

- Support both Claude Code and Codex.
- Store workflow runtime data in `.ntworkflow/`, gitignored in each consumer
  project. Do not use `.planning/`, which belongs to GSD.
- Keep durable context, specifications, plans, handoffs, session logs, tool
  usage, token usage, and derived metrics on local disk.
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

## Candidate phases

1. Intake and repository research
2. Grilling
3. Research and planning
4. Implementation
5. Review
6. Optional reflection

## Agent configuration hypothesis

Each phase has a primary agent: the agent running the current user-facing chat.
That agent owns the phase result. For example, the primary planning agent reads
the context, directs research, writes the plan, evaluates criticism, and makes
the final revisions.

Supporting agents handle bounded, independently verifiable work such as
research, repository exploration, plan criticism, specification checks,
code-quality review, security review, and test/result analysis. They return
evidence and findings; they do not silently replace the primary agent's
canonical artifact.

Logical roles are provider-neutral. Provider adapters map a role to the runtime
fields supported by Claude Code or Codex.

Illustrative shape only; the schema is not approved:

```yaml
phases:
  plan:
    agents:
      researcher:
        codex:
          model: gpt-5.6-terra
          reasoning_effort: high
        claude:
          model: sonnet
          effort: high
      plan-critic:
        codex:
          model: gpt-5.6-sol
          reasoning_effort: xhigh
        claude:
          model: opus
          effort: xhigh
```

Defaults, inheritance, overrides, fallback behavior, and exact role boundaries
remain design decisions for the grilling phase.

## Architectural hypothesis

- Phase skills own phase behavior and their supporting-agent topology.
- The primary agent owns synthesis, user interaction, and canonical outputs.
- The CLI owns state, transition validation, session identity, artifact
  registration, and reports.
- Provider adapters own process launch, model/effort translation, transcript
  discovery, and normalized telemetry.
- Canonical artifacts stay small and are loaded by the next phase.
- Raw transcripts and tool outputs remain audit-only unless explicitly opened.
- A status/resume skill may exist as a convenience, but no central orchestrator
  skill is required for correctness.

## Quality target

The workflow should be materially simpler than GSD while retaining:

- explicit phase gates;
- isolated research, planning, and criticism where useful;
- approval of decision-rich artifacts;
- goal-backward plan verification;
- implementation evidence;
- independent specification and code-quality review;
- exact, local operational telemetry where the provider exposes it.
