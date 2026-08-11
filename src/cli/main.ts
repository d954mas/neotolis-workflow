import { operationForArguments, parseArguments } from './arguments.ts';
import type {
  CliArguments,
  RunArguments,
  StatusArguments,
} from './arguments.ts';
import { ERROR_CODES, EXIT_CODES, WorkflowError } from '../core/errors.ts';
import {
  createFailureResponse,
  createSuccessResponse,
  serializeResponse,
} from '../core/protocol.ts';
import type { NextAction, NextSkill } from '../core/protocol.ts';
import type { State } from '../core/state.ts';
import { readPreflight } from '../runtime/preflight.ts';
import { resolveProjectRoot } from '../runtime/project-root.ts';
import { cancelRun, completeRun, startRun } from '../runtime/run.ts';

const INVALID_INPUT_ACTION = action(null, 'Correct the CLI input and retry.');
const STATUS_FAILURE_ACTION = action(
  null,
  'Correct the reported failure and retry status.',
);
const INTERNAL_FAILURE_ACTION = action(
  null,
  'Inspect the internal failure and retry.',
);
const RUN_FAILURE_ACTION = action(
  null,
  'Resolve the reported run failure before retrying.',
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

interface CommandResult {
  readonly projectRoot: string;
  readonly state: State | null;
  readonly warnings: readonly string[];
}

async function executeStatus(parsed: StatusArguments): Promise<CommandResult> {
  const preflight = await readPreflight(parsed.cwd);
  return {
    projectRoot: preflight.projectRoot,
    state: preflight.state,
    warnings: [],
  };
}

async function executeRun(parsed: RunArguments): Promise<CommandResult> {
  const projectRoot = await resolveProjectRoot(parsed.cwd);
  const input = { sessionId: parsed.sessionId };
  let result: Awaited<ReturnType<typeof startRun>>;

  switch (parsed.operation) {
    case 'start':
      result = await startRun(projectRoot, input);
      break;
    case 'cancel':
      result = await cancelRun(projectRoot, {
        ...input,
        userConfirmed: parsed.userConfirmed,
      });
      break;
    case 'complete':
      result = await completeRun(projectRoot, {
        ...input,
        userConfirmed: parsed.userConfirmed,
      });
      break;
  }

  return {
    projectRoot,
    state: result.state,
    warnings: result.warnings,
  };
}

function executeCommand(parsed: CliArguments): Promise<CommandResult> {
  return parsed.command === 'status'
    ? executeStatus(parsed)
    : executeRun(parsed);
}

function operationForCommand(parsed: CliArguments): string {
  return parsed.command === 'status' ? parsed.command : `run ${parsed.operation}`;
}

async function execute(argv: readonly string[]): Promise<number> {
  let parsed: CliArguments;
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
      error,
    });
    process.stdout.write(serializeResponse(response));
    return response.error.exit_code;
  }

  try {
    const result = await executeCommand(parsed);
    const response = createSuccessResponse({
      operation: operationForCommand(parsed),
      projectRoot: result.projectRoot,
      state: result.state,
      nextAction: nextActionFor(result.state),
      warnings: result.warnings,
    });
    process.stdout.write(serializeResponse(response));
    return response.ok ? EXIT_CODES.SUCCESS : response.error.exit_code;
  } catch (error) {
    let projectRoot = await resolvedRootOrEmpty(parsed.cwd);
    let state: State | null = null;
    try {
      const preflight = await readPreflight(parsed.cwd);
      projectRoot = preflight.projectRoot;
      state = preflight.state;
    } catch {
      // Preserve the primary failure when current state cannot be read.
    }
    const isStatus = parsed.command === 'status';
    const response = createFailureResponse({
      operation: operationForCommand(parsed),
      projectRoot,
      state,
      nextAction: isStatus
        ? STATUS_FAILURE_ACTION
        : error instanceof WorkflowError && error.code === ERROR_CODES.ILLEGAL_TRANSITION
          ? nextActionFor(state)
          : RUN_FAILURE_ACTION,
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
