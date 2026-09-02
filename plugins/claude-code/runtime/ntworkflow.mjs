/* eslint-disable */

// src/core/errors.ts
var EXIT_CODES = Object.freeze({
  SUCCESS: 0,
  INVALID_INPUT: 2,
  INVALID_STATE: 10,
  ILLEGAL_TRANSITION: 11,
  OWNERSHIP_CONFLICT: 12,
  UNRESOLVED_BLOCKER: 13,
  ARTIFACT_FAILURE: 14,
  LOCK_CONFLICT: 15,
  COMMIT_FAILURE: 16,
  INTERNAL_FAILURE: 70
});
var ERROR_CODES = Object.freeze({
  INVALID_INPUT: "INVALID_INPUT",
  INVALID_STATE: "INVALID_STATE",
  ILLEGAL_TRANSITION: "ILLEGAL_TRANSITION",
  OWNERSHIP_CONFLICT: "OWNERSHIP_CONFLICT",
  UNRESOLVED_BLOCKER: "UNRESOLVED_BLOCKER",
  ARTIFACT_FAILURE: "ARTIFACT_FAILURE",
  LOCK_CONFLICT: "LOCK_CONFLICT",
  PARTIAL_RUN: "PARTIAL_RUN",
  COMMIT_FAILURE: "COMMIT_FAILURE",
  INTERNAL_FAILURE: "INTERNAL_FAILURE"
});
var ERROR_EXIT_CODES = Object.freeze({
  [ERROR_CODES.INVALID_INPUT]: EXIT_CODES.INVALID_INPUT,
  [ERROR_CODES.INVALID_STATE]: EXIT_CODES.INVALID_STATE,
  [ERROR_CODES.ILLEGAL_TRANSITION]: EXIT_CODES.ILLEGAL_TRANSITION,
  [ERROR_CODES.OWNERSHIP_CONFLICT]: EXIT_CODES.OWNERSHIP_CONFLICT,
  [ERROR_CODES.UNRESOLVED_BLOCKER]: EXIT_CODES.UNRESOLVED_BLOCKER,
  [ERROR_CODES.ARTIFACT_FAILURE]: EXIT_CODES.ARTIFACT_FAILURE,
  [ERROR_CODES.LOCK_CONFLICT]: EXIT_CODES.LOCK_CONFLICT,
  [ERROR_CODES.PARTIAL_RUN]: EXIT_CODES.LOCK_CONFLICT,
  [ERROR_CODES.COMMIT_FAILURE]: EXIT_CODES.COMMIT_FAILURE,
  [ERROR_CODES.INTERNAL_FAILURE]: EXIT_CODES.INTERNAL_FAILURE
});
function hasErrorCode(error, code) {
  return error !== null && typeof error === "object" && "code" in error && error.code === code;
}
var WorkflowError = class extends Error {
  name = "WorkflowError";
  code;
  details;
  exitCode;
  constructor(options) {
    super(options.message);
    this.code = options.code;
    this.details = options.details ?? null;
    this.exitCode = ERROR_EXIT_CODES[options.code];
  }
};
function normalizeCaughtError(error) {
  if (error instanceof WorkflowError) {
    return {
      code: error.code,
      exitCode: error.exitCode,
      message: error.message,
      details: error.details
    };
  }
  return {
    code: ERROR_CODES.INTERNAL_FAILURE,
    exitCode: EXIT_CODES.INTERNAL_FAILURE,
    message: error instanceof Error ? error.message : "An internal error occurred.",
    details: null
  };
}

// src/core/domain.ts
var PROVIDERS = ["claude", "codex"];
var SESSION_ID_FORMAT = PROVIDERS.map((provider) => `${provider}:<native-id>`).join(" or ");
var LIFECYCLES = [
  "intake-active",
  "brief-ready",
  "plan-ready",
  "plan-approved",
  "work-active",
  "delivery-ready"
];
var PHASE_SKILLS = ["nttask", "ntgrill", "ntplan", "ntwork"];
var PHASES = [...PHASE_SKILLS, "delivery-ready"];
var FINAL_REVIEW_KEYS = [
  "nyquist",
  "spec_integration",
  "code_review"
];

// src/core/invariants.ts
var RUN_ID_PATTERN = /^NT-(\d{3,})$/u;
var TASK_ID_PATTERN = /^NT-(\d{3,})-(\d{2,})$/u;
var LEGAL_PHASES = Object.freeze({
  "intake-active": "nttask",
  "brief-ready": "ntgrill",
  "plan-ready": "ntplan",
  "plan-approved": "ntwork",
  "work-active": "ntwork",
  "delivery-ready": "delivery-ready"
});
function workflowStateError(path, rule) {
  throw new WorkflowError({
    code: ERROR_CODES.INVALID_STATE,
    message: "Workflow state is invalid.",
    details: { path, rule }
  });
}
function requireNonEmpty(value, path) {
  if (value.length === 0) workflowStateError(path, "non-empty string");
}
function providerForSessionId(sessionId) {
  const [provider, nativeId, extra] = sessionId.split(":");
  if (extra !== void 0 || nativeId === void 0 || nativeId.length === 0 || /\s/u.test(nativeId) || !PROVIDERS.includes(provider)) {
    return null;
  }
  return provider;
}
function sessionProvider(sessionId, path) {
  const provider = providerForSessionId(sessionId);
  if (provider === null) {
    workflowStateError(path, `canonical ${SESSION_ID_FORMAT} session ID`);
  }
  return provider;
}
function validateRunIdentity(state, current) {
  const match = RUN_ID_PATTERN.exec(current.run_id);
  if (match === null || Number(match[1]) < 1) {
    workflowStateError("$.current.run_id", "canonical NT-xxx run ID with a positive number");
  }
  if (state.next_work_number !== Number(match[1]) + 1) {
    workflowStateError(
      "$.next_work_number",
      "exactly one greater than the active run number"
    );
  }
}
function validatePhaseAndOwner(current) {
  const legalPhase = LEGAL_PHASES[current.lifecycle];
  if (current.lifecycle === "delivery-ready") {
    if (current.phase !== "delivery-ready") {
      workflowStateError(
        "$.current.phase",
        "delivery-ready lifecycle requires delivery-ready phase"
      );
    }
    if (current.owner !== null) {
      workflowStateError("$.current.owner", "delivery-ready phase has no owner");
    }
  } else {
    if (current.phase !== null && current.phase !== legalPhase) {
      workflowStateError(
        "$.current.phase",
        `phase is not legal for lifecycle ${current.lifecycle}`
      );
    }
    if (current.phase === null !== (current.owner === null)) {
      workflowStateError(
        current.phase === null ? "$.current.owner" : "$.current.phase",
        "state-changing phase and owner must both be set or both be null"
      );
    }
  }
  if (current.owner !== null) {
    sessionProvider(current.owner.session_id, "$.current.owner.session_id");
  }
  if (current.blocker !== null) {
    requireNonEmpty(current.blocker, "$.current.blocker");
    if (current.phase !== null || current.owner !== null) {
      workflowStateError(
        "$.current.blocker",
        "a blocked current run cannot have an active phase owner"
      );
    }
  }
}
function validateTaskIdentity(task, index, runId) {
  const path = `$.current.work.tasks[${index}].task_id`;
  const match = TASK_ID_PATTERN.exec(task.task_id);
  if (match === null || Number(match[1]) < 1 || Number(match[2]) < 1) {
    workflowStateError(path, "canonical NT-xxx-yy task ID with positive numbers");
  }
  if (`NT-${match[1]}` !== runId) {
    workflowStateError(path, "task ID must use the active run ID");
  }
}
function validateTaskState(task, index) {
  const path = `$.current.work.tasks[${index}]`;
  if (task.start_commit !== null) requireNonEmpty(task.start_commit, `${path}.start_commit`);
  if (task.commit_id !== null) requireNonEmpty(task.commit_id, `${path}.commit_id`);
  if (task.status === "pending") {
    if (task.start_commit !== null || task.commit_id !== null || task.packet_review !== "pending" || task.quality_review !== "pending") {
      workflowStateError(path, "pending task has no commits and pending reviews");
    }
    return;
  }
  if (task.start_commit === null) {
    workflowStateError(`${path}.start_commit`, `${task.status} task requires a start commit`);
  }
  if (task.commit_id !== null && (task.packet_review !== "pass" || task.quality_review !== "pass")) {
    workflowStateError(
      `${path}.commit_id`,
      "task commit requires both task reviews to pass"
    );
  }
  if (task.status === "completed" && (task.commit_id === null || task.packet_review !== "pass" || task.quality_review !== "pass")) {
    workflowStateError(
      path,
      "completed task requires a commit and both task reviews to pass"
    );
  }
}
function validateTasks(work, runId) {
  if (work.tasks.length === 0) {
    workflowStateError("$.current.work.tasks", "at least one task");
  }
  const taskIds = /* @__PURE__ */ new Set();
  let position = "completed";
  for (const [index, task] of work.tasks.entries()) {
    validateTaskIdentity(task, index, runId);
    if (taskIds.has(task.task_id)) {
      workflowStateError(`$.current.work.tasks[${index}].task_id`, "unique task ID");
    }
    taskIds.add(task.task_id);
    validateTaskState(task, index);
    if (task.status === "completed") {
      if (position !== "completed") {
        workflowStateError(
          `$.current.work.tasks[${index}].status`,
          "completed tasks form the first contiguous task prefix"
        );
      }
    } else if (task.status === "active") {
      if (position !== "completed") {
        workflowStateError(
          `$.current.work.tasks[${index}].status`,
          "at most one active task follows completed tasks"
        );
      }
      position = "active";
    } else {
      position = "pending";
    }
  }
}
function allTasksCompleted(work) {
  return work.tasks.every((task) => task.status === "completed");
}
function allVerdictsPending(verdicts) {
  return Object.values(verdicts).every((verdict) => verdict === "pending");
}
function validateVerdictSequence(work) {
  const { verdicts } = work;
  if (verdicts.whole_plan !== "pending" && !allTasksCompleted(work)) {
    workflowStateError(
      "$.current.work.verdicts.whole_plan",
      "whole-plan validation requires every task to be completed"
    );
  }
  const hasFinalReview = FINAL_REVIEW_KEYS.some(
    (key) => verdicts[key] !== "pending"
  );
  if (hasFinalReview && verdicts.whole_plan !== "pass") {
    workflowStateError(
      "$.current.work.verdicts",
      "final review verdicts require whole-plan validation to pass"
    );
  }
}
function validateWorkIdentity(current, work) {
  if (work.branch === null !== (work.base_branch === null)) {
    workflowStateError(
      "$.current.work.base_branch",
      "branch and base_branch must both be set or both be null"
    );
  }
  if (work.branch !== null) requireNonEmpty(work.branch, "$.current.work.branch");
  if (work.base_branch !== null) requireNonEmpty(work.base_branch, "$.current.work.base_branch");
  if (work.head_commit !== null) requireNonEmpty(work.head_commit, "$.current.work.head_commit");
  if (work.pull_request !== null) {
    requireNonEmpty(work.pull_request.id, "$.current.work.pull_request.id");
    requireNonEmpty(work.pull_request.url, "$.current.work.pull_request.url");
    if (work.branch === null || work.head_commit === null) {
      workflowStateError(
        "$.current.work.pull_request",
        "pull request requires an assigned branch and head commit"
      );
    }
  }
  for (const [index, fixCommit] of work.fix_commits.entries()) {
    requireNonEmpty(fixCommit, `$.current.work.fix_commits[${index}]`);
  }
  if (work.fix_commits.length > 0 && work.head_commit === null) {
    workflowStateError("$.current.work.fix_commits", "fix commits require a head commit");
  }
  const hasTaskCommit = work.tasks.some((task) => task.commit_id !== null);
  if (hasTaskCommit && (work.branch === null || work.head_commit === null)) {
    workflowStateError(
      "$.current.work.head_commit",
      "recorded task commits require an assigned branch and head commit"
    );
  }
  const hasStartedTask = work.tasks.some((task) => task.status !== "pending");
  if (hasStartedTask && work.branch === null) {
    workflowStateError(
      "$.current.work.branch",
      "started work requires an assigned branch and base branch"
    );
  }
  if (work.provider !== null && current.owner !== null) {
    const ownerProvider = sessionProvider(
      current.owner.session_id,
      "$.current.owner.session_id"
    );
    if (ownerProvider !== work.provider) {
      workflowStateError(
        "$.current.work.provider",
        "work provider must match the active ntwork owner provider"
      );
    }
  }
}
function validateEvidence(work) {
  for (const [index, evidence] of work.evidence.entries()) {
    const path = `$.current.work.evidence[${index}]`;
    requireNonEmpty(evidence.gate, `${path}.gate`);
    requireNonEmpty(evidence.procedure, `${path}.procedure`);
    requireNonEmpty(evidence.revision, `${path}.revision`);
    requireNonEmpty(evidence.result, `${path}.result`);
    requireNonEmpty(evidence.expected, `${path}.expected`);
    if (evidence.source_ids.length === 0) {
      workflowStateError(`${path}.source_ids`, "at least one native source ID");
    }
    for (const [sourceIndex, sourceId] of evidence.source_ids.entries()) {
      requireNonEmpty(
        sourceId,
        `${path}.source_ids[${sourceIndex}]`
      );
    }
  }
}
function validatePlanApproved(work) {
  if (work.provider !== null || work.branch !== null || work.base_branch !== null || work.pull_request !== null || work.head_commit !== null || work.fix_commits.length !== 0 || work.evidence.length !== 0 || work.tasks.some((task) => task.status !== "pending") || !allVerdictsPending(work.verdicts)) {
    workflowStateError(
      "$.current.work",
      "plan-approved work is initialized with pending tasks and no execution data"
    );
  }
}
function validateDeliveryReady(current, work) {
  if (current.blocker !== null || work.provider === null || work.branch === null || work.base_branch === null || work.head_commit === null || !allTasksCompleted(work) || work.evidence.length === 0 || work.verdicts.whole_plan !== "pass" || !FINAL_REVIEW_KEYS.every((key) => work.verdicts[key] === "pass") || work.verdicts.ci !== "pass" && work.verdicts.ci !== "not-required") {
    workflowStateError(
      "$.current.work",
      "delivery-ready requires completed tasks, delivery identity, evidence, and all applicable gates passing"
    );
  }
}
function validateWork(current, work) {
  validateTasks(work, current.run_id);
  validateWorkIdentity(current, work);
  validateEvidence(work);
  validateVerdictSequence(work);
  if (current.lifecycle === "plan-approved") {
    validatePlanApproved(work);
  } else if (current.lifecycle === "work-active") {
    if (work.provider === null) {
      workflowStateError("$.current.work.provider", "work-active requires a provider");
    }
  } else if (current.lifecycle === "delivery-ready") {
    validateDeliveryReady(current, work);
  }
}
function validateStateInvariants(state) {
  if (state.current === null) return;
  const { current } = state;
  validateRunIdentity(state, current);
  validatePhaseAndOwner(current);
  const requiresWork = current.lifecycle === "plan-approved" || current.lifecycle === "work-active" || current.lifecycle === "delivery-ready";
  if (requiresWork !== (current.work !== null)) {
    workflowStateError(
      "$.current.work",
      requiresWork ? `work is required for lifecycle ${current.lifecycle}` : `work must be null for lifecycle ${current.lifecycle}`
    );
  }
  if (current.work !== null) validateWork(current, current.work);
}

