---
name: ntwork
description: Execute and independently verify an approved Neotolis plan. Use when the user explicitly invokes ntwork.
---

# Neotolis work

## Native identity and roles

Use only the single `Neotolis Workflow runtime context:` JSON object supplied
by the installed SessionStart hook. Require an owner beginning with `claude:`,
absolute cwd and absolute existing cli. Missing or invalid context stops before
CLI calls or mutation. Never infer or substitute identity or paths.

Use native Task subagents `neotolis-workflow:ntwork-implementer`,
`neotolis-workflow:ntwork-task-reviewer`,
`neotolis-workflow:ntwork-nyquist-auditor`,
`neotolis-workflow:ntwork-spec-integration-reviewer` and
`neotolis-workflow:ntwork-code-reviewer`. Use
`neotolis-workflow:ntplan-critic` only for an explicitly authorized amendment.
Never override installed model/effort or substitute an inline/fallback role.

## Enter the phase

1. Run `status` through the exact installed CLI. If `next_action.skill` is not
   `ntwork`, report `invalid phase state`, actual lifecycle, why ntwork is not
   legal and the supplied next_action. At delivery-ready say implementation is
   complete and passive. Leave files unchanged and never invoke another skill
   automatically.
2. Require a fresh primary session for initial entry. Read SPEC.md, PLAN.md and
   every indexed packet completely. Parse invocation mode: empty or `all` means
   all remaining tasks; `one` means the exact next pending task; `one <id>` is
   legal only when `<id>` is that exact next pending task. Reject other syntax.
3. Confirm all five configured native roles exist in the native subagent tool.
   Call `phase begin ntwork --session-id "<owner>"` with these flags:
   `--implementer-available --task-reviewer-available
   --nyquist-auditor-available --spec-integration-reviewer-available
   --code-reviewer-available`. Omit only the flag for a genuinely missing role
   so the CLI returns its exact component failure. No scanner or fallback.
   Add `--base-branch "<branch>"` only when the user, repository, or approved
   plan requires a distinct delivery base.
4. Pre-existing project-file changes require explicit user permission and must
   fit the exact next approved packet. After permission append
   `--existing-changes-confirmed` to phase begin and task begin. Never stash,
   clean, reset, rebase, force-push or resolve conflicts automatically.
5. Do not call begin again during uninterrupted progress. An interrupted owner
   needs `--interruption provider-ended|user-confirmed`. Only an active task may
   continue from its durable diff or one already-created direct task commit, and
   only under the recorded provider. A blocker needs explicit resolution and
   `--blocker-resolved`. Validate branch, HEAD, pull-request identity when used,
   actual diff and completed-task boundaries before continuing.

## Ownership and task order

The primary owns decisions, scope rulings, canonical artifacts, Git actions,
canonical verification, evidence, review adjudication, status and delivery.
Implementation is never parallel. A fresh implementer edits only one active
packet or one accepted finding; reviewers are read-only. Completed tasks are
not rerun. Required CI may remain pending while a next task starts, but known
red CI blocks that start.

For each selected task, call
`task begin <task-id> --session-id "<owner>"`. The CLI accepts only the exact
next pending task in PLAN stable order. Give a fresh implementer the complete
packet, SPEC, relevant PLAN decisions, repository instructions, completed direct
dependency identities and only prior rulings that constrain this task. Do not
give unrelated future packets, transcripts or telemetry.

The implementer may edit scoped code, tests and necessary infrastructure and
run focused author checks. It may not edit planning artifacts/state, commit,
change branch/delivery identity, decide user questions, expand scope or close
the task. Inspect its entire project diff before verification.

## Task verification and review

Tests are mandatory for testable behavior or logic changes. Existing direct
coverage counts only when it distinguishes the incorrect result. Run one fresh
canonical pass after the last relevant edit: every packet procedure, relevant
behavior tests, impacted completed behavior, newly enabled integration and
applicable repository gates. Primary owns canonical verification; implementer
checks are author feedback.

Record concise evidence with `work record evidence --session-id "<owner>"
--gate task:<task-id> --procedure <procedure> --result <result>
--expected <condition> --source-id <native-source-ids>`. Keep raw logs in native
sources, not new report artifacts.

Give one fresh task reviewer the packet, applicable SPEC/PLAN constraints,
complete current diff and the same canonical evidence. It must return separately:

```text
Packet compliance: PASS | BLOCK
Code and test quality: PASS | BLOCK
```

Record actual verdicts with `work record task-review <task-id> --session-id
"<owner>" --packet pass|block --quality pass|block --source-id <reviewer-id>`.
Both must PASS after the last project change. Send confirmed in-scope findings
to the same active implementer, rerun affected and canonical checks, then rerun
both verdicts. A contract-changing finding uses amendment, never silent scope.

