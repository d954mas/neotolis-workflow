# First vertical tracer bullet

## Objective

Deliver the smallest end-to-end Neotolis Workflow slice:

- TypeScript/Node.js 24 package and agent-only `ntworkflow` CLI;
- strict `.ntworkflow/state.json` state machine;
- project ownership, locking, and atomic state replacement;
- shared CLI preflight;
- complete `nttask` lifecycle and `BRIEF.md` boundary;
- minimal installable Claude Code and Codex plugins;
- clean-fixture component discovery;
- deterministic Windows, Linux, and macOS verification;
- equivalent normalized runtime semantics for both providers.

Do not implement `ntgrill`, `ntplan`, `ntwork`, telemetry, `ntstats`, `ntreflect`, task commands, or plan validation. Do not create placeholder skills, commands, agents, or speculative provider abstractions.

## Common agent contract

Every task agent must:

1. Read `PROJECT.md`, `SPEC.md`, `.ntworkflow/HANDOFF.md`, `.ntworkflow/RUNTIME.md`, `.ntworkflow/NTTASK.md`, this plan, and its packet completely.
2. Treat other phase contracts as future-boundary context only.
3. Never treat `.ntworkflow/DESIGN-REFERENCES.md` as requirements.
4. Verify dependency commits before changing files.
5. Modify only owned files and explicit integration files.
6. Preserve unrelated worktree changes.
7. Run all packet verification after dependencies are present.
8. Create one dedicated commit for the packet.
9. Report commit ID, changed files, verification results, deviations, and blockers, then stop.
10. Do not turn execution order or inferred "impossible states" into parser requirements unless an authoritative contract explicitly does.

No separate handoff artifact is created. Source, tests, commit, and the agent's final report are the handoff evidence.

## Architecture

```text
nttask skill
  -> provider SessionStart identity/path adapter
  -> ntworkflow CLI
  -> shared preflight
  -> project-local lock
  -> artifact validation
  -> atomic state replacement
```

Runtime decisions:

- TypeScript ESM on Node.js 24 LTS, npm, committed lockfile.
- Runtime bundle has no production dependencies.
- One compiled runtime is copied into the npm package and both plugins.
- Nearest ancestor containing a `.git` directory or worktree file is the consumer root; outside Git, native session `cwd` is the root.
- JSON state is UTF-8, LF, two-space formatted, exact, and unversioned.
- Run IDs use a minimum width of three digits (`NT-001`, `NT-1000`).
- Lock acquisition is immediate, without retry or TTL.
- Workflow never reads or changes consumer Git ignore policy.

## CLI surface

```text
ntworkflow --cwd <path> status
ntworkflow --cwd <path> run start --session-id <provider:id>
ntworkflow --cwd <path> run cancel --session-id <provider:id> --user-confirmed
ntworkflow --cwd <path> run complete --session-id <provider:id> --user-confirmed
ntworkflow --cwd <path> phase begin nttask --session-id <provider:id> [--interruption provider-ended|user-confirmed] [--blocker-resolved]
ntworkflow --cwd <path> phase complete nttask --session-id <provider:id>
ntworkflow --cwd <path> phase stop nttask --session-id <provider:id> --blocker <text> [--interruption provider-ended|user-confirmed]
```

Other operations are unknown in this slice.

Stable exit codes:

| Code | Meaning |
|---:|---|
| 0 | success |
| 2 | invalid input or unsupported operation |
| 10 | invalid state or invariant |
| 11 | illegal transition |
| 12 | ownership conflict |
| 13 | unresolved blocker |
| 14 | artifact or component failure |
| 15 | lock or partial-run conflict |
| 16 | state/filesystem commit failure |
| 70 | caught internal failure |

Every invocation emits one JSON line. Success includes `ok`, `operation`, `project_root`, `state`, `next_action`, and `warnings`. Failure additionally carries a stable error code, message, actual state, details, and correct next action. Rejected operations do not mutate workflow state.

## Planned source layout

```text
src/cli/{main,arguments}.ts
src/core/{protocol,errors,state,invariants}.ts
src/runtime/{project-root,preflight,transaction,run,phase,artifacts,nttask}.ts
src/providers/session-start.ts
plugins/{claude-code,codex}/...
marketplaces/{claude-code,codex}/...
scripts/{build,run-tests,package-plugins}.mjs
tests/{tooling,state,status,transaction,run,phase,nttask,providers,conformance,e2e}/...
```

Generated `build/` contains the npm artifact and complete self-contained local marketplace trees. Installed plugins cannot reference files outside their plugin root.

## Acceptance ownership

| AC | Task | Result |
|---|---|---|
| TB-AC-01 | TB-01 | Node 24 tooling and stable JSON protocol |
| TB-AC-02 | TB-02 | Exact state shape and invariants |
| TB-AC-03 | TB-03 | Correct root and non-mutating status/preflight |
| TB-AC-04 | TB-04 | Serialized atomic state mutations |
| TB-AC-05 | TB-05 | ID allocation, cancellation, completion |
| TB-AC-06 | TB-06 | Ownership, blockers, explicit interruption |
| TB-AC-07 | TB-07 | Complete `nttask` state/artifact lifecycle |
| TB-AC-08 | TB-08 | Claude install, discovery, identity |
| TB-AC-09 | TB-09 | Codex install, discovery, identity |
| TB-AC-10 | TB-10 | Provider parity and installable artifacts |
| TB-AC-11 | TB-11 | Cross-platform CI and whole tracer bullet |

These cover relevant portions of SPEC requirements 1-5, 10, 11, and 13. Requirements 6-9 and 12 remain out of scope. Requirements 1 and 3 remain project-wide partial because the other five skills and future required roles are intentionally absent.

## Known risks

- Codex plugin APIs move quickly. If the pinned CLI cannot install and discover the local plugin on Windows, stop rather than emulating discovery or copying caches manually.
- Codex plugin hooks require explicit trust through `/hooks`.
- Codex does not currently document plugin-bundled custom subagent TOMLs. This is a future-role blocker, not an `nttask` blocker.
- A hard-killed process can leave an orphan lock. The runtime reports it and does not perform TTL cleanup or repair.
- Local runner filesystems are supported; network-share rename behavior is not.
- Node.js 24 is an explicit user prerequisite.
- Deterministic tests prove runtime and adapter contracts, not model-authored BRIEF quality. Live provider smoke remains separate from CI.
- Tests must never initialize this repository's contract-bearing `.ntworkflow/` as consumer state.