// src/runtime/artifacts.ts
import { lstat, readFile } from "node:fs/promises";
import { join } from "node:path";
import { TextDecoder as TextDecoder2 } from "node:util";
var REQUIRED_SECTIONS = [
  "Brief",
  "Repository context",
  "Success"
];
var OPTIONAL_SECTION = "Open questions";
function artifactFailure(path, reason, phase) {
  throw new WorkflowError({
    code: ERROR_CODES.ARTIFACT_FAILURE,
    message: `BRIEF.md does not satisfy the ${phase} artifact contract.`,
    details: { path, reason }
  });
}
function parseMarkdown(markdown) {
  const result = [];
  const lines = markdown.split(/\r?\n/u);
  const visibleLines = [...lines];
  let htmlComment = false;
  let fence = null;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (fence !== null) {
      visibleLines[index] = "";
      const closingMatch = /^ {0,3}(`+|~+)[ \t]*$/u.exec(line);
      const closingMarker = closingMatch?.[1];
      if (closingMarker?.[0] === fence.character && closingMarker.length >= fence.length) {
        fence = null;
      }
      continue;
    }
    if (htmlComment || /^ {0,3}<!--/u.test(line)) {
      lines[index] = line.replace(/(?:^|<!--).*?(-->|$)/gu, (_comment, ending) => {
        htmlComment = ending !== "-->";
        return "";
      });
      visibleLines[index] = lines[index];
      continue;
    }
    const openingMatch = /^ {0,3}(`{3,}|~{3,})(.*)$/u.exec(line);
    if (openingMatch !== null) {
      const marker = openingMatch[1] ?? "";
      const info = openingMatch[2] ?? "";
      if (marker[0] !== "`" || !info.includes("`")) {
        fence = { character: marker[0], length: marker.length };
        visibleLines[index] = "";
        continue;
      }
    }
    const match = /^ {0,3}(#{1,2})(?:[ \t]+|$)(.*)$/u.exec(line);
    if (match === null) continue;
    const rawText = (match[2] ?? "").replace(/(?:^|[ \t]+)#+[ \t]*$/u, "");
    result.push({
      level: match[1]?.length === 1 ? 1 : 2,
      text: rawText.trim(),
      line: index
    });
  }
  return { headings: result, lines, visibleLines };
}
function validateBriefStructure(markdown, path, phase) {
  const { headings: parsedHeadings, lines } = parseMarkdown(markdown);
  const titles = parsedHeadings.filter((heading) => heading.level === 1);
  const title = titles[0];
  if (titles.length !== 1 || title === void 0 || title.text.length === 0) {
    artifactFailure(path, "exactly one non-empty H1 is required", phase);
  }
  const sections = parsedHeadings.filter((heading) => heading.level === 2);
  const firstSection = sections[0];
  if (firstSection !== void 0 && title.line > firstSection.line) {
    artifactFailure(path, "the H1 must appear before all H2 sections", phase);
  }
  const sectionNames = sections.map((section) => section.text);
  if (phase === "ntgrill" && sectionNames.includes(OPTIONAL_SECTION)) {
    throw new WorkflowError({
      code: ERROR_CODES.ARTIFACT_FAILURE,
      message: "BRIEF.md does not satisfy the ntgrill artifact contract.",
      details: { path, reason: "Open questions must be absent after shared understanding is confirmed" }
    });
  }
  const expected = sectionNames.length === REQUIRED_SECTIONS.length ? REQUIRED_SECTIONS : [...REQUIRED_SECTIONS, OPTIONAL_SECTION];
  if (sectionNames.length !== expected.length || !sectionNames.every((name, index) => name === expected[index])) {
    artifactFailure(
      path,
      phase === "nttask" ? "required H2 sections must appear once in order; only a final Open questions section is optional" : "required H2 sections must appear once in order; no additional sections are allowed",
      phase
    );
  }
  for (const [index, section] of sections.entries()) {
    const nextLine = sections[index + 1]?.line ?? lines.length;
    const content = lines.slice(section.line + 1, nextLine).join("\n").trim();
    if (content.length === 0) {
      artifactFailure(path, `section ${section.text} must be non-empty`, phase);
    }
  }
}
async function validateBrief(projectRoot, runId, phase) {
  const runsPath = join(projectRoot, ".ntworkflow", "runs");
  const runPath = join(runsPath, runId);
  const path = join(runPath, "BRIEF.md");
  try {
    const runs = await lstat(runsPath);
    const run = await lstat(runPath);
    const brief = await lstat(path);
    if (!runs.isDirectory() || !run.isDirectory() || !brief.isFile()) {
      artifactFailure(path, "BRIEF.md must be a regular file in the current run directory", phase);
    }
  } catch (error) {
    if (error instanceof WorkflowError) throw error;
    artifactFailure(path, "BRIEF.md is missing or unreadable", phase);
  }
  let bytes;
  try {
    bytes = await readFile(path);
  } catch {
    artifactFailure(path, "BRIEF.md is missing or unreadable", phase);
  }
  let markdown;
  try {
    markdown = new TextDecoder2("utf-8", { fatal: true }).decode(bytes);
  } catch {
    artifactFailure(path, "BRIEF.md must contain valid UTF-8", phase);
  }
  validateBriefStructure(markdown, path, phase);
}
function validateNttaskBrief(projectRoot, runId) {
  return validateBrief(projectRoot, runId, "nttask");
}

// src/runtime/transaction.ts
import { randomUUID } from "node:crypto";
import {
  lstat as lstat4,
  open,
  rename,
  link,
  unlink
} from "node:fs/promises";
import { join as join4 } from "node:path";

// src/core/state.ts
function field(record, key) {
  if (!Object.hasOwn(record, key)) {
    workflowStateError(`$.${key}`, "required");
  }
  return record[key];
}
function childPath(path, key) {
  return path === "$" ? `$.${key}` : `${path}.${key}`;
}
function assertExactObject(value, path, expectedFields) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    workflowStateError(path, "object");
  }
  for (const expectedField of expectedFields) {
    if (!Object.hasOwn(value, expectedField)) {
      workflowStateError(childPath(path, expectedField), "required");
    }
  }
  for (const key of Object.keys(value)) {
    if (!expectedFields.includes(key)) {
      workflowStateError(childPath(path, key), "unknown field");
    }
  }
}
function assertArray(value, path) {
  if (!Array.isArray(value)) {
    workflowStateError(path, "array");
  }
}
function assertString(value, path) {
  if (typeof value !== "string") {
    workflowStateError(path, "string");
  }
}
function assertNullableString(value, path) {
  if (value !== null) assertString(value, path);
}
function assertEnum(value, path, values) {
  if (typeof value !== "string" || !values.includes(value)) {
    workflowStateError(path, `one of: ${values.join(", ")}`);
  }
}
function parseStringArray(value, path) {
  assertArray(value, path);
  for (let index = 0; index < value.length; index += 1) {
    assertString(value[index], `${path}[${index}]`);
  }
  return value;
}
function parseOwner(value, path) {
  assertExactObject(value, path, ["session_id"]);
  const sessionId = field(value, "session_id");
  assertString(sessionId, `${path}.session_id`);
  return value;
}
function parsePullRequest(value, path) {
  assertExactObject(value, path, ["id", "url"]);
  assertString(field(value, "id"), `${path}.id`);
  assertString(field(value, "url"), `${path}.url`);
  return value;
}
function parseEvidence(value, path) {
  assertExactObject(value, path, [
    "gate",
    "procedure",
    "revision",
    "result",
    "expected",
    "source_ids"
  ]);
  assertString(field(value, "gate"), `${path}.gate`);
  assertString(field(value, "procedure"), `${path}.procedure`);
  assertString(field(value, "revision"), `${path}.revision`);
  assertString(field(value, "result"), `${path}.result`);
  assertString(field(value, "expected"), `${path}.expected`);
  parseStringArray(field(value, "source_ids"), `${path}.source_ids`);
  return value;
}
function parseVerdicts(value, path) {
  assertExactObject(value, path, ["whole_plan", ...FINAL_REVIEW_KEYS, "ci"]);
  assertEnum(field(value, "whole_plan"), `${path}.whole_plan`, ["pending", "pass", "fail"]);
  for (const key of FINAL_REVIEW_KEYS) {
    assertEnum(field(value, key), `${path}.${key}`, ["pending", "pass", "block"]);
  }
  assertEnum(field(value, "ci"), `${path}.ci`, ["pending", "pass", "fail", "not-required"]);
  return value;
}
function parseTask(value, path) {
  assertExactObject(value, path, [
    "task_id",
    "status",
    "start_commit",
    "commit_id",
    "packet_review",
    "quality_review"
  ]);
  assertString(field(value, "task_id"), `${path}.task_id`);
  assertEnum(field(value, "status"), `${path}.status`, ["pending", "active", "completed"]);
  assertNullableString(field(value, "start_commit"), `${path}.start_commit`);
  assertNullableString(field(value, "commit_id"), `${path}.commit_id`);
  assertEnum(field(value, "packet_review"), `${path}.packet_review`, ["pending", "pass", "block"]);
  assertEnum(field(value, "quality_review"), `${path}.quality_review`, ["pending", "pass", "block"]);
  return value;
}
function parseWork(value, path) {
  assertExactObject(value, path, [
    "tasks",
    "provider",
    "branch",
    "base_branch",
    "pull_request",
    "head_commit",
    "fix_commits",
    "evidence",
    "verdicts"
  ]);
  const tasks = field(value, "tasks");
  assertArray(tasks, `${path}.tasks`);
  for (let index = 0; index < tasks.length; index += 1) {
    parseTask(tasks[index], `${path}.tasks[${index}]`);
  }
  const provider = field(value, "provider");
  if (provider !== null) {
    assertEnum(provider, `${path}.provider`, PROVIDERS);
  }
  assertNullableString(field(value, "branch"), `${path}.branch`);
  assertNullableString(field(value, "base_branch"), `${path}.base_branch`);
  const pullRequest = field(value, "pull_request");
  if (pullRequest !== null) parsePullRequest(pullRequest, `${path}.pull_request`);
  assertNullableString(field(value, "head_commit"), `${path}.head_commit`);
  parseStringArray(field(value, "fix_commits"), `${path}.fix_commits`);
  const evidence = field(value, "evidence");
  assertArray(evidence, `${path}.evidence`);
  for (let index = 0; index < evidence.length; index += 1) {
    parseEvidence(evidence[index], `${path}.evidence[${index}]`);
  }
  parseVerdicts(field(value, "verdicts"), `${path}.verdicts`);
  return value;
}
function parseCurrent(value, path) {
  assertExactObject(value, path, [
    "run_id",
    "lifecycle",
    "phase",
    "owner",
    "blocker",
    "work"
  ]);
  assertString(field(value, "run_id"), `${path}.run_id`);
  assertEnum(field(value, "lifecycle"), `${path}.lifecycle`, LIFECYCLES);
  const phase = field(value, "phase");
  if (phase !== null) {
    assertEnum(phase, `${path}.phase`, PHASES);
  }
  const owner = field(value, "owner");
  if (owner !== null) parseOwner(owner, `${path}.owner`);
  assertNullableString(field(value, "blocker"), `${path}.blocker`);
  const work = field(value, "work");
  if (work !== null) parseWork(work, `${path}.work`);
  return value;
}
function parseState(value) {
  assertExactObject(value, "$", ["next_work_number", "current"]);
  const nextWorkNumber = field(value, "next_work_number");
  if (!Number.isSafeInteger(nextWorkNumber) || nextWorkNumber < 1) {
    workflowStateError(
      "$.next_work_number",
      "integer greater than or equal to 1"
    );
  }
  const current = field(value, "current");
  if (current !== null) parseCurrent(current, "$.current");
  const state = value;
  validateStateInvariants(state);
  return state;
}

// src/runtime/preflight.ts
import { lstat as lstat3, readFile as readFile3 } from "node:fs/promises";
import { join as join3 } from "node:path";

// src/runtime/project-root.ts
import { constants } from "node:fs";
import { access, lstat as lstat2, readFile as readFile2, realpath, stat } from "node:fs/promises";
import { dirname, join as join2, resolve } from "node:path";
function invalidCwd(cwd) {
  return new WorkflowError({
    code: ERROR_CODES.INVALID_INPUT,
    message: "The supplied cwd must be an accessible directory.",
    details: { cwd }
  });
}
async function canonicalizeCwd(cwd) {
  if (cwd.length === 0) throw invalidCwd(cwd);
  try {
    const canonical = await realpath(resolve(cwd));
    const metadata = await stat(canonical);
    if (!metadata.isDirectory()) throw invalidCwd(cwd);
    await access(canonical, constants.X_OK);
    return canonical;
  } catch (error) {
    if (error instanceof WorkflowError) throw error;
    throw invalidCwd(cwd);
  }
}
async function isGitProjectRoot(directory) {
  const markerPath = join2(directory, ".git");
  try {
    const marker = await lstat2(markerPath);
    if (marker.isDirectory()) return true;
    if (!marker.isFile()) return false;
    try {
      const source = await readFile2(markerPath, "utf8");
      return /^gitdir: .+(?:\r?\n)?$/u.test(source);
    } catch {
      throw new WorkflowError({
        code: ERROR_CODES.ARTIFACT_FAILURE,
        message: "The Git worktree marker is unreadable.",
        details: { path: markerPath }
      });
    }
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) return false;
    if (error instanceof WorkflowError) throw error;
    throw new WorkflowError({
      code: ERROR_CODES.ARTIFACT_FAILURE,
      message: "The Git marker could not be inspected.",
      details: { path: markerPath }
    });
  }
}
async function resolveProjectRoot(cwd) {
  const canonicalCwd = await canonicalizeCwd(cwd);
  let candidate = canonicalCwd;
  while (true) {
    if (await isGitProjectRoot(candidate)) return candidate;
    const parent = dirname(candidate);
    if (parent === candidate) return canonicalCwd;
    candidate = parent;
  }
}

// src/runtime/preflight.ts
function invalidState(rule) {
  return new WorkflowError({
    code: ERROR_CODES.INVALID_STATE,
    message: "Workflow state is invalid.",
    details: { path: "$", rule }
  });
}
async function readProjectState(projectRoot) {
  const workflowPath = join3(projectRoot, ".ntworkflow");
  let workflowMetadata;
  try {
    workflowMetadata = await lstat3(workflowPath);
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) return null;
    throw invalidState("readable workflow directory");
  }
  if (!workflowMetadata.isDirectory()) {
    throw invalidState("workflow directory");
  }
  const statePath = join3(workflowPath, "state.json");
  let metadata;
  try {
    metadata = await lstat3(statePath);
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) return null;
    throw invalidState("readable regular UTF-8 JSON file");
  }
  if (!metadata.isFile()) {
    throw invalidState("regular UTF-8 JSON file");
  }
  let source;
  try {
    const bytes = await readFile3(statePath);
    source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw invalidState("readable regular UTF-8 JSON file");
  }
  let value;
  try {
    value = JSON.parse(source);
  } catch {
    throw invalidState("valid JSON document");
  }
  return parseState(value);
}
async function readPreflight(cwd) {
  const projectRoot = await resolveProjectRoot(cwd);
  const state = await readProjectState(projectRoot);
  return Object.freeze({ projectRoot, state });
}

