# ntwork vertical slice

Baseline: local ntplan commit `54460a730521fa0d1707ad73208f4d500710d511`.
The completed `implementation/PLAN.md` and `implementation/NTPLAN.md` remain
historical. This slice must remain uncommitted unless separately authorized.

## Boundary

Implement the confirmed `.ntworkflow/NTWORK.md`: `plan-approved` plus the
approved SPEC/PLAN/task packets → sequential task execution → task evidence and
two reviewer verdicts → dedicated consumer task commits → whole-plan validation
→ independent Nyquist, specification/integration and code reviews → applicable
CI decision → passive `delivery-ready`. Primary owns state, Git actions,
canonical evidence and adjudication. Native supporting roles stay bounded.
Telemetry, `ntstats`, `ntreflect`, plan auto-amendment and automatic delivery
remain out of scope.

## Owned files and checks

1. Runtime and CLI: `src/core/{domain,state,invariants}.ts`,
   `src/runtime/{phase,ntwork,git}.ts`, `src/cli/{arguments,main}.ts`, plus focused
   `tests/ntwork/` and fixtures. Add work-role preflight, exact next-task
   selection, Git identity/cleanliness checks, task/review/evidence recording,
   fix commits and final transition. RED/GREEN each transition and rejection.
2. Native bundles: `plugins/*/skills/ntwork/SKILL.md`, five provider-native
   role definitions, manifests, checked runtimes and provider contract/install
   tests. Provider files own model/effort; no shared registry or fallback.
3. Parity and release: necessary `tests/{conformance,e2e,packaging}/` expectations
   only. Compare full normalized responses and filesystem trees, then run focused
   suites and sequential `npm run verify` so release artifacts remain in `build/`.
4. Evidence: separate disposable live fixtures for Claude Code and Codex,
   three independent read-only reviews, confirmed fixes only, then factual
   updates to `PROJECT.md`, `implementation/README.md` and a standalone ntwork
   report with hashes, paths, limitations and Git status.
