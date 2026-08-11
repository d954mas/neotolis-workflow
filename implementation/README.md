# Neotolis Workflow tracer-bullet implementation

This directory contains the approved implementation plan split into task packets for separate fresh-agent chats.

## Execution order

1. `TB-01` — tooling and CLI JSON protocol
2. `TB-02` — strict state model
3. `TB-03` — project root, preflight, and `status`
4. `TB-04` — locking and atomic state storage
5. `TB-05` — run lifecycle and ID allocation
6. `TB-06` — phase ownership, blockers, and interruption
7. `TB-07` — BRIEF validation and full `nttask` runtime lifecycle
8. `TB-08` — Claude Code plugin
9. `TB-09` — Codex plugin
10. `TB-10` — provider conformance and packaging
11. `TB-11` — cross-platform CI and final E2E

Dependency graph:

```text
TB-01 -> TB-02 -> TB-03 -> TB-04 -> TB-05 -> TB-06 -> TB-07
                                                    |-> TB-08 -|
                                                    |-> TB-09 -|-> TB-10 -> TB-11
```

`TB-08` and `TB-09` are logically independent after `TB-07`, but execute them in stable order unless they are isolated in separate worktrees.

## Starting a fresh task chat

Use the following prompt, replacing the task ID:

```text
Work in C:\projects\neotolis-workflow.

Read completely:
- PROJECT.md
- SPEC.md
- .ntworkflow/HANDOFF.md
- .ntworkflow/RUNTIME.md
- .ntworkflow/NTTASK.md
- implementation/PLAN.md
- implementation/tasks/TB-01.md

Implement only TB-01. Verify its dependencies and stay inside its scope and owned files.
Do not start later tasks or add placeholders for them. Preserve unrelated changes.
Run every verification command in the packet, create the dedicated task commit, report the handoff fields, and stop.
```

The orchestrating chat should not start the next packet until the current packet has a passing verification result and a dedicated commit.