// src/runtime/transaction.ts
var TRANSACTION_FAULT_POINTS = Object.freeze([
  "before-write",
  "after-temp-sync",
  "before-rename"
]);
var DIRECTORY_DURABILITY_WARNING = "Workflow state committed, but parent directory durability could not be confirmed.";
var LOCK_RELEASE_WARNING = "Workflow state committed, but its state lock could not be safely released.";
function commitFailure(stage, path) {
  return new WorkflowError({
    code: ERROR_CODES.COMMIT_FAILURE,
    message: "Workflow state could not be committed.",
    details: { stage, path }
  });
}
function serializeState(state) {
  return `${JSON.stringify(state, null, 2)}
`;
}
async function closeQuietly(handle) {
  if (handle === null) return;
  try {
    await handle.close();
  } catch {
  }
}
async function releaseOwnedLock(lock) {
  let handle = null;
  try {
    await rename(lock.path, lock.releasePath);
  } catch {
    return false;
  }
  const restoreClaimedLock = async () => {
    try {
      await link(lock.releasePath, lock.path);
      await unlink(lock.releasePath);
    } catch {
    }
  };
  try {
    handle = await open(lock.releasePath, "r");
    const value = JSON.parse(await handle.readFile("utf8"));
    await handle.close();
    handle = null;
    if (value === null || typeof value !== "object" || Array.isArray(value) || value.token !== lock.token) {
      await restoreClaimedLock();
      return false;
    }
    await unlink(lock.releasePath);
    return true;
  } catch {
    await closeQuietly(handle);
    await restoreClaimedLock();
    return false;
  }
}
async function assertWorkflowDirectory(workflowPath) {
  try {
    if (!(await lstat4(workflowPath)).isDirectory()) {
      throw commitFailure("workflow-directory", workflowPath);
    }
  } catch (error) {
    if (error instanceof WorkflowError) throw error;
    if (hasErrorCode(error, "ENOENT")) {
      throw new WorkflowError({
        code: ERROR_CODES.ILLEGAL_TRANSITION,
        message: "A run must be started before this operation.",
        details: { actual_lifecycle: null }
      });
    }
    throw commitFailure("workflow-directory", workflowPath);
  }
}
async function acquireLock(workflowPath) {
  const lockPath = join4(workflowPath, ".state.lock");
  const token = randomUUID();
  const lock = {
    path: lockPath,
    releasePath: join4(workflowPath, `.state.lock.${token}.release`),
    token
  };
  let handle;
  try {
    handle = await open(lockPath, "wx", 384);
  } catch (error) {
    if (hasErrorCode(error, "EEXIST")) {
      throw new WorkflowError({
        code: ERROR_CODES.LOCK_CONFLICT,
        message: "Workflow state is locked by another mutator.",
        details: { path: lockPath }
      });
    }
    throw commitFailure("lock-create", lockPath);
  }
  try {
    await handle.writeFile(`${JSON.stringify({ pid: process.pid, token }, null, 2)}
`, "utf8");
    await handle.sync();
    await handle.close();
  } catch {
    await closeQuietly(handle);
    try {
      await unlink(lockPath);
    } catch {
    }
    throw commitFailure("lock-write", lockPath);
  }
  return lock;
}
async function syncParentDirectory(workflowPath) {
  if (process.platform === "win32") return null;
  let handle = null;
  let warning = null;
  try {
    handle = await open(workflowPath, "r");
    await handle.sync();
  } catch (error) {
    const unsupported = ["EBADF", "EINVAL", "EISDIR", "ENOSYS", "ENOTSUP", "EPERM"].some((code) => hasErrorCode(error, code));
    if (!unsupported) warning = DIRECTORY_DURABILITY_WARNING;
  } finally {
    if (handle !== null) {
      try {
        await handle.close();
      } catch {
        warning = DIRECTORY_DURABILITY_WARNING;
      }
    }
  }
  return warning;
}
async function commitState(workflowPath, serializedState, lockToken, faultInjector) {
  const statePath = join4(workflowPath, "state.json");
  const temporaryPath = join4(workflowPath, `.state.${lockToken}.tmp`);
  let handle = null;
  let renamed = false;
  try {
    handle = await open(temporaryPath, "wx", 384);
    await faultInjector?.("before-write");
    await handle.writeFile(serializedState, "utf8");
    await handle.sync();
    await faultInjector?.("after-temp-sync");
    await handle.close();
    handle = null;
    await faultInjector?.("before-rename");
    await rename(temporaryPath, statePath);
    renamed = true;
    return syncParentDirectory(workflowPath);
  } catch (error) {
    if (error instanceof WorkflowError) throw error;
    throw commitFailure("state-replace", statePath);
  } finally {
    await closeQuietly(handle);
    if (!renamed) {
      try {
        await unlink(temporaryPath);
      } catch {
      }
    }
  }
}
async function runStateTransaction(projectRoot, transition, options = {}) {
  const workflowPath = join4(projectRoot, ".ntworkflow");
  await assertWorkflowDirectory(workflowPath);
  const lock = await acquireLock(workflowPath);
  let state;
  const warnings = [];
  try {
    const currentState = await readProjectState(projectRoot);
    const nextState = parseState(await transition(currentState));
    const serializedState = serializeState(nextState);
    await options.prepareCommit?.(currentState, nextState);
    const durabilityWarning = await commitState(
      workflowPath,
      serializedState,
      lock.token,
      options.faultInjector
    );
    if (durabilityWarning !== null) warnings.push(durabilityWarning);
    state = nextState;
  } catch (error) {
    await releaseOwnedLock(lock);
    throw error;
  }
  if (!await releaseOwnedLock(lock)) warnings.push(LOCK_RELEASE_WARNING);
  return { state, warnings };
}

// src/runtime/phase.ts
var INTERRUPTION_AUTHORITIES = Object.freeze([
  "provider-ended",
  "user-confirmed"
]);
function isInterruptionAuthority(value) {
  return INTERRUPTION_AUTHORITIES.some((authority) => authority === value);
}
var INPUT_LIFECYCLE = {
  nttask: "intake-active",
  ntgrill: "brief-ready",
  ntplan: "plan-ready"
};
function invalidInput(message, argument, expected) {
  throw new WorkflowError({
    code: ERROR_CODES.INVALID_INPUT,
    message,
    details: expected === void 0 ? { argument } : { argument, expected }
  });
}
function validateSessionId(sessionId) {
  if (providerForSessionId(sessionId) === null) {
    invalidInput(
      "A canonical provider session ID is required.",
      "--session-id",
      SESSION_ID_FORMAT
    );
  }
}
function validateInterruption(interruption) {
  if (interruption !== void 0 && !isInterruptionAuthority(interruption)) {
    invalidInput(
      "Interruption authority is invalid.",
      "--interruption",
      "provider-ended or user-confirmed"
    );
  }
}
function requireBlocker(blocker) {
  if (blocker.trim().length === 0) {
    invalidInput("A controlled phase stop requires a non-empty blocker.", "--blocker");
  }
}
function illegalTransition(operation, state) {
  throw new WorkflowError({
    code: ERROR_CODES.ILLEGAL_TRANSITION,
    message: `${operation} is not legal from the current lifecycle.`,
    details: {
      actual_lifecycle: state?.current?.lifecycle ?? null,
      actual_phase: state?.current?.phase ?? null
    }
  });
}
function ownershipConflict(recordedOwner, requestedOwner, phase) {
  throw new WorkflowError({
    code: ERROR_CODES.OWNERSHIP_CONFLICT,
    message: `An ${phase} owner is already recorded.`,
    details: {
      recorded_owner: recordedOwner,
      requested_owner: requestedOwner
    }
  });
}
function unresolvedBlocker(blocker, phase) {
  throw new WorkflowError({
    code: ERROR_CODES.UNRESOLVED_BLOCKER,
    message: `The recorded blocker must be explicitly resolved before ${phase} begins.`,
    details: { blocker }
  });
}
function requireActivePhase(state, operation, phase) {
  if (state?.current?.lifecycle !== INPUT_LIFECYCLE[phase] || state.current.phase !== phase || state.current.owner === null) {
    throw new WorkflowError({
      code: ERROR_CODES.ILLEGAL_TRANSITION,
      message: `${operation} requires an active ${phase} phase.`,
      details: {
        actual_lifecycle: state?.current?.lifecycle ?? null,
        actual_phase: state?.current?.phase ?? null
      }
    });
  }
}
function requireOwner(state, sessionId, interruption) {
  if (state.current.owner.session_id !== sessionId && interruption === void 0) {
    ownershipConflict(state.current.owner.session_id, sessionId, state.current.phase);
  }
}
function beginTransition(state, input, phase) {
  if (state?.current?.lifecycle !== INPUT_LIFECYCLE[phase]) {
    illegalTransition(`phase begin ${phase}`, state);
  }
  if (state.current.blocker !== null && input.blockerResolved !== true) {
    unresolvedBlocker(state.current.blocker, phase);
  }
  if (state.current.owner !== null && input.interruption === void 0) {
    ownershipConflict(state.current.owner.session_id, input.sessionId, phase);
  }
  if (phase === "ntplan") {
    for (const [role, available] of [
      ["researcher", input.researcherAvailable],
      ["critic", input.criticAvailable]
    ]) {
      if (available !== true) throw new WorkflowError({
        code: ERROR_CODES.ARTIFACT_FAILURE,
        message: `The required native ntplan ${role} is unavailable.`,
        details: { role }
      });
    }
  }
  return {
    next_work_number: state.next_work_number,
    current: {
      run_id: state.current.run_id,
      lifecycle: state.current.lifecycle,
      phase,
      owner: { session_id: input.sessionId },
      blocker: null,
      work: null
    }
  };
}
function stopTransition(state, input, phase) {
  requireActivePhase(state, `phase stop ${phase}`, phase);
  requireOwner(state, input.sessionId, input.interruption);
  return {
    next_work_number: state.next_work_number,
    current: {
      run_id: state.current.run_id,
      lifecycle: state.current.lifecycle,
      phase: null,
      owner: null,
      blocker: input.blocker,
      work: null
    }
  };
}
async function beginPhase(projectRoot, phase, input) {
  validateSessionId(input.sessionId);
  validateInterruption(input.interruption);
  let runId;
  return runStateTransaction(projectRoot, (state) => {
    const next = beginTransition(state, input, phase);
    runId = next.current.run_id;
    return next;
  }, {
    ...phase !== "nttask" ? {
      prepareCommit: () => phase === "ntgrill" ? validateNttaskBrief(projectRoot, runId) : validateBrief(projectRoot, runId, "ntgrill")
    } : {}
  });
}
async function stopPhase(projectRoot, phase, input) {
  validateSessionId(input.sessionId);
  validateInterruption(input.interruption);
  requireBlocker(input.blocker);
  return runStateTransaction(projectRoot, (state) => stopTransition(state, input, phase));
}

// src/runtime/git.ts
import { execFile } from "node:child_process";
import { promisify } from "node:util";
var execFileAsync = promisify(execFile);
function gitFailure(message, operation) {
  return new WorkflowError({
    code: ERROR_CODES.ARTIFACT_FAILURE,
    message,
    details: { operation }
  });
}
async function git(projectRoot, arguments_) {
  try {
    const result = await execFileAsync("git", arguments_, {
      cwd: projectRoot,
      encoding: "utf8",
      windowsHide: true
    });
    return result.stdout.trim();
  } catch {
    throw gitFailure("The active Git context could not be inspected.", arguments_.join(" "));
  }
}
async function readGitContext(projectRoot) {
  const branch = await git(projectRoot, ["symbolic-ref", "--quiet", "--short", "HEAD"]);
  if (branch.length === 0) {
    throw gitFailure("ntwork requires a normal branch; detached HEAD is not allowed.", "symbolic-ref");
  }
  const head = await git(projectRoot, ["rev-parse", "--verify", "HEAD"]);
  const status = await git(projectRoot, [
    "status",
    "--porcelain=v1",
    "-z",
    "--untracked-files=all",
    "--",
    ".",
    ":(exclude).ntworkflow"
  ]);
  return { branch, head, projectDirty: status.length > 0 };
}
async function readCommitParent(projectRoot, commit) {
  return git(projectRoot, ["rev-parse", "--verify", `${commit}^`]);
}

