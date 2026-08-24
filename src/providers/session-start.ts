import {
  existsSync,
  readFileSync,
  realpathSync,
  statSync,
} from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface ClaudeSessionStartContext {
  readonly owner: `claude:${string}`;
  readonly cwd: string;
  readonly cli: string;
}

function invalid(message: string): never {
  throw new Error(`Invalid Claude SessionStart payload: ${message}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function existingPath(path: string, label: string, kind: 'file' | 'directory'): string {
  if (!existsSync(path)) invalid(`${label} does not exist.`);
  const canonical = realpathSync(path);
  const stat = statSync(canonical);
  if (kind === 'file' ? !stat.isFile() : !stat.isDirectory()) {
    invalid(`${label} must be a ${kind}.`);
  }
  return canonical;
}

export function createClaudeSessionStartContext(
  payload: unknown,
  installedCliPath: string,
): ClaudeSessionStartContext {
  if (!isRecord(payload)) invalid('Expected a JSON object.');
  if (payload.hook_event_name !== 'SessionStart') {
    invalid('hook_event_name must be SessionStart.');
  }

  const sessionId = payload.session_id;
  if (typeof sessionId !== 'string' || sessionId.trim().length === 0) {
    invalid('session_id must be a non-empty string.');
  }

  const cwd = payload.cwd;
  if (typeof cwd !== 'string' || !isAbsolute(cwd)) {
    invalid('cwd must be an absolute path.');
  }
  if (!isAbsolute(installedCliPath)) {
    invalid('Installed CLI path must be absolute.');
  }

  return Object.freeze({
    owner: `claude:${sessionId}`,
    cwd: existingPath(cwd, 'cwd', 'directory'),
    cli: existingPath(installedCliPath, 'Installed CLI', 'file'),
  });
}

export function serializeClaudeSessionStartOutput(
  context: ClaudeSessionStartContext,
): string {
  return `${JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      additionalContext: `Neotolis Workflow runtime context: ${JSON.stringify(context)}`,
    },
  })}\n`;
}

function runClaudeSessionStartHook(): number {
  try {
    const installedCliPath = process.argv[2];
    if (installedCliPath === undefined) {
      invalid('Installed CLI path argument is missing.');
    }
    const payload = JSON.parse(readFileSync(0, 'utf8')) as unknown;
    const context = createClaudeSessionStartContext(payload, installedCliPath);
    process.stdout.write(serializeClaudeSessionStartOutput(context));
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message.startsWith('Invalid Claude SessionStart payload:')
      ? message
      : `Invalid Claude SessionStart payload: ${message}`}\n`);
    return 2;
  }
}

if (process.argv[1] !== undefined
  && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = runClaudeSessionStartHook();
}
