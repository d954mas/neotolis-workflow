import {
  existsSync,
  readFileSync,
  realpathSync,
  statSync,
} from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface CodexSessionStartContext {
  readonly owner: `codex:${string}`;
  readonly cwd: string;
  readonly cli: string;
}

function invalid(message: string): never {
  throw new Error(`Invalid Codex SessionStart payload: ${message}`);
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

export function createCodexSessionStartContext(
  payload: unknown,
  installedCliPath: string,
): CodexSessionStartContext {
  if (!isRecord(payload)) invalid('Expected a JSON object.');
  if (payload.hook_event_name !== 'SessionStart') {
    invalid('hook_event_name must be SessionStart.');
  }

  const sessionId = payload.session_id;
  if (
    typeof sessionId !== 'string'
    || sessionId.length === 0
    || /[:\s]/u.test(sessionId)
  ) {
    invalid('session_id must be a non-empty native ID without whitespace or colons.');
  }

  const cwd = payload.cwd;
  if (typeof cwd !== 'string' || !isAbsolute(cwd)) {
    invalid('cwd must be an absolute path.');
  }
  if (!isAbsolute(installedCliPath)) {
    invalid('Installed CLI path must be absolute.');
  }

  return Object.freeze({
    owner: `codex:${sessionId}`,
    cwd: existingPath(cwd, 'cwd', 'directory'),
    cli: existingPath(installedCliPath, 'Installed CLI', 'file'),
  });
}

export function serializeCodexSessionStartOutput(
  context: CodexSessionStartContext,
): string {
  return `${JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      additionalContext: `Neotolis Workflow runtime context: ${JSON.stringify(context)}`,
    },
  })}\n`;
}

function runCodexSessionStartHook(): number {
  try {
    const installedCliPath = process.argv[2];
    if (installedCliPath === undefined) {
      invalid('Installed CLI path argument is missing.');
    }
    const payload = JSON.parse(readFileSync(0, 'utf8')) as unknown;
    const context = createCodexSessionStartContext(payload, installedCliPath);
    process.stdout.write(serializeCodexSessionStartOutput(context));
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message.startsWith('Invalid Codex SessionStart payload:')
      ? message
      : `Invalid Codex SessionStart payload: ${message}`}\n`);
    return 2;
  }
}

if (process.argv[1] !== undefined
  && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = runCodexSessionStartHook();
}