// src/runtime/plan-artifacts.ts
import { lstat as lstat5, readFile as readFile4, readdir } from "node:fs/promises";
import { join as join5 } from "node:path";
var TASK_ID = "NT-\\d{3,}-\\d{2,}";
var ACCEPTANCE_ID = "AC-[1-9]\\d*";
var SPEC_SECTIONS = ["Outcome", "Scope", "Requirements", "Constraints", "Acceptance criteria"];
var PLAN_SECTIONS = ["Approach", "Technical decisions", "Dependency graph", "Execution order", "Task index", "Final validation"];
var PACKET_SECTIONS = ["Goal", "Scope", "Dependencies", "Acceptance coverage", "Verification"];
function invalid(path, reason) {
  throw new WorkflowError({
    code: ERROR_CODES.ARTIFACT_FAILURE,
    message: "Planning artifacts do not satisfy the ntplan contract.",
    details: { path, reason }
  });
}
async function requireKind(path, kind) {
  try {
    const stat2 = await lstat5(path);
    if (kind === "file" ? !stat2.isFile() : !stat2.isDirectory()) invalid(path, `expected a regular ${kind}`);
  } catch (error) {
    if (error instanceof WorkflowError) throw error;
    invalid(path, `missing or unreadable ${kind}`);
  }
}
async function document(path, required) {
  await requireKind(path, "file");
  let source;
  try {
    source = new TextDecoder("utf-8", { fatal: true }).decode(await readFile4(path));
  } catch {
    invalid(path, "expected readable UTF-8 Markdown");
  }
  const { headings, lines, visibleLines } = parseMarkdown(source);
  const titles = headings.filter((h) => h.level === 1);
  const title = titles[0];
  if (titles.length !== 1 || !title?.text || headings[0] !== title) invalid(path, "exactly one non-empty leading H1 is required");
  const sections = {};
  const visibleSections = {};
  const h2s = headings.filter((h) => h.level === 2);
  for (const [index, heading] of h2s.entries()) {
    if (Object.hasOwn(sections, heading.text)) invalid(path, `duplicate section ${heading.text}`);
    sections[heading.text] = lines.slice(heading.line + 1, h2s[index + 1]?.line ?? lines.length).join("\n").trim();
    visibleSections[heading.text] = visibleLines.slice(heading.line + 1, h2s[index + 1]?.line ?? lines.length).join("\n").trim();
  }
  for (const name of required) if (!sections[name]) invalid(path, `missing or empty section ${name}`);
  return { title: title.text, sections, visibleSections };
}
function unique(ids, path) {
  if (new Set(ids).size !== ids.length) invalid(path, "duplicate ID");
  return ids;
}
function idList(body, pattern, path) {
  if (body === "none") return [];
  const ids = body.split(",").map((id) => id.trim());
  if (!ids.every((id) => new RegExp(`^${pattern}$`, "u").test(id))) invalid(path, "expected comma-separated IDs or none");
  return unique(ids, path);
}
function rows(body, pattern, path) {
  const parsed = [];
  for (const line of body.split("\n").filter((line2) => line2.trim())) {
    const match = new RegExp(`^- (${pattern}): (\\S.*)$`, "u").exec(line.trim());
    if (!match) invalid(path, "expected non-empty - ID: description rows");
    parsed.push([match[1], match[2]]);
  }
  unique(parsed.map(([id]) => id), path);
  return parsed;
}
async function validatePlanArtifacts(projectRoot, runId) {
  const runs = join5(projectRoot, ".ntworkflow", "runs");
  const run = join5(runs, runId);
  const tasks = join5(run, "tasks");
  for (const path of [runs, run, tasks]) await requireKind(path, "directory");
  const specPath = join5(run, "SPEC.md");
  const planPath = join5(run, "PLAN.md");
  const spec = await document(specPath, SPEC_SECTIONS);
  const plan = await document(planPath, PLAN_SECTIONS);
  const acceptance = rows(spec.sections["Acceptance criteria"], ACCEPTANCE_ID, specPath).map(([id]) => id);
  const order = plan.sections["Execution order"].split("\n").filter((line) => line.trim()).map((line, i) => {
    const match = new RegExp(`^${i + 1}\\. (${TASK_ID})$`, "u").exec(line.trim());
    if (!match) invalid(planPath, "execution order must be a numbered list of task IDs");
    return match[1];
  });
  unique(order, planPath);
  if (!order.length) invalid(planPath, "at least one executable task is required");
  const graph = new Map(rows(plan.sections["Dependency graph"], TASK_ID, planPath));
  const index = rows(plan.sections["Task index"], TASK_ID, planPath).map(([id]) => id);
  const sameSet = (a, b) => a.length === b.length && a.every((id) => b.includes(id));
  if (!sameSet(order, [...graph.keys()]) || !sameSet(order, index)) invalid(planPath, "graph, order and task index must contain exactly the same tasks");
  let entries;
  try {
    entries = await readdir(tasks);
  } catch {
    invalid(tasks, "unreadable task directory");
  }
  if (!sameSet(entries, order.map((id) => `${id}.md`))) invalid(tasks, "packet files must exactly match the task index");
  const owned = /* @__PURE__ */ new Set();
  const own = (ids, path) => {
    for (const id of ids) {
      if (!acceptance.includes(id)) invalid(path, `unknown acceptance ID ${id}`);
      if (owned.has(id)) invalid(path, `multiply owned acceptance ID ${id}`);
      owned.add(id);
    }
  };
  for (const [position, id] of order.entries()) {
    const path = join5(tasks, `${id}.md`);
    if (id !== `${runId}-${String(position + 1).padStart(2, "0")}`) invalid(path, "task ID must derive from the run ID and stable order");
    const packet = await document(path, PACKET_SECTIONS);
    if (!packet.title.startsWith(`${id}: `) || !packet.title.slice(id.length + 2).trim()) invalid(path, "displayed ID must match the packet filename");
    const dependencies = idList(packet.sections.Dependencies, TASK_ID, path);
    for (const dependency of dependencies) {
      const dependencyIndex = order.indexOf(dependency);
      if (dependencyIndex < 0) invalid(path, `unknown dependency ${dependency}`);
      if (dependencyIndex >= position) invalid(path, "dependency cycle or dependency does not precede its dependent");
    }
    if (!sameSet(dependencies, idList(graph.get(id), TASK_ID, planPath))) invalid(planPath, `graph disagrees with canonical dependencies of ${id}`);
    own(idList(packet.sections["Acceptance coverage"], ACCEPTANCE_ID, path), path);
  }
  const finalRows = plan.visibleSections["Final validation"].split("\n").filter((line) => /^\s*- AC-/u.test(line)).join("\n");
  own(rows(finalRows, ACCEPTANCE_ID, planPath).map(([id]) => id), planPath);
  for (const id of acceptance) if (!owned.has(id)) invalid(specPath, `unowned acceptance ID ${id}`);
  return order;
}

