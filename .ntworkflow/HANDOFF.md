# Handoff to Implementation Planning

**Status:** Phase and runtime contracts confirmed on 2026-08-10
**Implementation:** Not started

This is a project-design handoff, not a consumer-project runtime artifact.

## Authoritative contracts

- `SPEC.md` defines requirements and boundaries.
- `.ntworkflow/RUNTIME.md` defines cross-cutting runtime behavior.
- `.ntworkflow/NTTASK.md`, `NTGRILL.md`, `NTPLAN.md`, `NTWORK.md`,
  `NTSTATS.md`, and `NTREFLECT.md` define phase behavior.
- `.ntworkflow/DESIGN-REFERENCES.md` is research evidence, not a contract.

A conflict between contracts is a defect. Stop and reconcile the documents;
do not silently choose a winner.

## Fixed implementation boundary

- The public surface is the six phase skills; `ntworkflow` is agent-only.
- One strict top-level state file points to one permanent run directory.
- One primary owns workflow state; only the active `ntwork` implementer may
  write project code or tests.
- Claude Code and Codex use native user-level plugins and native agent
  definitions. There is no shared role schema, model mapping, launcher, or
  fallback.
- Telemetry is optional, per native session, and noncanonical. There is no
  separate event stream, runtime handoff, artifact registry, or aggregate
  cache.
- State changes fail early and atomically. Markdown and code edits are ordinary
  edits with no automatic rollback or repair.

## Next step

Plan implementation against the confirmed contracts. Do not reopen product
decisions or add abstractions unless implementation evidence reveals a real
contract defect.
