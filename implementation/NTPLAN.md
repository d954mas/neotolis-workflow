# ntplan vertical slice

Baseline: merged PR #1, `cde0eab1fdd4fd576fc4dd98da7c570ccf559df4`.
The completed tracer and ntgrill plans remain historical. No commit, push,
merge, or release publication is authorized by this implementation request.

## Boundary

Implement the full confirmed `.ntworkflow/NTPLAN.md`: plan-ready + BRIEF →
mandatory native research → primary SPEC self-review and SPEC/PLAN/task set →
structural validation → independent critic/convergence (at most three rounds)
→ concise approval view → explicit approval → plan-approved. Runtime owns
structural gates; the primary owns evidence, reasoning, truthful critic results
and approval. No research/validation artifact, hashes, role registry, fallback,
extra approval, or later-phase implementation.

## Owned files and verification

1. `plugins/*/skills/ntgrill/SKILL.md`, `tests/providers/ntgrill-contract.test.ts`:
   replace the failed prose-only diagnostic instruction with an explicit response
   format. Run component RED/GREEN, full verify, then one new live late-invocation
   smoke per provider. Preserve the historical 31/32 result and new failures.
2. `src/runtime/{phase,artifacts,transaction,ntplan,plan-artifacts}.ts`, `src/cli/{arguments,main}.ts`,
   `tests/ntplan/`, relevant fixtures: reuse preflight/ownership/transactions;
   add begin/stop/complete ntplan and read-only plan validate, strict Markdown
   structure, acceptance ownership, dependencies, graph and stable-order checks.
   RED/GREEN for each gate, including missing roles, invalid external artifacts,
   explicit approval, competing owners, restart, and commit failure.
3. `plugins/*/skills/ntplan/SKILL.md`, `plugins/*/agents/`, manifests and checked
   bundles; `tests/providers/`: self-contained equivalent skills and two native
   read-only roles. Claude loads plugin agents. Pinned Codex uses native global
   `agents.<name>.config_file` pointing to the installed TOMLs; no custom loader.
   Verify native installation/discovery without model calls and exact bundles.
4. `tests/{conformance,e2e,packaging}/`, relevant fixture trees and expectations:
   compare complete normalized responses and trees (only native identities and
   absolute fixture paths normalized). Run focused tests then sequential full
   `npm run verify`; preserve evidence outside destructively rebuilt build/.
5. Separate live ntplan on both real providers in disposable repos. Capture
   mandatory native roles, self-review, validation, critic/convergence, approval
   and correction, non-mutation of project files, late invocation and restart
   boundaries. Record observations without claiming universal model compliance.
6. Three independent read-only reviews: simplicity; architecture; correctness,
   security and evidence. Fix confirmed findings, rerun affected checks, update
   `PROJECT.md`, `implementation/README.md` and generated evidence report. New
   local changes require fresh three-platform CI on a separately authorized commit.

Native sources: [Codex pinned role loader](https://github.com/openai/codex/blob/rust-v0.144.6/codex-rs/core/src/config/agent_roles.rs),
[Codex custom agents](https://developers.openai.com/codex/subagents),
[Claude plugin agents](https://code.claude.com/docs/en/sub-agents).