// src/runtime/ntwork.ts
var NTWORK_ROLES = [
  "implementer",
  "task-reviewer",
  "nyquist-auditor",
  "spec-integration-reviewer",
  "code-reviewer"
];
function illegal(state, operation) {
  throw new WorkflowError({
    code: ERROR_CODES.ILLEGAL_TRANSITION,
    message: `${operation} is not legal from the current lifecycle.`,
    details: {
      actual_lifecycle: state?.current?.lifecycle ?? null,
      actual_phase: state?.current?.phase ?? null
    }
  });
}
function ownership(recorded, requested) {
  throw new WorkflowError({
    code: ERROR_CODES.OWNERSHIP_CONFLICT,
    message: "An ntwork owner is already recorded.",
    details: { recorded_owner: recorded, requested_owner: requested }
  });
}
function requireWorkState(state, operation) {
  if (state?.current === null || state?.current === void 0 || state.current.lifecycle !== "plan-approved" && state.current.lifecycle !== "work-active" || state.current.work === null) illegal(state, operation);
  return state;
}
function requireOwner2(state, input) {
  if (state.current.phase !== "ntwork" || state.current.owner === null) {
    illegal(state, "phase stop ntwork");
  }
  if (state.current.owner.session_id !== input.sessionId && input.interruption === void 0) {
    ownership(state.current.owner.session_id, input.sessionId);
  }
}
function requireActiveOwner(state, sessionId, operation) {
  if (state.current.phase !== "ntwork" || state.current.owner === null) {
    illegal(state, operation);
  }
  if (state.current.owner.session_id !== sessionId) {
    ownership(state.current.owner.session_id, sessionId);
  }
}
function requireRoles(available) {
  for (const role of NTWORK_ROLES) {
    if (!available.has(role)) {
      throw new WorkflowError({
        code: ERROR_CODES.ARTIFACT_FAILURE,
        message: `The required native ntwork ${role} is unavailable.`,
        details: { role }
      });
    }
  }
}
function requireMatchingTaskOrder(recorded, artifact) {
  if (recorded.length !== artifact.length || recorded.some((taskId, index) => taskId !== artifact[index])) {
    throw new WorkflowError({
      code: ERROR_CODES.ARTIFACT_FAILURE,
      message: "Approved task artifacts do not match recorded ntwork state.",
      details: { recorded_tasks: recorded, artifact_tasks: artifact }
    });
  }
}
async function beginNtworkPhase(projectRoot, input) {
  validateSessionId(input.sessionId);
  const snapshot = await readPreflight(projectRoot);
  if (snapshot.state?.current?.lifecycle !== "plan-approved" && snapshot.state?.current?.lifecycle !== "work-active") illegal(snapshot.state, "phase begin ntwork");
  if (input.baseBranch !== void 0 && input.baseBranch.trim().length === 0) {
    throw new WorkflowError({
      code: ERROR_CODES.INVALID_INPUT,
      message: "The optional base branch must be non-empty.",
      details: { argument: "--base-branch" }
    });
  }
  requireRoles(input.availableRoles);
  const provider = providerForSessionId(input.sessionId);
  const observed = await readGitContext(projectRoot);
  const recordedHead = snapshot.state?.current?.work?.head_commit;
  const observedParent = recordedHead !== null && recordedHead !== void 0 && recordedHead !== observed.head ? await readCommitParent(projectRoot, observed.head) : null;
  let runId = "";
  let recordedTasks = [];
  return runStateTransaction(projectRoot, (rawState) => {
    const state = requireWorkState(rawState, "phase begin ntwork");
    runId = state.current.run_id;
    recordedTasks = state.current.work.tasks.map((task) => task.task_id);
    if (state.current.blocker !== null && input.blockerResolved !== true) {
      throw new WorkflowError({
        code: ERROR_CODES.UNRESOLVED_BLOCKER,
        message: "The recorded blocker must be explicitly resolved before ntwork begins.",
        details: { blocker: state.current.blocker }
      });
    }
    if (state.current.owner !== null && input.interruption === void 0) {
      ownership(state.current.owner.session_id, input.sessionId);
    }
    if (state.current.work.provider !== null && state.current.work.provider !== provider) {
      throw new WorkflowError({
        code: ERROR_CODES.OWNERSHIP_CONFLICT,
        message: "An active ntwork task may resume only under the recorded provider.",
        details: { recorded_provider: state.current.work.provider, requested_provider: provider }
      });
    }
    if (input.baseBranch !== void 0 && state.current.work.base_branch !== null && state.current.work.base_branch !== input.baseBranch) {
      throw new WorkflowError({
        code: ERROR_CODES.ARTIFACT_FAILURE,
        message: "The supplied base branch does not match recorded ntwork state.",
        details: {
          recorded_base_branch: state.current.work.base_branch,
          supplied_base_branch: input.baseBranch
        }
      });
    }
    const active = state.current.work.tasks.find((task) => task.status === "active");
    if (observed.projectDirty && active === void 0 && input.existingChangesConfirmed !== true) {
      throw new WorkflowError({
        code: ERROR_CODES.ARTIFACT_FAILURE,
        message: "Pre-existing project-file changes require explicit user permission before ntwork begins.",
        details: { branch: observed.branch }
      });
    }
    const commitAheadForActiveTask = active !== void 0 && state.current.work.head_commit !== null && observedParent === state.current.work.head_commit;
    if (state.current.work.branch !== null && (state.current.work.branch !== observed.branch || state.current.work.head_commit !== observed.head && !commitAheadForActiveTask)) {
      throw new WorkflowError({
        code: ERROR_CODES.ARTIFACT_FAILURE,
        message: "The active Git context does not match recorded ntwork state.",
        details: {
          recorded_branch: state.current.work.branch,
          actual_branch: observed.branch,
          recorded_head: state.current.work.head_commit,
          actual_head: observed.head
        }
      });
    }
    return {
      next_work_number: state.next_work_number,
      current: {
        ...state.current,
        lifecycle: "work-active",
        phase: "ntwork",
        owner: { session_id: input.sessionId },
        blocker: null,
        work: {
          ...state.current.work,
          provider,
          branch: state.current.work.branch ?? observed.branch,
          base_branch: state.current.work.base_branch ?? input.baseBranch ?? observed.branch,
          head_commit: state.current.work.head_commit ?? observed.head
        }
      }
    };
  }, {
    prepareCommit: async () => {
      await validateBrief(projectRoot, runId, "ntgrill");
      requireMatchingTaskOrder(recordedTasks, await validatePlanArtifacts(projectRoot, runId));
      const current = await readGitContext(projectRoot);
      if (current.branch !== observed.branch || current.head !== observed.head || current.projectDirty !== observed.projectDirty) {
        throw new WorkflowError({
          code: ERROR_CODES.ARTIFACT_FAILURE,
          message: "The Git context changed during ntwork preflight.",
          details: { branch: current.branch, head: current.head }
        });
      }
    }
  });
}
async function stopNtworkPhase(projectRoot, input) {
  validateSessionId(input.sessionId);
  if (input.blocker.trim().length === 0) {
    throw new WorkflowError({
      code: ERROR_CODES.INVALID_INPUT,
      message: "A controlled phase stop requires a non-empty blocker.",
      details: { argument: "--blocker" }
    });
  }
  return runStateTransaction(projectRoot, (rawState) => {
    const state = requireWorkState(rawState, "phase stop ntwork");
    requireOwner2(state, input);
    return {
      next_work_number: state.next_work_number,
      current: {
        ...state.current,
        phase: null,
        owner: null,
        blocker: input.blocker
      }
    };
  });
}
async function beginWorkTask(projectRoot, input) {
  validateSessionId(input.sessionId);
  const observed = await readGitContext(projectRoot);
  if (observed.projectDirty && input.existingChangesConfirmed !== true) {
    throw new WorkflowError({
      code: ERROR_CODES.ARTIFACT_FAILURE,
      message: "A new ntwork task requires a clean project worktree.",
      details: { branch: observed.branch }
    });
  }
  let runId = "";
  let recordedTasks = [];
  return runStateTransaction(projectRoot, (rawState) => {
    const state = requireWorkState(rawState, "task begin");
    requireActiveOwner(state, input.sessionId, "task begin");
    runId = state.current.run_id;
    recordedTasks = state.current.work.tasks.map((task) => task.task_id);
    const active = state.current.work.tasks.find((task) => task.status === "active");
    const next = state.current.work.tasks.find((task) => task.status !== "completed");
    if (state.current.work.verdicts.ci === "fail") {
      throw new WorkflowError({
        code: ERROR_CODES.ILLEGAL_TRANSITION,
        message: "Known failing required CI must be resolved before the next task begins.",
        details: { next_task: next?.task_id ?? null }
      });
    }
    if (active !== void 0 || next === void 0 || next.task_id !== input.taskId) {
      throw new WorkflowError({
        code: ERROR_CODES.ILLEGAL_TRANSITION,
        message: "task begin requires the exact next pending task in approved stable order.",
        details: {
          requested_task: input.taskId,
          next_task: next?.task_id ?? null,
          active_task: active?.task_id ?? null
        }
      });
    }
    if (state.current.work.branch !== observed.branch || state.current.work.head_commit !== observed.head) {
      throw new WorkflowError({
        code: ERROR_CODES.ARTIFACT_FAILURE,
        message: "The current Git branch or HEAD does not match recorded ntwork state.",
        details: { actual_branch: observed.branch, actual_head: observed.head }
      });
    }
    return {
      next_work_number: state.next_work_number,
      current: {
        ...state.current,
        work: {
          ...state.current.work,
          tasks: state.current.work.tasks.map((task) => task.task_id === input.taskId ? { ...task, status: "active", start_commit: observed.head } : task)
        }
      }
    };
  }, {
    prepareCommit: async () => {
      requireMatchingTaskOrder(recordedTasks, await validatePlanArtifacts(projectRoot, runId));
      const current = await readGitContext(projectRoot);
      if (current.branch !== observed.branch || current.head !== observed.head || current.projectDirty !== observed.projectDirty) {
        throw new WorkflowError({
          code: ERROR_CODES.ARTIFACT_FAILURE,
          message: "The Git context changed during task begin.",
          details: { branch: current.branch, head: current.head }
        });
      }
    }
  });
}
function requireText(value, field2) {
  if (value.trim().length === 0) {
    throw new WorkflowError({
      code: ERROR_CODES.INVALID_INPUT,
      message: `work record requires a non-empty ${field2}.`,
      details: { argument: field2 }
    });
  }
}
function validateSourceIds(sourceIds) {
  if (sourceIds.length === 0 || sourceIds.some((id) => id.length === 0)) {
    throw new WorkflowError({
      code: ERROR_CODES.INVALID_INPUT,
      message: "work record requires at least one native source ID.",
      details: { argument: "--source-id" }
    });
  }
  return [...new Set(sourceIds)];
}
async function recordTaskEvidence(projectRoot, input) {
  validateSessionId(input.sessionId);
  for (const [field2, value] of [
    ["gate", input.gate],
    ["procedure", input.procedure],
    ["result", input.result],
    ["expected", input.expected]
  ]) requireText(value, field2);
  const sourceIds = validateSourceIds(input.sourceIds);
  const observed = await readGitContext(projectRoot);
  return runStateTransaction(projectRoot, (rawState) => {
    const state = requireWorkState(rawState, "work record evidence");
    requireActiveOwner(state, input.sessionId, "work record evidence");
    const active = state.current.work.tasks.find((task) => task.status === "active");
    const fixScope = input.gate.startsWith("fix:") ? input.gate.slice(4) : "";
    const isTaskEvidence = active !== void 0 && input.gate === `task:${active.task_id}`;
    const isFixEvidence = active === void 0 && fixScope.length > 0 && (fixScope === "integration" ? state.current.work.tasks.some((task) => task.status === "completed") : state.current.work.tasks.some((task) => task.task_id === fixScope && task.status === "completed"));
    if (!isTaskEvidence && !isFixEvidence) {
      throw new WorkflowError({
        code: ERROR_CODES.ILLEGAL_TRANSITION,
        message: "Task evidence must name the current active task gate.",
        details: { gate: input.gate, active_task: active?.task_id ?? null }
      });
    }
    if (state.current.work.branch !== observed.branch || state.current.work.head_commit !== observed.head) {
      throw new WorkflowError({
        code: ERROR_CODES.ARTIFACT_FAILURE,
        message: "Task evidence does not match the recorded Git context.",
        details: { branch: observed.branch, head: observed.head }
      });
    }
    const evidence = {
      gate: input.gate,
      procedure: input.procedure,
      revision: `worktree@${observed.head}`,
      result: input.result,
      expected: input.expected,
      source_ids: sourceIds
    };
    const reviewGate = isTaskEvidence ? `task-review:${active.task_id}` : `fix-review:${fixScope}`;
    return {
      next_work_number: state.next_work_number,
      current: {
        ...state.current,
        work: {
          ...state.current.work,
          tasks: state.current.work.tasks.map((task) => isTaskEvidence && task.task_id === active.task_id ? { ...task, packet_review: "pending", quality_review: "pending" } : task),
          evidence: [
            ...state.current.work.evidence.filter((item) => item.gate !== input.gate && item.gate !== reviewGate),
            evidence
          ]
        }
      }
    };
  });
}
async function recordTaskReview(projectRoot, input) {
  validateSessionId(input.sessionId);
  const sourceIds = validateSourceIds(input.sourceIds);
  const observed = await readGitContext(projectRoot);
  return runStateTransaction(projectRoot, (rawState) => {
    const state = requireWorkState(rawState, "work record task-review");
    requireActiveOwner(state, input.sessionId, "work record task-review");
    const active = state.current.work.tasks.find((task) => task.status === "active");
    const isTaskReview = active?.task_id === input.taskId;
    const isFixReview = active === void 0 && (input.taskId === "integration" ? state.current.work.tasks.some((task) => task.status === "completed") : state.current.work.tasks.some((task) => task.task_id === input.taskId && task.status === "completed"));
    if (!isTaskReview && !isFixReview) {
      throw new WorkflowError({
        code: ERROR_CODES.ILLEGAL_TRANSITION,
        message: "Task review must name the current active task.",
        details: { requested_task: input.taskId, active_task: active?.task_id ?? null }
      });
    }
    if (state.current.work.branch !== observed.branch || state.current.work.head_commit !== observed.head) {
      throw new WorkflowError({
        code: ERROR_CODES.ARTIFACT_FAILURE,
        message: "Task review does not match the recorded Git context.",
        details: { branch: observed.branch, head: observed.head }
      });
    }
    const gate = isTaskReview ? `task-review:${input.taskId}` : `fix-review:${input.taskId}`;
    const evidenceGate = isTaskReview ? `task:${input.taskId}` : `fix:${input.taskId}`;
    if (!state.current.work.evidence.some((item) => item.gate === evidenceGate && item.revision === `worktree@${observed.head}`)) {
      throw new WorkflowError({
        code: ERROR_CODES.ARTIFACT_FAILURE,
        message: "Task review requires current passing canonical evidence first.",
        details: { gate: evidenceGate }
      });
    }
    return {
      next_work_number: state.next_work_number,
      current: {
        ...state.current,
        work: {
          ...state.current.work,
          tasks: state.current.work.tasks.map((task) => isTaskReview && task.task_id === input.taskId ? { ...task, packet_review: input.packet, quality_review: input.quality } : task),
          evidence: [
            ...state.current.work.evidence.filter((item) => item.gate !== gate),
            {
              gate,
              procedure: "Independent native task review.",
              revision: `worktree@${observed.head}`,
              result: `packet=${input.packet}; quality=${input.quality}`,
              expected: "packet=pass; quality=pass",
              source_ids: sourceIds
            }
          ]
        }
      }
    };
  });
}
async function completeWorkTask(projectRoot, input) {
  validateSessionId(input.sessionId);
  requireText(input.commitId, "commit-id");
  const observed = await readGitContext(projectRoot);
  if (observed.projectDirty || observed.head !== input.commitId) {
    throw new WorkflowError({
      code: ERROR_CODES.ARTIFACT_FAILURE,
      message: "task complete requires the supplied current commit and a clean project worktree.",
      details: { supplied_commit: input.commitId, actual_head: observed.head }
    });
  }
  const parent = await readCommitParent(projectRoot, input.commitId);
  let runId = "";
  let recordedTasks = [];
  return runStateTransaction(projectRoot, (rawState) => {
    const state = requireWorkState(rawState, "task complete");
    requireActiveOwner(state, input.sessionId, "task complete");
    runId = state.current.run_id;
    recordedTasks = state.current.work.tasks.map((task) => task.task_id);
    const active = state.current.work.tasks.find((task) => task.status === "active");
    if (active?.task_id !== input.taskId) {
      throw new WorkflowError({
        code: ERROR_CODES.ILLEGAL_TRANSITION,
        message: "task complete must name the current active task.",
        details: { requested_task: input.taskId, active_task: active?.task_id ?? null }
      });
    }
    if (active.start_commit === null || parent !== active.start_commit || active.packet_review !== "pass" || active.quality_review !== "pass") {
      throw new WorkflowError({
        code: ERROR_CODES.ARTIFACT_FAILURE,
        message: "Task completion requires one dedicated commit and both task-review verdicts PASS.",
        details: { task_id: input.taskId, start_commit: active.start_commit, commit_parent: parent }
      });
    }
    const requiredGates = [`task:${input.taskId}`, `task-review:${input.taskId}`];
    if (!requiredGates.every((gate) => state.current.work.evidence.some((item) => item.gate === gate && item.revision === `worktree@${parent}`))) {
      throw new WorkflowError({
        code: ERROR_CODES.ARTIFACT_FAILURE,
        message: "Task completion requires fresh canonical verification and task-review evidence.",
        details: { task_id: input.taskId }
      });
    }
    return {
      next_work_number: state.next_work_number,
      current: {
        ...state.current,
        work: {
          ...state.current.work,
          head_commit: input.commitId,
          tasks: state.current.work.tasks.map((task) => task.task_id === input.taskId ? { ...task, status: "completed", commit_id: input.commitId } : task),
          evidence: state.current.work.evidence.map((item) => requiredGates.includes(item.gate) ? { ...item, revision: input.commitId } : item)
        }
      }
    };
  }, {
    prepareCommit: async () => {
      requireMatchingTaskOrder(recordedTasks, await validatePlanArtifacts(projectRoot, runId));
      const current = await readGitContext(projectRoot);
      if (current.branch !== observed.branch || current.head !== observed.head || current.projectDirty) {
        throw new WorkflowError({
          code: ERROR_CODES.ARTIFACT_FAILURE,
          message: "The Git context changed during task completion.",
          details: { branch: current.branch, head: current.head }
        });
      }
    }
  });
}
var FINAL_GATES = ["whole-plan", "nyquist", "spec-integration", "code-review", "ci"];
function verdictKey(gate) {
  return gate === "whole-plan" ? "whole_plan" : gate === "spec-integration" ? "spec_integration" : gate === "code-review" ? "code_review" : gate;
}
function validateGateVerdict(input) {
  const valid = input.gate === "whole-plan" ? input.verdict === "pass" || input.verdict === "fail" : input.gate === "ci" ? input.verdict === "pass" || input.verdict === "fail" || input.verdict === "not-required" : input.verdict === "pass" || input.verdict === "block";
  if (!valid) {
    throw new WorkflowError({
      code: ERROR_CODES.INVALID_INPUT,
      message: `Verdict ${input.verdict} is invalid for ${input.gate}.`,
      details: { gate: input.gate, verdict: input.verdict }
    });
  }
}
async function recordFinalGate(projectRoot, input) {
  validateSessionId(input.sessionId);
  validateGateVerdict(input);
  for (const [field2, value] of [
    ["procedure", input.procedure],
    ["result", input.result],
    ["expected", input.expected]
  ]) requireText(value, field2);
  const sourceIds = validateSourceIds(input.sourceIds);
  const observed = await readGitContext(projectRoot);
  if (observed.projectDirty) {
    throw new WorkflowError({
      code: ERROR_CODES.ARTIFACT_FAILURE,
      message: "Final gate evidence requires a clean project worktree.",
      details: { gate: input.gate }
    });
  }
  return runStateTransaction(projectRoot, (rawState) => {
    const state = requireWorkState(rawState, `work record ${input.gate}`);
    requireActiveOwner(state, input.sessionId, `work record ${input.gate}`);
    const allTasksCompleted2 = state.current.work.tasks.every((task) => task.status === "completed");
    const workStarted = state.current.work.tasks.some((task) => task.status !== "pending");
    if (input.gate === "ci" && !workStarted) {
      throw new WorkflowError({
        code: ERROR_CODES.ILLEGAL_TRANSITION,
        message: "CI evidence requires an active or completed task boundary.",
        details: { gate: input.gate }
      });
    }
    if (input.gate !== "ci" && !allTasksCompleted2) {
      throw new WorkflowError({
        code: ERROR_CODES.ILLEGAL_TRANSITION,
        message: "Final gates require every approved task to be completed.",
        details: { gate: input.gate }
      });
    }
    if (state.current.work.branch !== observed.branch || state.current.work.head_commit !== observed.head) {
      throw new WorkflowError({
        code: ERROR_CODES.ARTIFACT_FAILURE,
        message: "Final gate evidence does not match recorded Git state.",
        details: { gate: input.gate, branch: observed.branch, head: observed.head }
      });
    }
    if (input.gate !== "whole-plan" && input.gate !== "ci" && state.current.work.verdicts.whole_plan !== "pass") {
      throw new WorkflowError({
        code: ERROR_CODES.ILLEGAL_TRANSITION,
        message: "Independent final reviews require whole-plan validation PASS.",
        details: { gate: input.gate }
      });
    }
    if (input.gate === "ci" && allTasksCompleted2 && !(state.current.work.verdicts.nyquist === "pass" && state.current.work.verdicts.spec_integration === "pass" && state.current.work.verdicts.code_review === "pass")) {
      throw new WorkflowError({
        code: ERROR_CODES.ILLEGAL_TRANSITION,
        message: "The CI decision follows all three independent final review passes.",
        details: { gate: input.gate }
      });
    }
    const key = verdictKey(input.gate);
    const previous = state.current.work.verdicts[key];
    const previousEvidence = state.current.work.evidence.find((item) => item.gate === input.gate);
    if ((previous === "fail" || previous === "block") && (input.verdict === "pass" || input.verdict === "not-required") && previousEvidence?.revision === observed.head) {
      throw new WorkflowError({
        code: ERROR_CODES.ARTIFACT_FAILURE,
        message: "A failing gate cannot become passing on the same revision without a recorded fix commit.",
        details: { gate: input.gate, revision: observed.head }
      });
    }
    const resetAfterWholePlan = input.gate === "whole-plan";
    const verdicts = {
      ...state.current.work.verdicts,
      ...resetAfterWholePlan ? {
        nyquist: "pending",
        spec_integration: "pending",
        code_review: "pending",
        ci: "pending"
      } : {},
      [key]: input.verdict
    };
    const invalidatedGates = resetAfterWholePlan ? FINAL_GATES : [input.gate];
    return {
      next_work_number: state.next_work_number,
      current: {
        ...state.current,
        work: {
          ...state.current.work,
          verdicts,
          evidence: [
            ...state.current.work.evidence.filter((item) => !invalidatedGates.includes(item.gate)),
            {
              gate: input.gate,
              procedure: input.procedure,
              revision: observed.head,
              result: input.result,
              expected: input.expected,
              source_ids: sourceIds
            }
          ]
        }
      }
    };
  });
}
async function completeNtworkPhase(projectRoot, input) {
  validateSessionId(input.sessionId);
  const observed = await readGitContext(projectRoot);
  if (observed.projectDirty) {
    throw new WorkflowError({
      code: ERROR_CODES.ARTIFACT_FAILURE,
      message: "ntwork completion requires a clean project worktree.",
      details: { branch: observed.branch }
    });
  }
  let runId = "";
  let recordedTasks = [];
  return runStateTransaction(projectRoot, (rawState) => {
    const state = requireWorkState(rawState, "phase complete ntwork");
    requireActiveOwner(state, input.sessionId, "phase complete ntwork");
    runId = state.current.run_id;
    recordedTasks = state.current.work.tasks.map((task) => task.task_id);
    const work = state.current.work;
    const gatesPass = work.tasks.every((task) => task.status === "completed") && work.verdicts.whole_plan === "pass" && work.verdicts.nyquist === "pass" && work.verdicts.spec_integration === "pass" && work.verdicts.code_review === "pass" && (work.verdicts.ci === "pass" || work.verdicts.ci === "not-required") && FINAL_GATES.every((gate) => work.evidence.some((item) => item.gate === gate && item.revision === observed.head));
    if (!gatesPass) {
      throw new WorkflowError({
        code: ERROR_CODES.ARTIFACT_FAILURE,
        message: "ntwork completion requires every task and current-revision final gate to pass.",
        details: { revision: observed.head }
      });
    }
    if (work.branch !== observed.branch || work.head_commit !== observed.head) {
      throw new WorkflowError({
        code: ERROR_CODES.ARTIFACT_FAILURE,
        message: "The final Git context does not match recorded ntwork state.",
        details: { branch: observed.branch, head: observed.head }
      });
    }
    return {
      next_work_number: state.next_work_number,
      current: {
        ...state.current,
        lifecycle: "delivery-ready",
        phase: "delivery-ready",
        owner: null,
        blocker: null
      }
    };
  }, {
    prepareCommit: async () => {
      await validateBrief(projectRoot, runId, "ntgrill");
      requireMatchingTaskOrder(recordedTasks, await validatePlanArtifacts(projectRoot, runId));
      const current = await readGitContext(projectRoot);
      if (current.branch !== observed.branch || current.head !== observed.head || current.projectDirty) {
        throw new WorkflowError({
          code: ERROR_CODES.ARTIFACT_FAILURE,
          message: "The Git context changed during ntwork completion.",
          details: { branch: current.branch, head: current.head }
        });
      }
    }
  });
}
async function recordFixCommit(projectRoot, input) {
  validateSessionId(input.sessionId);
  requireText(input.commitId, "commit-id");
  requireText(input.scope, "scope");
  for (const [field2, value] of [
    ["procedure", input.procedure],
    ["result", input.result],
    ["expected", input.expected]
  ]) requireText(value, field2);
  const sourceIds = validateSourceIds(input.sourceIds);
  const observed = await readGitContext(projectRoot);
  if (observed.projectDirty || observed.head !== input.commitId) {
    throw new WorkflowError({
      code: ERROR_CODES.ARTIFACT_FAILURE,
      message: "A fix record requires the supplied current commit and a clean project worktree.",
      details: { supplied_commit: input.commitId, actual_head: observed.head }
    });
  }
  const parent = await readCommitParent(projectRoot, input.commitId);
  return runStateTransaction(projectRoot, (rawState) => {
    const state = requireWorkState(rawState, "work record fix-commit");
    requireActiveOwner(state, input.sessionId, "work record fix-commit");
    if (state.current.work.tasks.some((task) => task.status === "active")) {
      throw new WorkflowError({
        code: ERROR_CODES.ILLEGAL_TRANSITION,
        message: "Fix work cannot be recorded in parallel with an active task.",
        details: null
      });
    }
    if (state.current.work.branch !== observed.branch || state.current.work.head_commit === null || parent !== state.current.work.head_commit) {
      throw new WorkflowError({
        code: ERROR_CODES.ARTIFACT_FAILURE,
        message: "A fix commit must be one direct commit after the recorded ntwork HEAD.",
        details: { recorded_head: state.current.work.head_commit, commit_parent: parent }
      });
    }
    const requiredGates = [`fix:${input.scope}`, `fix-review:${input.scope}`];
    if (!requiredGates.every((gate) => state.current.work.evidence.some((item) => item.gate === gate && item.revision === `worktree@${parent}` && (gate.startsWith("fix-review:") ? item.result === "packet=pass; quality=pass" : true)))) {
      throw new WorkflowError({
        code: ERROR_CODES.ARTIFACT_FAILURE,
        message: "A fix commit requires fresh passing verification and independent review of the same tree.",
        details: { scope: input.scope }
      });
    }
    return {
      next_work_number: state.next_work_number,
      current: {
        ...state.current,
        work: {
          ...state.current.work,
          head_commit: input.commitId,
          fix_commits: [...state.current.work.fix_commits, input.commitId],
          evidence: [
            ...state.current.work.evidence.filter((item) => !FINAL_GATES.includes(item.gate)).map((item) => requiredGates.includes(item.gate) ? { ...item, revision: input.commitId } : item),
            {
              gate: `fix-commit:${input.commitId}`,
              procedure: input.procedure,
              revision: input.commitId,
              result: input.result,
              expected: input.expected,
              source_ids: sourceIds
            }
          ],
          verdicts: {
            whole_plan: "pending",
            nyquist: "pending",
            spec_integration: "pending",
            code_review: "pending",
            ci: "pending"
          }
        }
      }
    };
  });
}
async function recordPullRequest(projectRoot, input) {
  validateSessionId(input.sessionId);
  requireText(input.id, "id");
  requireText(input.url, "url");
  let parsedUrl;
  try {
    parsedUrl = new URL(input.url);
  } catch {
    throw new WorkflowError({
      code: ERROR_CODES.INVALID_INPUT,
      message: "The pull-request URL must be an absolute HTTP(S) URL.",
      details: { argument: "--url" }
    });
  }
  if (parsedUrl.protocol !== "https:" && parsedUrl.protocol !== "http:") {
    throw new WorkflowError({
      code: ERROR_CODES.INVALID_INPUT,
      message: "The pull-request URL must be an absolute HTTP(S) URL.",
      details: { argument: "--url" }
    });
  }
  const observed = await readGitContext(projectRoot);
  return runStateTransaction(projectRoot, (rawState) => {
    const state = requireWorkState(rawState, "work record pull-request");
    requireActiveOwner(state, input.sessionId, "work record pull-request");
    if (state.current.work.branch !== observed.branch || state.current.work.head_commit !== observed.head || observed.projectDirty) {
      throw new WorkflowError({
        code: ERROR_CODES.ARTIFACT_FAILURE,
        message: "Pull-request identity requires the clean recorded Git revision.",
        details: { branch: observed.branch, head: observed.head }
      });
    }
    const recorded = state.current.work.pull_request;
    if (recorded !== null && (recorded.id !== input.id || recorded.url !== input.url)) {
      throw new WorkflowError({
        code: ERROR_CODES.ARTIFACT_FAILURE,
        message: "The pull-request identity does not match recorded ntwork state.",
        details: { recorded_id: recorded.id, supplied_id: input.id }
      });
    }
    return {
      next_work_number: state.next_work_number,
      current: {
        ...state.current,
        work: {
          ...state.current.work,
          pull_request: recorded ?? { id: input.id, url: input.url }
        }
      }
    };
  });
}

