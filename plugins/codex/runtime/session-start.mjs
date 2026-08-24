/* eslint-disable */

// src/providers/codex-session-start.ts
import {
  existsSync,
  readFileSync,
  realpathSync,
  statSync
} from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
function invalid(message) {
  throw new Error(`Invalid Codex SessionStart payload: ${message}`);
}
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function existingPath(path, label, kind) {
  if (!existsSync(path)) invalid(`${label} does not exist.`);
  const canonical = realpathSync(path);
  const stat = statSync(canonical);
  if (kind === "file" ? !stat.isFile() : !stat.isDirectory()) {
    invalid(`${label} must be a ${kind}.`);
  }
  return canonical;
}
function createCodexSessionStartContext(payload, installedCliPath) {
  if (!isRecord(payload)) invalid("Expected a JSON object.");
  if (payload.hook_event_name !== "SessionStart") {
    invalid("hook_event_name must be SessionStart.");
  }
  const sessionId = payload.session_id;
  if (typeof sessionId !== "string" || sessionId.length === 0 || /[:\s]/u.test(sessionId)) {
    invalid("session_id must be a non-empty native ID without whitespace or colons.");
  }
  const cwd = payload.cwd;
  if (typeof cwd !== "string" || !isAbsolute(cwd)) {
    invalid("cwd must be an absolute path.");
  }
  if (!isAbsolute(installedCliPath)) {
    invalid("Installed CLI path must be absolute.");
  }
  return Object.freeze({
    owner: `codex:${sessionId}`,
    cwd: existingPath(cwd, "cwd", "directory"),
    cli: existingPath(installedCliPath, "Installed CLI", "file")
  });
}
function serializeCodexSessionStartOutput(context) {
  return `${JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "SessionStart",
      additionalContext: `Neotolis Workflow runtime context: ${JSON.stringify(context)}`
    }
  })}
`;
}
function runCodexSessionStartHook() {
  try {
    const installedCliPath = process.argv[2];
    if (installedCliPath === void 0) {
      invalid("Installed CLI path argument is missing.");
    }
    const payload = JSON.parse(readFileSync(0, "utf8"));
    const context = createCodexSessionStartContext(payload, installedCliPath);
    process.stdout.write(serializeCodexSessionStartOutput(context));
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message.startsWith("Invalid Codex SessionStart payload:") ? message : `Invalid Codex SessionStart payload: ${message}`}
`);
    return 2;
  }
}
if (process.argv[1] !== void 0 && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = runCodexSessionStartHook();
}
export {
  createCodexSessionStartContext,
  serializeCodexSessionStartOutput
};
