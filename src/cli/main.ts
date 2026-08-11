import { parseArguments } from './arguments.ts';
import { EXIT_CODES } from '../core/errors.ts';
import {
  createFailureResponse,
  createSuccessResponse,
  serializeResponse,
} from '../core/protocol.ts';
import type { NextAction, NextSkill } from '../core/protocol.ts';
import type { State } from '../core/state.ts';
import { readPreflight } from '../runtime/preflight.ts';
import { resolveProjectRoot } from '../runtime/project-root.ts';

const INVALID_INPUT_ACTION = action(null, 'Correct the CLI input and retry.');
const STATUS_FAILURE_ACTION = action(
  null,
  'Correct the reported failure and retry status.',
);
const INTERNAL_FAILURE_ACTION = action(
  null,
  'Inspect the internal failure and retry.',
);

function action(skill: NextSkill, instruction: string): NextAction {
  return Object.freeze({ skill, instruction });
}

function nextActionFor(state: State | null): NextAction {
  if (state === null || state.current === null) {
    return action('nttask', 'Start nttask with a non-empty task.');
  }

  const lifecycle = state.current.lifecycle;
  switch (lifecycle) {
    case 'intake-active':
      return action('nttask', 'Continue the active nttask phase.');
    case 'brief-ready':
      return action('ntgrill', 'Continue with ntgrill.');
    case 'plan-ready':
      return action('ntplan', 'Continue with ntplan.');
    case 'plan-approved':
    case 'work-active':
      return action('ntwork', 'Continue with ntwork.');
    case 'delivery-ready':
      return action(
        'nttask',
        'Start nttask when ready to close delivery and begin a new run.',
      );
  }

  const exhaustiveLifecycle: never = lifecycle;
  return exhaustiveLifecycle;
}

function suppliedCwd(argv: readonly string[]): string | null {
  const cwd = argv[1];
  return argv[0] === '--cwd' && cwd !== undefined && cwd.length > 0
    ? cwd
    : null;
}

async function resolvedRootOrEmpty(cwd: string): Promise<string> {
  try {
    return await resolveProjectRoot(cwd);
  } catch {
    return '';
  }
}

async function contextForInvalidArguments(argv: readonly string[]): Promise<{
  projectRoot: string;
  state: State | null;
}> {
  const cwd = suppliedCwd(argv);
  if (cwd === null) {
    return { projectRoot: '', state: null };
  }
  try {
    const result = await readPreflight(cwd);
    return result;
  } catch {
    return { projectRoot: await resolvedRootOrEmpty(cwd), state: null };
  }
}

async function execute(argv: readonly string[]): Promise<number> {
  let parsed: ReturnType<typeof parseArguments>;
  try {
    parsed = parseArguments(argv);
  } catch (error) {
    const context = await contextForInvalidArguments(argv);
    const response = createFailureResponse({
      operation: suppliedCwd(argv) === null ? 'unknown' : (argv[2] ?? 'unknown'),
      projectRoot: context.projectRoot,
      state: context.state,
      nextAction: INVALID_INPUT_ACTION,
      warnings: [],
      error,
    });
    process.stdout.write(serializeResponse(response));
    return response.error.exit_code;
  }

  let projectRoot = '';

  try {
    const preflight = await readPreflight(parsed.cwd);
    projectRoot = preflight.projectRoot;
    const state = preflight.state;
    const response = createSuccessResponse({
      operation: parsed.command,
      projectRoot,
      state,
      nextAction: nextActionFor(state),
      warnings: [],
    });
    process.stdout.write(serializeResponse(response));
    return response.ok ? EXIT_CODES.SUCCESS : response.error.exit_code;
  } catch (error) {
    if (projectRoot.length === 0) {
      projectRoot = await resolvedRootOrEmpty(parsed.cwd);
    }
    const response = createFailureResponse({
      operation: parsed.command,
      projectRoot,
      state: null,
      nextAction: STATUS_FAILURE_ACTION,
      warnings: [],
      error,
    });
    process.stdout.write(serializeResponse(response));
    return response.error.exit_code;
  }
}

execute(process.argv.slice(2))
  .then((exitCode) => {
    process.exitCode = exitCode;
  })
  .catch((error: unknown) => {
    const response = createFailureResponse({
      operation: 'unknown',
      projectRoot: '',
      state: null,
      nextAction: INTERNAL_FAILURE_ACTION,
      warnings: [],
      error,
    });
    process.stdout.write(serializeResponse(response));
    process.exitCode = response.error.exit_code;
  });