// src/cli/arguments.ts
function invalidArguments(message, details) {
  throw new WorkflowError({
    code: ERROR_CODES.INVALID_INPUT,
    message,
    details
  });
}
function requireSessionId(argv) {
  if (argv[5] !== "--session-id" || argv[6] === void 0 || argv[6].length === 0) {
    invalidArguments("Expected --session-id <provider:id>.", {
      argument: argv[5] ?? ""
    });
  }
  return argv[6];
}
function parseInterruption(value) {
  if (!isInterruptionAuthority(value)) {
    invalidArguments("Invalid --interruption authority.", {
      value: value ?? ""
    });
  }
  return value;
}
function parseRunArguments(cwd, argv) {
  const operation = argv[3];
  if (operation !== "start" && operation !== "cancel" && operation !== "complete") {
    invalidArguments("Unknown run operation.", { operation: operation ?? "" });
  }
  if (argv[4] !== "--session-id" || argv[5] === void 0 || argv[5].length === 0) {
    invalidArguments("Expected --session-id <provider:id>.", {
      argument: argv[4] ?? ""
    });
  }
  const needsConfirmation = operation !== "start";
  const expectedLength = needsConfirmation ? 7 : 6;
  if (needsConfirmation && argv[6] !== "--user-confirmed") {
    invalidArguments(`${operation} requires --user-confirmed.`, {
      argument: argv[6] ?? ""
    });
  }
  if (argv.length !== expectedLength) {
    invalidArguments("Unexpected run command argument.", {
      argument: argv[expectedLength] ?? ""
    });
  }
  return Object.freeze({
    cwd,
    command: "run",
    operation,
    sessionId: argv[5],
    userConfirmed: needsConfirmation
  });
}
function phaseBase(cwd, sessionId, phase) {
  return { cwd, command: "phase", phase, sessionId };
}
function parsePhaseBegin(cwd, sessionId, options, phase) {
  if (phase === "ntplan" && options.some((option) => option === "--researcher-available" || option === "--critic-available")) {
    const roleFlags = options.filter((option) => option === "--researcher-available" || option === "--critic-available");
    if (new Set(roleFlags).size !== roleFlags.length) invalidArguments("Duplicate native role flag.", { argument: roleFlags[0] ?? "" });
    return Object.freeze({
      ...parsePhaseBegin(cwd, sessionId, options.filter((option) => !roleFlags.includes(option)), phase),
      researcherAvailable: roleFlags.includes("--researcher-available"),
      criticAvailable: roleFlags.includes("--critic-available")
    });
  }
  if (phase === "ntwork" && options.some((option) => option.endsWith("-available"))) {
    const allowed = new Set(NTWORK_ROLES.map((role) => `--${role}-available`));
    const roleFlags = options.filter((option) => option.endsWith("-available"));
    const unknown = roleFlags.find((flag) => !allowed.has(flag));
    if (unknown !== void 0) invalidArguments("Unknown native ntwork role flag.", { argument: unknown });
    if (new Set(roleFlags).size !== roleFlags.length) invalidArguments("Duplicate native role flag.", { argument: roleFlags[0] ?? "" });
    const parsed = parsePhaseBegin(cwd, sessionId, options.filter((option) => !roleFlags.includes(option)), phase);
    return Object.freeze({
      ...parsed,
      availableWorkRoles: new Set(roleFlags.map((flag) => flag.slice(2, -10)))
    });
  }
  if (phase === "ntwork" && options.includes("--existing-changes-confirmed")) {
    if (options.filter((option) => option === "--existing-changes-confirmed").length !== 1) {
      invalidArguments("Duplicate existing-changes confirmation.", { argument: "--existing-changes-confirmed" });
    }
    return Object.freeze({
      ...parsePhaseBegin(cwd, sessionId, options.filter((option) => option !== "--existing-changes-confirmed"), phase),
      existingChangesConfirmed: true
    });
  }
  if (phase === "ntwork" && options.includes("--base-branch")) {
    const index = options.indexOf("--base-branch");
    const value = options[index + 1];
    if (options.filter((option) => option === "--base-branch").length !== 1 || value === void 0 || value.trim().length === 0) invalidArguments("Expected one --base-branch <branch>.", { argument: value ?? "" });
    return Object.freeze({
      ...parsePhaseBegin(cwd, sessionId, [
        ...options.slice(0, index),
        ...options.slice(index + 2)
      ], phase),
      baseBranch: value
    });
  }
  if (options.length === 0) {
    return Object.freeze({
      ...phaseBase(cwd, sessionId, phase),
      operation: "begin",
      blockerResolved: false
    });
  }
  if (options.length === 1 && options[0] === "--blocker-resolved") {
    return Object.freeze({
      ...phaseBase(cwd, sessionId, phase),
      operation: "begin",
      blockerResolved: true
    });
  }
  if ((options.length === 2 || options.length === 3) && options[0] === "--interruption" && (options.length === 2 || options[2] === "--blocker-resolved")) {
    return Object.freeze({
      ...phaseBase(cwd, sessionId, phase),
      operation: "begin",
      interruption: parseInterruption(options[1]),
      blockerResolved: options.length === 3
    });
  }
  invalidArguments("Unexpected phase begin argument.", {
    argument: options[0] ?? ""
  });
}
function parsePhaseStop(cwd, sessionId, options, phase) {
  const blocker = options[1];
  if (options[0] !== "--blocker" || blocker === void 0 || blocker.trim().length === 0) {
    invalidArguments("Expected --blocker <non-empty-text>.", {
      argument: options[0] ?? ""
    });
  }
  if (options.length === 2) {
    return Object.freeze({
      ...phaseBase(cwd, sessionId, phase),
      operation: "stop",
      blocker
    });
  }
  if (options.length === 4 && options[2] === "--interruption") {
    return Object.freeze({
      ...phaseBase(cwd, sessionId, phase),
      operation: "stop",
      blocker,
      interruption: parseInterruption(options[3])
    });
  }
  invalidArguments("Unexpected phase stop argument.", {
    argument: options[2] ?? ""
  });
}
function parsePhaseArguments(cwd, argv) {
  const operation = argv[3];
  if (operation !== "begin" && operation !== "complete" && operation !== "stop") {
    invalidArguments("Unknown phase operation.", { operation: operation ?? "" });
  }
  if (argv[4] !== "nttask" && argv[4] !== "ntgrill" && argv[4] !== "ntplan" && argv[4] !== "ntwork") {
    invalidArguments("Unknown phase.", { phase: argv[4] ?? "" });
  }
  const phase = argv[4];
  const sessionId = requireSessionId(argv);
  const options = argv.slice(7);
  if (operation === "begin") return parsePhaseBegin(cwd, sessionId, options, phase);
  if (operation === "stop") return parsePhaseStop(cwd, sessionId, options, phase);
  if (phase === "ntplan") {
    if (options.length !== 2 || options[0] !== "--critic-pass" || options[1] !== "--user-confirmed") {
      invalidArguments("ntplan completion requires --critic-pass --user-confirmed.", { argument: options[0] ?? "" });
    }
    return Object.freeze({ ...phaseBase(cwd, sessionId, phase), operation: "complete", criticPassed: true, userConfirmed: true });
  }
  if (phase === "ntgrill") {
    if (options.length !== 1 || options[0] !== "--user-confirmed") {
      invalidArguments("ntgrill completion requires --user-confirmed.", { argument: options[0] ?? "" });
    }
    return Object.freeze({ ...phaseBase(cwd, sessionId, phase), operation: "complete", userConfirmed: true });
  }
  if (options.length !== 0) {
    invalidArguments("The phase complete command accepts no extra arguments.", {
      argument: options[0] ?? ""
    });
  }
  return Object.freeze({
    ...phaseBase(cwd, sessionId, phase),
    operation: "complete"
  });
}
function operationForArguments(argv) {
  if (argv[0] !== "--cwd" || argv[1] === void 0 || argv[1].length === 0) {
    return "unknown";
  }
  if (argv[2] === "run" && (argv[3] === "start" || argv[3] === "cancel" || argv[3] === "complete")) {
    return `run ${argv[3]}`;
  }
  if (argv[2] === "phase" && (argv[3] === "begin" || argv[3] === "complete" || argv[3] === "stop") && (argv[4] === "nttask" || argv[4] === "ntgrill" || argv[4] === "ntplan" || argv[4] === "ntwork")) {
    return `phase ${argv[3]} ${argv[4]}`;
  }
  if (argv[2] === "plan" && (argv[3] === "validate" || argv[3] === "amend")) return `plan ${argv[3]}`;
  if (argv[2] === "task" && argv[3] === "begin") return "task begin";
  if (argv[2] === "task" && argv[3] === "complete") return "task complete";
  if (argv[2] === "work" && argv[3] === "record" && argv[4]) return `work record ${argv[4]}`;
  return argv[2] ?? "unknown";
}
function parseArguments(argv) {
  if (argv[0] !== "--cwd" || argv[1] === void 0 || argv[1].length === 0) {
    invalidArguments("Expected --cwd <path> before the command.", {
      argument: argv[0] ?? ""
    });
  }
  const command = argv[2];
  if (command === "status") {
    if (argv.length !== 3) {
      invalidArguments("The status command accepts no arguments.", {
        argument: argv[3] ?? ""
      });
    }
    return Object.freeze({ cwd: argv[1], command });
  }
  if (command === "run") return parseRunArguments(argv[1], argv);
  if (command === "phase") return parsePhaseArguments(argv[1], argv);
  if (command === "task") {
    if (argv[3] !== "begin" && argv[3] !== "complete" || !argv[4] || argv[5] !== "--session-id" || !argv[6]) {
      invalidArguments("Expected task begin|complete <task-id> --session-id <provider:id>.", {
        argument: argv[3] ?? ""
      });
    }
    if (argv[3] === "complete") {
      if (argv.length !== 9 || argv[7] !== "--commit-id" || !argv[8]) {
        invalidArguments("task complete requires --commit-id <git-commit>.", {
          argument: argv[7] ?? ""
        });
      }
      return Object.freeze({
        cwd: argv[1],
        command,
        operation: "complete",
        taskId: argv[4],
        sessionId: argv[6],
        commitId: argv[8]
      });
    }
    if (argv.length !== 7 && !(argv.length === 8 && argv[7] === "--existing-changes-confirmed")) {
      invalidArguments("Unexpected task begin argument.", { argument: argv[7] ?? "" });
    }
    return Object.freeze({
      cwd: argv[1],
      command,
      operation: "begin",
      taskId: argv[4],
      sessionId: argv[6],
      existingChangesConfirmed: argv[7] === "--existing-changes-confirmed"
    });
  }
  if (command === "work") {
    if (argv[3] !== "record") {
      invalidArguments("Expected work record operation.", { argument: argv[3] ?? "" });
    }
    if (argv[4] === "evidence") {
      if (argv.length !== 17 || argv[5] !== "--session-id" || !argv[6] || argv[7] !== "--gate" || !argv[8] || argv[9] !== "--procedure" || !argv[10] || argv[11] !== "--result" || !argv[12] || argv[13] !== "--expected" || !argv[14] || argv[15] !== "--source-id" || !argv[16]) invalidArguments("Invalid work evidence arguments.", { argument: argv[5] ?? "" });
      return Object.freeze({
        cwd: argv[1],
        command,
        operation: "record",
        record: "evidence",
        sessionId: argv[6],
        gate: argv[8],
        procedure: argv[10],
        result: argv[12],
        expected: argv[14],
        sourceIds: argv[16].split(",").map((id) => id.trim())
      });
    }
    if (argv[4] === "task-review") {
      if (argv.length !== 14 || !argv[5] || argv[6] !== "--session-id" || !argv[7] || argv[8] !== "--packet" || argv[9] !== "pass" && argv[9] !== "block" || argv[10] !== "--quality" || argv[11] !== "pass" && argv[11] !== "block" || argv[12] !== "--source-id" || !argv[13]) invalidArguments("Invalid work task-review arguments.", { argument: argv[5] ?? "" });
      return Object.freeze({
        cwd: argv[1],
        command,
        operation: "record",
        record: "task-review",
        taskId: argv[5],
        sessionId: argv[7],
        packet: argv[9],
        quality: argv[11],
        sourceIds: argv[13].split(",").map((id) => id.trim())
      });
    }
    if (argv[4] === "gate") {
      const gate = argv[5];
      const verdict = argv[9];
      if (argv.length !== 18 || !["whole-plan", "nyquist", "spec-integration", "code-review", "ci"].includes(gate ?? "") || argv[6] !== "--session-id" || !argv[7] || argv[8] !== "--verdict" || !["pass", "fail", "block", "not-required"].includes(verdict ?? "") || argv[10] !== "--procedure" || !argv[11] || argv[12] !== "--result" || !argv[13] || argv[14] !== "--expected" || !argv[15] || argv[16] !== "--source-id" || !argv[17]) invalidArguments("Invalid work gate arguments.", { argument: argv[5] ?? "" });
      return Object.freeze({
        cwd: argv[1],
        command,
        operation: "record",
        record: "gate",
        gate,
        sessionId: argv[7],
        verdict,
        procedure: argv[11],
        result: argv[13],
        expected: argv[15],
        sourceIds: argv[17].split(",").map((id) => id.trim())
      });
    }
    if (argv[4] === "fix-commit") {
      if (argv.length !== 19 || argv[5] !== "--session-id" || !argv[6] || argv[7] !== "--scope" || !argv[8] || argv[9] !== "--commit-id" || !argv[10] || argv[11] !== "--procedure" || !argv[12] || argv[13] !== "--result" || !argv[14] || argv[15] !== "--expected" || !argv[16] || argv[17] !== "--source-id" || !argv[18]) invalidArguments("Invalid work fix-commit arguments.", { argument: argv[5] ?? "" });
      return Object.freeze({
        cwd: argv[1],
        command,
        operation: "record",
        record: "fix-commit",
        sessionId: argv[6],
        scope: argv[8],
        commitId: argv[10],
        procedure: argv[12],
        result: argv[14],
        expected: argv[16],
        sourceIds: argv[18].split(",").map((id) => id.trim())
      });
    }
    if (argv[4] === "pull-request") {
      if (argv.length !== 11 || argv[5] !== "--session-id" || !argv[6] || argv[7] !== "--id" || !argv[8] || argv[9] !== "--url" || !argv[10]) invalidArguments("Invalid work pull-request arguments.", { argument: argv[5] ?? "" });
      return Object.freeze({
        cwd: argv[1],
        command,
        operation: "record",
        record: "pull-request",
        sessionId: argv[6],
        id: argv[8],
        url: argv[10]
      });
    }
    invalidArguments("Unknown work record operation.", { operation: argv[4] ?? "" });
  }
  if (command === "plan") {
    if (argv[3] === "validate" && argv.length === 6 && argv[4] === "--session-id" && argv[5]) {
      return Object.freeze({ cwd: argv[1], command, operation: "validate", sessionId: argv[5] });
    }
    if (argv[3] === "validate" && argv.length === 7 && argv[4] === "--session-id" && argv[5] && argv[6] === "--amendment-recovery") {
      return Object.freeze({
        cwd: argv[1],
        command,
        operation: "validate",
        sessionId: argv[5],
        amendmentRecovery: true
      });
    }
    if (argv[3] === "validate" && (argv.length === 8 || argv.length === 9) && argv[4] === "--session-id" && argv[5] && argv[6] === "--critic-pass" && argv[7] === "--user-confirmed" && (argv.length === 8 || argv[8] === "--amendment-recovery")) {
      return Object.freeze({
        cwd: argv[1],
        command,
        operation: "validate",
        sessionId: argv[5],
        criticPassed: true,
        userConfirmed: true,
        ...argv[8] === "--amendment-recovery" ? { amendmentRecovery: true } : {}
      });
    }
    invalidArguments("Expected plan validate, optionally with critic PASS and user confirmation.", { argument: argv[3] ?? "" });
  }
  invalidArguments("Unknown command.", { command: command ?? "" });
}

