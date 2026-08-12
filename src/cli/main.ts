import { operationForArguments, parseArguments } from './arguments.ts';
import type {
  CliArguments,
  PhaseArguments,
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
import {
  beginNttaskPhase,
  completeNttaskPhase,
  stopNttaskPhase,
} from '../runtime/phase.ts';
import { readPreflight } from '../runtime/preflight.ts';
import { resolveProjectRoot } from '../runtime/project-root.ts';
import { cancelRun, completeRun, startRun } from '../runtime/run.ts';

function action(skill: NextSkill, instruction: string): NextAction {
  return Object.freeze({ skill, instruction });
}

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
const PHASE_FAILURE_ACTION = action(
  'nttask',
  'Resolve the reported phase failure before retrying nttask.',
);
const OWNERSHIP_CONFLICT_ACTION = action(
  'nttask',
  'Continue in the recorded owner session, or retry with explicit --interruption authority.',
);
const UNRESOLVED_BLOCKER_ACTION = action(
  'nttask',
  'Resolve the recorded blocker, then retry phase begin nttask with --blocker-resolved.',
);
const COMPLETE_OWNERSHIP_CONFLICT_ACTION = action(
  'nttask',
  'Continue in the recorded owner session, or replace it with phase begin nttask --interruption <provider-ended|user-confirmed>.',
);
const ACTIVE_PHASE_ACTION = action('nttask', 'Continue the active nttask phase.');
const DURABLE_INTAKE_ACTION = action(
  'nttask', 'Begin nttask from the durable intake boundary.',
);

function nextActionFor(state: State | null): NextAction {
  if (state === null || state.current === null) {
    return action('nttask', 'Start nttask with a non-empty task.');
  }

  switch (state.current.lifecycle) {
    case 'intake-active':
      if (state.current.blocker !== null) return UNRESOLVED_BLOCKER_ACTION;
      if (state.current.phase === 'nttask') return ACTIVE_PHASE_ACTION;
      return DURABLE_INTAKE_ACTION;
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
  if (cwd === null) return { projectRoot: '', state: null };

  try {
    return await readPreflight(cwd);
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
  return { ...preflight, warnings: [] };
}

async function executeRun(parsed: RunArguments): Promise<CommandResult> {
  const projectRoot = await resolveProjectRoot(parsed.cwd);
  const input = { sessionId: parsed.sessionId };
  const result = parsed.operation === 'start'
    ? await startRun(projectRoot, input)
    : parsed.operation === 'cancel'
      ? await cancelRun(projectRoot, {
        ...input,
        userConfirmed: parsed.userConfirmed,
      })
      : await completeRun(projectRoot, {
        ...input,
        userConfirmed: parsed.userConfirmed,
      });

  return { projectRoot, ...result };
}

async function executePhase(parsed: PhaseArguments): Promise<CommandResult> {
  const projectRoot = await resolveProjectRoot(parsed.cwd);

  if (parsed.operation === 'complete') {
    const result = await completeNttaskPhase(projectRoot, {
      sessionId: parsed.sessionId,
    });
    return { projectRoot, ...result };
  }

  const interruption = parsed.interruption === undefined
    ? {}
    : { interruption: parsed.interruption };
  if (parsed.operation === 'begin') {
    const result = await beginNttaskPhase(projectRoot, {
      sessionId: parsed.sessionId,
      blockerResolved: parsed.blockerResolved,
      ...interruption,
    });
    return { projectRoot, ...result };
  }

  const result = await stopNttaskPhase(projectRoot, {
    sessionId: parsed.sessionId,
    blocker: parsed.blocker,
    ...interruption,
  });
  return { projectRoot, ...result };
}

function executeCommand(parsed: CliArguments): Promise<CommandResult> {
  if (parsed.command === 'status') return executeStatus(parsed);
  if (parsed.command === 'run') return executeRun(parsed);
  return executePhase(parsed);
}

function operationForCommand(parsed: CliArguments): string {
  if (parsed.command === 'status') return 'status';
  if (parsed.command === 'run') return `run ${parsed.operation}`;
  return `phase ${parsed.operation} nttask`;
}

function failureAction(
  parsed: CliArguments,
  error: unknown,
  state: State | null,
): NextAction {
  if (parsed.command === 'status') return STATUS_FAILURE_ACTION;
  if (parsed.command === 'run') {
    return error instanceof WorkflowError && error.code === ERROR_CODES.ILLEGAL_TRANSITION
      ? nextActionFor(state)
      : RUN_FAILURE_ACTION;
  }
  if (!(error instanceof WorkflowError)) return PHASE_FAILURE_ACTION;

  switch (error.code) {
    case ERROR_CODES.INVALID_INPUT:
      return INVALID_INPUT_ACTION;
    case ERROR_CODES.ILLEGAL_TRANSITION:
      return nextActionFor(state);
    case ERROR_CODES.OWNERSHIP_CONFLICT:
      return parsed.operation === 'complete'
        ? COMPLETE_OWNERSHIP_CONFLICT_ACTION : OWNERSHIP_CONFLICT_ACTION;
    case ERROR_CODES.UNRESOLVED_BLOCKER:
      return UNRESOLVED_BLOCKER_ACTION;
    default:
      return PHASE_FAILURE_ACTION;
  }
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
    const response = createFailureResponse({
      operation: operationForCommand(parsed),
      projectRoot,
      state,
      nextAction: failureAction(parsed, error, state),
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