After both PASS, the primary creates exactly one dedicated task commit, excluding
workflow-runtime dirt, verifies all task project changes are committed, then
calls `task complete <task-id> --session-id "<owner>" --commit-id <commit>`.
Push/update one recorded pull request only when user, repository or approved
plan requires it. After its clean current revision exists, record or
idempotently confirm its identity with `work record pull-request --session-id
"<owner>" --id "<id>" --url "<absolute-http-url>"`. An identity mismatch
blocks that delivery path. `one` stops after this task; `all` proceeds
sequentially.

## CI and accepted fixes

When hosted CI is required, record a known result with `work record gate ci` and
the usual `--session-id`, `--verdict pass|fail|not-required`, `--procedure`,
`--result`, `--expected` and `--source-id` fields. Do not retry flaky/conflicting
evidence into PASS. A known failure gets one fresh bounded non-parallel
implementer for the affected task or integration boundary, applicable
verification/review and one direct linked fix commit.

Before accepting a post-task fix, record fresh evidence with gate
`fix:<task-id|integration>` and the usual procedure/result/expected/source
fields. Record a fresh read-only review for the
same scope with `work record task-review <task-id|integration> ...`; both packet
and quality must pass. Then record the direct fix commit with `work record
fix-commit --session-id "<owner>" --scope <task-id|integration> --commit-id
<commit> --procedure <procedure> --result <result> --expected <condition>
--source-id <native-source-ids>`. This invalidates every final gate. Never amend
or force-push published commits.

## Whole-plan and final gates

After all tasks and known CI findings, run PLAN's exact final validation on the
current revision: applicable full suites, build, typecheck, lint, integration,
regression, benchmark, visual and manual procedures. Record it with
`work record gate whole-plan ... --verdict pass|fail ...`.

After whole-plan PASS, dispatch fresh read-only Nyquist, specification/integration
and code reviewers on the same current revision, complete approved artifacts,
implementation/diff and concise evidence. They may run in parallel and no
verdict masks another. Nyquist maps every acceptance ID to executed behavioral
coverage or its approved reproducible alternative. Record with
`work record gate nyquist`, `work record gate spec-integration`, and
`work record gate code-review`, each using `--verdict pass|block` and native
source IDs. Record final required CI as pass, or not-required only when no hosted
CI gate applies.

An in-scope finding gets one fresh bounded implementer, affected verification
and review, a linked fix commit, then the complete final gate once on the new
revision. A later change invalidates that candidate. Recurring blockers without
progress stop for the user; there is no force-pass or arbitrary retry budget.

When every task, whole-plan, Nyquist, specification/integration, code review,
applicable CI and required delivery action pass on the same current revision,
call `phase complete ntwork --session-id "<owner>"`. Report the concise current
revision result. ntwork enters passive delivery-ready and does not merge.

## Amendment and stop boundary

If execution must change SPEC, PLAN, packets, acceptance ownership, task set,
dependencies, order, scope, public behavior, compatibility or a confirmed user
decision, stop implementation, explain the exact defect and wait for explicit
permission. Change only permitted artifacts, do focused research for new claims,
call `plan validate --session-id "<owner>"`, run a fresh native ntplan critic on
the complete revised set, present the revised order and wait for explicit renewed
approval. After both approvals call `plan validate --session-id "<owner>"
--critic-pass --user-confirmed` to reconcile the durable task list, then
continue. Never invoke ntplan automatically or create versions, hashes,
manifests or backups. Interrupted amendment reasoning restarts.

If amendment reasoning is interrupted after planning files changed, the new
same-provider primary first uses `phase stop ntwork --session-id "<owner>"
--blocker "Interrupted amendment must restart" --interruption user-confirmed`.
Reconfirm all five configured native roles and the recorded Git boundary.
After the user chooses correction or repetition, repair the complete set and
run `plan validate --session-id "<owner>" --amendment-recovery`, repeat the full
critic, and after renewed approval run the same command with `--critic-pass
--user-confirmed --amendment-recovery`. This atomically reacquires ntwork and
reconciles tasks; never resume partial amendment reasoning.

On unavailable evidence/role, state, ownership, Git/delivery mismatch, conflict
or unresolved decision, explain the concrete blocker. If still owner, call
`phase stop ntwork --session-id "<owner>" --blocker <specific-problem>`.
Cancellation uses `run cancel ... --user-confirmed`. Leave real edits intact;
never repair, migrate, reset, fall back, guess, expand scope or create a pull
request/branch/CI requirement not required by user, repository or approved plan.