// src/core/protocol.ts
function createSuccessResponse(context) {
  return {
    ok: true,
    operation: context.operation,
    project_root: context.projectRoot,
    state: context.state,
    next_action: context.nextAction,
    warnings: context.warnings
  };
}
function createFailureResponse(context) {
  const error = normalizeCaughtError(context.error);
  return {
    ok: false,
    operation: context.operation,
    project_root: context.projectRoot,
    state: context.state,
    next_action: context.nextAction,
    warnings: context.warnings,
    error: {
      code: error.code,
      exit_code: error.exitCode,
      message: error.message,
      details: error.details
    }
  };
}
function serializeResponse(response) {
  return JSON.stringify(response) + "\n";
}

// src/runtime/ntgrill.ts
async function completeNtgrillPhase(projectRoot, input, options = {}) {
  validateSessionId(input.sessionId);
  if (input.userConfirmed !== true) {
    throw new WorkflowError({
      code: ERROR_CODES.INVALID_INPUT,
      message: "ntgrill completion requires explicit user confirmation of shared understanding.",
      details: { argument: "--user-confirmed" }
    });
  }
  let runId;
  return runStateTransaction(projectRoot, (state) => {
    requireActivePhase(state, "phase complete ntgrill", "ntgrill");
    requireOwner(state, input.sessionId);
    runId = state.current.run_id;
    return {
      next_work_number: state.next_work_number,
      current: {
        run_id: runId,
        lifecycle: "plan-ready",
        phase: null,
        owner: null,
        blocker: null,
        work: null
      }
    };
  }, {
    ...options,
    prepareCommit: () => validateBrief(projectRoot, runId, "ntgrill")
  });
}

// src/runtime/nttask.ts
async function completeNttaskPhase(projectRoot, input) {
  validateSessionId(input.sessionId);
  let runId;
  return runStateTransaction(projectRoot, (state) => {
    requireActivePhase(state, "phase complete nttask", "nttask");
    requireOwner(state, input.sessionId);
    runId = state.current.run_id;
    return {
      next_work_number: state.next_work_number,
      current: {
        run_id: runId,
        lifecycle: "brief-ready",
        phase: null,
        owner: null,
        blocker: null,
        work: null
      }
    };
  }, {
    prepareCommit: () => validateNttaskBrief(projectRoot, runId)
  });
}

// src/runtime/ntplan.ts
async function validatePlan(projectRoot, sessionId, amendmentRecovery = false) {
  validateSessionId(sessionId);
  const { state } = await readPreflight(projectRoot);
  let runId;
  if (state?.current?.lifecycle === "plan-approved") {
    runId = state.current.run_id;
  } else if (state?.current?.lifecycle === "work-active" && state.current.phase === "ntwork" && state.current.owner?.session_id === sessionId) {
    runId = state.current.run_id;
  } else if (amendmentRecovery && state?.current?.lifecycle === "work-active" && state.current.phase === null && state.current.owner === null && state.current.work !== null && state.current.blocker !== null) {
    runId = state.current.run_id;
  } else {
    requireActivePhase(state, "plan validate", "ntplan");
    requireOwner(state, sessionId);
    runId = state.current.run_id;
  }
  await validateBrief(projectRoot, runId, "ntgrill");
  await validatePlanArtifacts(projectRoot, runId);
  return { state, warnings: [] };
}
async function amendWorkPlan(projectRoot, input) {
  validateSessionId(input.sessionId);
  if (!input.criticPassed || !input.userConfirmed) {
    throw new WorkflowError({
      code: ERROR_CODES.INVALID_INPUT,
      message: "A work amendment requires current critic PASS and explicit user reapproval.",
      details: { arguments: ["--critic-pass", "--user-confirmed"] }
    });
  }
  const observed = await readGitContext(projectRoot);
  return runStateTransaction(projectRoot, async (state) => {
    if (state?.current?.lifecycle !== "work-active") {
      throw new WorkflowError({
        code: ERROR_CODES.ILLEGAL_TRANSITION,
        message: "Approved amendment validation is legal only for active ntwork.",
        details: { actual_lifecycle: state?.current?.lifecycle ?? null }
      });
    }
    const current = state.current;
    if (current.work === null) {
      throw new WorkflowError({
        code: ERROR_CODES.ILLEGAL_TRANSITION,
        message: "Approved amendment validation requires ntwork state.",
        details: { actual_lifecycle: current.lifecycle }
      });
    }
    const work = current.work;
    const ownedActive = current.phase === "ntwork" && current.owner !== null;
    const stoppedRecovery = input.amendmentRecovery && current.phase === null && current.owner === null && current.blocker !== null;
    if (!ownedActive && !stoppedRecovery) {
      throw new WorkflowError({
        code: ERROR_CODES.ILLEGAL_TRANSITION,
        message: "Approved amendment validation is legal only for owned active ntwork.",
        details: { actual_lifecycle: current.lifecycle }
      });
    }
    if (ownedActive && current.owner?.session_id !== input.sessionId) {
      throw new WorkflowError({
        code: ERROR_CODES.OWNERSHIP_CONFLICT,
        message: "An ntwork owner is already recorded.",
        details: {
          recorded_owner: current.owner?.session_id ?? null,
          requested_owner: input.sessionId
        }
      });
    }
    const provider = providerForSessionId(input.sessionId);
    if (stoppedRecovery && work.provider !== provider) {
      throw new WorkflowError({
        code: ERROR_CODES.OWNERSHIP_CONFLICT,
        message: "An interrupted ntwork amendment must restart under the recorded provider.",
        details: { recorded_provider: work.provider, requested_provider: provider }
      });
    }
    if (work.branch !== observed.branch || work.head_commit !== observed.head) {
      throw new WorkflowError({
        code: ERROR_CODES.ARTIFACT_FAILURE,
        message: "Amendment validation requires the recorded ntwork Git boundary.",
        details: {
          recorded_branch: work.branch,
          actual_branch: observed.branch,
          recorded_head: work.head_commit,
          actual_head: observed.head
        }
      });
    }
    await validateBrief(projectRoot, current.run_id, "ntgrill");
    const taskIds = await validatePlanArtifacts(projectRoot, current.run_id);
    const completed = work.tasks.filter((task) => task.status === "completed");
    if (!completed.every((task, index) => task.task_id === taskIds[index])) {
      throw new WorkflowError({
        code: ERROR_CODES.ARTIFACT_FAILURE,
        message: "A reapproved work amendment must preserve the completed task prefix.",
        details: { completed_tasks: completed.map((task) => task.task_id) }
      });
    }
    const completedIds = new Set(completed.map((task) => task.task_id));
    return {
      next_work_number: state.next_work_number,
      current: {
        ...current,
        phase: "ntwork",
        owner: { session_id: input.sessionId },
        blocker: null,
        work: {
          ...work,
          provider: work.provider,
          tasks: taskIds.map((taskId) => {
            const historical = completed.find((task) => task.task_id === taskId);
            return historical ?? {
              task_id: taskId,
              status: "pending",
              start_commit: null,
              commit_id: null,
              packet_review: "pending",
              quality_review: "pending"
            };
          }),
          evidence: work.evidence.filter((item) => (!item.gate.startsWith("task:") || completedIds.has(item.gate.slice(5))) && (!item.gate.startsWith("task-review:") || completedIds.has(item.gate.slice(12))) && !["whole-plan", "nyquist", "spec-integration", "code-review", "ci"].includes(item.gate)),
          verdicts: {
            whole_plan: "pending",
            nyquist: "pending",
            spec_integration: "pending",
            code_review: "pending",
            ci: "pending"
          }
        }
      }
    };
  });
}
async function completeNtplanPhase(projectRoot, input, options = {}) {
  validateSessionId(input.sessionId);
  if (input.criticPassed !== true || input.userConfirmed !== true) throw new WorkflowError({
    code: ERROR_CODES.INVALID_INPUT,
    message: "ntplan completion requires current independent critic PASS and explicit user approval.",
    details: { arguments: ["--critic-pass", "--user-confirmed"] }
  });
  return runStateTransaction(projectRoot, async (state) => {
    requireActivePhase(state, "phase complete ntplan", "ntplan");
    requireOwner(state, input.sessionId);
    const runId = state.current.run_id;
    await validateBrief(projectRoot, runId, "ntgrill");
    const taskIds = await validatePlanArtifacts(projectRoot, runId);
    return {
      next_work_number: state.next_work_number,
      current: {
        run_id: runId,
        lifecycle: "plan-approved",
        phase: null,
        owner: null,
        blocker: null,
        work: {
          tasks: taskIds.map((task_id) => ({
            task_id,
            status: "pending",
            start_commit: null,
            commit_id: null,
            packet_review: "pending",
            quality_review: "pending"
          })),
          provider: null,
          branch: null,
          base_branch: null,
          pull_request: null,
          head_commit: null,
          fix_commits: [],
          evidence: [],
          verdicts: { whole_plan: "pending", nyquist: "pending", spec_integration: "pending", code_review: "pending", ci: "pending" }
        }
      }
    };
  }, options);
}

// src/runtime/run.ts
import { lstat as lstat6, mkdir } from "node:fs/promises";
import { join as join6 } from "node:path";
var CANCELABLE_LIFECYCLES = /* @__PURE__ */ new Set([
  "intake-active",
  "brief-ready",
  "plan-ready",
  "plan-approved",
  "work-active"
]);
function validateSessionId2(sessionId) {
  if (providerForSessionId(sessionId) === null) {
    throw new WorkflowError({
      code: ERROR_CODES.INVALID_INPUT,
      message: "A canonical provider session ID is required.",
      details: {
        argument: "--session-id",
        expected: SESSION_ID_FORMAT
      }
    });
  }
}
function requireUserConfirmation(userConfirmed, operation) {
  if (!userConfirmed) {
    throw new WorkflowError({
      code: ERROR_CODES.INVALID_INPUT,
      message: `${operation} requires explicit user authority.`,
      details: { argument: "--user-confirmed" }
    });
  }
}
function illegalTransition2(operation, state, allowed) {
  throw new WorkflowError({
    code: ERROR_CODES.ILLEGAL_TRANSITION,
    message: `${operation} is not legal from the current lifecycle.`,
    details: {
      actual: state?.current?.lifecycle ?? null,
      allowed
    }
  });
}
function commitFailure2(stage, path) {
  return new WorkflowError({
    code: ERROR_CODES.COMMIT_FAILURE,
    message: "The run directory could not be prepared.",
    details: { stage, path }
  });
}
async function ensureDirectory(path, stage) {
  try {
    await mkdir(path);
    return;
  } catch (error) {
    if (!hasErrorCode(error, "EEXIST")) throw commitFailure2(stage, path);
  }
  try {
    if ((await lstat6(path)).isDirectory()) return;
  } catch {
  }
  throw commitFailure2(stage, path);
}
async function requireGitProject(projectRoot) {
  if (await isGitProjectRoot(projectRoot)) return;
  throw new WorkflowError({
    code: ERROR_CODES.INVALID_INPUT,
    message: "Run start requires a Git repository.",
    details: { project_root: projectRoot }
  });
}
async function ensureWorkflowDirectory(projectRoot) {
  await ensureDirectory(join6(projectRoot, ".ntworkflow"), "workflow-directory");
}
async function prepareRunDirectory(projectRoot, runId) {
  const runsPath = join6(projectRoot, ".ntworkflow", "runs");
  await ensureDirectory(runsPath, "runs-directory");
  const runPath = join6(runsPath, runId);
  try {
    await mkdir(runPath);
  } catch (error) {
    if (hasErrorCode(error, "EEXIST")) {
      throw new WorkflowError({
        code: ERROR_CODES.PARTIAL_RUN,
        message: "The target run path already exists.",
        details: { path: runPath }
      });
    }
    throw commitFailure2("run-directory", runPath);
  }
}
function formatRunId(number) {
  return `NT-${String(number).padStart(3, "0")}`;
}
function newCurrent(runId) {
  return {
    run_id: runId,
    lifecycle: "intake-active",
    phase: null,
    owner: null,
    blocker: null,
    work: null
  };
}
async function startRun(projectRoot, input, transactionOptions = {}) {
  validateSessionId2(input.sessionId);
  await requireGitProject(projectRoot);
  await ensureWorkflowDirectory(projectRoot);
  return runStateTransaction(
    projectRoot,
    (state) => {
      if (state !== null && state.current !== null && state.current.lifecycle !== "delivery-ready") {
        illegalTransition2("run start", state, ["no active run", "delivery-ready"]);
      }
      const nextWorkNumber = state?.next_work_number ?? 1;
      return {
        next_work_number: nextWorkNumber + 1,
        current: newCurrent(formatRunId(nextWorkNumber))
      };
    },
    {
      ...transactionOptions,
      prepareCommit: async (_current, next) => {
        const current = next.current;
        await prepareRunDirectory(projectRoot, current.run_id);
      }
    }
  );
}
async function requireWorkflowDirectory(projectRoot, operation, allowed) {
  const workflowPath = join6(projectRoot, ".ntworkflow");
  try {
    if ((await lstat6(workflowPath)).isDirectory()) return;
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) {
      illegalTransition2(operation, null, allowed);
    }
  }
  throw commitFailure2("workflow-directory", workflowPath);
}
async function cancelRun(projectRoot, input, transactionOptions = {}) {
  validateSessionId2(input.sessionId);
  requireUserConfirmation(input.userConfirmed, "run cancel");
  const allowed = [...CANCELABLE_LIFECYCLES];
  await requireWorkflowDirectory(projectRoot, "run cancel", allowed);
  return runStateTransaction(
    projectRoot,
    (state) => {
      if (state === null || state.current === null || !CANCELABLE_LIFECYCLES.has(state.current.lifecycle)) {
        illegalTransition2("run cancel", state, allowed);
      }
      return {
        next_work_number: state.next_work_number,
        current: null
      };
    },
    transactionOptions
  );
}
async function completeRun(projectRoot, input, transactionOptions = {}) {
  validateSessionId2(input.sessionId);
  requireUserConfirmation(input.userConfirmed, "run complete");
  const allowed = ["delivery-ready"];
  await requireWorkflowDirectory(projectRoot, "run complete", allowed);
  return runStateTransaction(
    projectRoot,
    (state) => {
      if (state?.current?.lifecycle !== "delivery-ready") {
        illegalTransition2("run complete", state, allowed);
      }
      return {
        next_work_number: state.next_work_number,
        current: null
      };
    },
    transactionOptions
  );
}

// src/cli/main.ts
function action(skill, instruction) {
  return Object.freeze({ skill, instruction });
}
var INVALID_INPUT_ACTION = action(null, "Correct the CLI input and retry.");
var STATUS_FAILURE_ACTION = action(
  null,
  "Correct the reported failure and retry status."
);
var INTERNAL_FAILURE_ACTION = action(
  null,
  "Inspect the internal failure and retry."
);
var RUN_FAILURE_ACTION = action(
  null,
  "Resolve the reported run failure before retrying."
);
function phaseFailureAction(phase) {
  return action(phase, `Resolve the reported phase failure before retrying ${phase}.`);
}
function blockerAction(phase) {
  return action(phase, `Resolve the recorded blocker, then retry phase begin ${phase} with --blocker-resolved.`);
}
function ownerAction(phase, completing) {
  return action(phase, completing ? `Continue in the recorded owner session, or replace it with phase begin ${phase} --interruption <provider-ended|user-confirmed>.` : "Continue in the recorded owner session, or retry with explicit --interruption authority.");
}
var NO_GIT_ACTION = action(
  null,
  "Initialize Git in this project or run status in an existing Git repository."
);
var DURABLE_INTAKE_ACTION = action(
  "nttask",
  "Begin nttask from the durable intake boundary."
);
function nextActionFor(state, canStartRun = true) {
  if (state === null || state.current === null) {
    if (!canStartRun) return NO_GIT_ACTION;
    return action("nttask", "Start nttask with a non-empty task.");
  }
  switch (state.current.lifecycle) {
    case "intake-active":
      if (state.current.blocker !== null) return blockerAction("nttask");
      if (state.current.phase === "nttask") return action("nttask", "Continue the active nttask phase.");
      return DURABLE_INTAKE_ACTION;
    case "brief-ready":
      if (state.current.blocker !== null) return blockerAction("ntgrill");
      if (state.current.phase === "ntgrill") return action("ntgrill", "Continue the active ntgrill phase.");
      return action("ntgrill", "Continue with ntgrill.");
    case "plan-ready":
      if (state.current.blocker !== null) return blockerAction("ntplan");
      if (state.current.phase === "ntplan") return action("ntplan", "Continue the active ntplan phase.");
      return action("ntplan", "Continue with ntplan.");
    case "plan-approved":
    case "work-active":
      return action("ntwork", "Continue with ntwork.");
    case "delivery-ready":
      return action(
        "nttask",
        "Use run complete to close this run, or start nttask to close it and begin a new run."
      );
  }
}
function suppliedCwd(argv) {
  const cwd = argv[1];
  return argv[0] === "--cwd" && cwd !== void 0 && cwd.length > 0 ? cwd : null;
}
async function resolvedRootOrEmpty(cwd) {
  try {
    return await resolveProjectRoot(cwd);
  } catch {
    return "";
  }
}
async function contextForInvalidArguments(argv) {
  const cwd = suppliedCwd(argv);
  if (cwd === null) return { projectRoot: "", state: null };
  try {
    return await readPreflight(cwd);
  } catch {
    return { projectRoot: await resolvedRootOrEmpty(cwd), state: null };
  }
}
async function executeStatus(parsed) {
  const preflight = await readPreflight(parsed.cwd);
  return { ...preflight, warnings: [] };
}
async function executeRun(parsed) {
  const projectRoot = await resolveProjectRoot(parsed.cwd);
  const input = { sessionId: parsed.sessionId };
  const result = parsed.operation === "start" ? await startRun(projectRoot, input) : parsed.operation === "cancel" ? await cancelRun(projectRoot, {
    ...input,
    userConfirmed: parsed.userConfirmed
  }) : await completeRun(projectRoot, {
    ...input,
    userConfirmed: parsed.userConfirmed
  });
  return { projectRoot, ...result };
}
async function executePhase(parsed) {
  const projectRoot = await resolveProjectRoot(parsed.cwd);
  if (parsed.operation === "complete") {
    if (parsed.phase === "ntwork") {
      return {
        projectRoot,
        ...await completeNtworkPhase(projectRoot, { sessionId: parsed.sessionId })
      };
    }
    const result2 = parsed.phase === "ntplan" ? await completeNtplanPhase(projectRoot, { sessionId: parsed.sessionId, criticPassed: parsed.criticPassed === true, userConfirmed: parsed.userConfirmed === true }) : parsed.phase === "ntgrill" ? await completeNtgrillPhase(projectRoot, { sessionId: parsed.sessionId, userConfirmed: parsed.userConfirmed === true }) : await completeNttaskPhase(projectRoot, { sessionId: parsed.sessionId });
    return { projectRoot, ...result2 };
  }
  const interruption = parsed.interruption === void 0 ? {} : { interruption: parsed.interruption };
  if (parsed.operation === "begin") {
    const result2 = parsed.phase === "ntwork" ? await beginNtworkPhase(projectRoot, {
      sessionId: parsed.sessionId,
      blockerResolved: parsed.blockerResolved,
      availableRoles: parsed.availableWorkRoles ?? /* @__PURE__ */ new Set(),
      existingChangesConfirmed: parsed.existingChangesConfirmed === true,
      ...parsed.baseBranch === void 0 ? {} : { baseBranch: parsed.baseBranch },
      ...interruption
    }) : await beginPhase(projectRoot, parsed.phase, {
      sessionId: parsed.sessionId,
      blockerResolved: parsed.blockerResolved,
      ...parsed.phase === "ntplan" ? {
        researcherAvailable: parsed.researcherAvailable === true,
        criticAvailable: parsed.criticAvailable === true
      } : {},
      ...interruption
    });
    return { projectRoot, ...result2 };
  }
  const stopInput = {
    sessionId: parsed.sessionId,
    blocker: parsed.blocker,
    ...interruption
  };
  const result = parsed.phase === "ntwork" ? await stopNtworkPhase(projectRoot, stopInput) : await stopPhase(projectRoot, parsed.phase, stopInput);
  return { projectRoot, ...result };
}
async function executeTask(parsed) {
  const projectRoot = await resolveProjectRoot(parsed.cwd);
  const operation = parsed.operation === "begin" ? beginWorkTask(projectRoot, {
    sessionId: parsed.sessionId,
    taskId: parsed.taskId,
    existingChangesConfirmed: parsed.existingChangesConfirmed
  }) : completeWorkTask(projectRoot, {
    sessionId: parsed.sessionId,
    taskId: parsed.taskId,
    commitId: parsed.commitId
  });
  return {
    projectRoot,
    ...await operation
  };
}
async function executeWork(parsed) {
  const projectRoot = await resolveProjectRoot(parsed.cwd);
  const result = parsed.record === "evidence" ? await recordTaskEvidence(projectRoot, parsed) : parsed.record === "task-review" ? await recordTaskReview(projectRoot, parsed) : parsed.record === "gate" ? await recordFinalGate(projectRoot, parsed) : parsed.record === "fix-commit" ? await recordFixCommit(projectRoot, parsed) : await recordPullRequest(projectRoot, parsed);
  return { projectRoot, ...result };
}
async function executeCommand(parsed) {
  if (parsed.command === "status") return executeStatus(parsed);
  if (parsed.command === "run") return executeRun(parsed);
  if (parsed.command === "plan") {
    const projectRoot = await resolveProjectRoot(parsed.cwd);
    return {
      projectRoot,
      ...await (parsed.criticPassed === true && parsed.userConfirmed === true ? amendWorkPlan(projectRoot, {
        sessionId: parsed.sessionId,
        criticPassed: true,
        userConfirmed: true,
        amendmentRecovery: parsed.amendmentRecovery === true
      }) : validatePlan(projectRoot, parsed.sessionId, parsed.amendmentRecovery === true))
    };
  }
  if (parsed.command === "task") return executeTask(parsed);
  if (parsed.command === "work") return executeWork(parsed);
  return executePhase(parsed);
}
function operationForCommand(parsed) {
  if (parsed.command === "status") return "status";
  if (parsed.command === "run") return `run ${parsed.operation}`;
  if (parsed.command === "plan") return `plan ${parsed.operation}`;
  if (parsed.command === "task") return `task ${parsed.operation}`;
  if (parsed.command === "work") return `work record ${parsed.record}`;
  return `phase ${parsed.operation} ${parsed.phase}`;
}
function failureAction(parsed, error, state) {
  if (parsed.command === "status") return STATUS_FAILURE_ACTION;
  if (parsed.command === "run") {
    return error instanceof WorkflowError && error.code === ERROR_CODES.ILLEGAL_TRANSITION ? nextActionFor(state) : RUN_FAILURE_ACTION;
  }
  if (parsed.command === "task" || parsed.command === "work") {
    if (error instanceof WorkflowError) {
      if (error.code === ERROR_CODES.OWNERSHIP_CONFLICT) return ownerAction("ntwork", false);
      if (error.code === ERROR_CODES.ILLEGAL_TRANSITION) return nextActionFor(state);
    }
    return phaseFailureAction("ntwork");
  }
  const phase = parsed.command === "plan" ? "ntplan" : parsed.phase;
  if (!(error instanceof WorkflowError)) return phaseFailureAction(phase);
  switch (error.code) {
    case ERROR_CODES.INVALID_INPUT:
      return INVALID_INPUT_ACTION;
    case ERROR_CODES.ILLEGAL_TRANSITION:
      return nextActionFor(state);
    case ERROR_CODES.OWNERSHIP_CONFLICT:
      return ownerAction(phase, parsed.operation === "complete");
    case ERROR_CODES.UNRESOLVED_BLOCKER:
      return blockerAction(phase);
    default:
      return phaseFailureAction(phase);
  }
}
async function execute(argv) {
  let parsed;
  try {
    parsed = parseArguments(argv);
  } catch (error) {
    const context = await contextForInvalidArguments(argv);
    const response = createFailureResponse({
      operation: operationForArguments(argv),
      projectRoot: context.projectRoot,
      state: context.state,
      nextAction: INVALID_INPUT_ACTION,
      warnings: [],
      error
    });
    process.stdout.write(serializeResponse(response));
    return response.error.exit_code;
  }
  try {
    const result = await executeCommand(parsed);
    const canStartRun = parsed.command !== "status" || await isGitProjectRoot(result.projectRoot);
    const response = createSuccessResponse({
      operation: operationForCommand(parsed),
      projectRoot: result.projectRoot,
      state: result.state,
      nextAction: nextActionFor(result.state, canStartRun),
      warnings: result.warnings
    });
    process.stdout.write(serializeResponse(response));
    return EXIT_CODES.SUCCESS;
  } catch (error) {
    let projectRoot = await resolvedRootOrEmpty(parsed.cwd);
    let state = null;
    try {
      const preflight = await readPreflight(parsed.cwd);
      projectRoot = preflight.projectRoot;
      state = preflight.state;
    } catch {
    }
    const response = createFailureResponse({
      operation: operationForCommand(parsed),
      projectRoot,
      state,
      nextAction: failureAction(parsed, error, state),
      warnings: [],
      error
    });
    process.stdout.write(serializeResponse(response));
    return response.error.exit_code;
  }
}
execute(process.argv.slice(2)).then((exitCode) => {
  process.exitCode = exitCode;
}).catch((error) => {
  const response = createFailureResponse({
    operation: "unknown",
    projectRoot: "",
    state: null,
    nextAction: INTERNAL_FAILURE_ACTION,
    warnings: [],
    error
  });
  process.stdout.write(serializeResponse(response));
  process.exitCode = response.error.exit_code;
});
