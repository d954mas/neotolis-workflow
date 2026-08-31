import { ERROR_CODES, WorkflowError } from '../core/errors.ts';
import { isInterruptionAuthority } from '../runtime/phase.ts';
import type { IntakePhase, InterruptionAuthority } from '../runtime/phase.ts';

export interface StatusArguments {
  readonly cwd: string;
  readonly command: 'status';
}

export interface RunArguments {
  readonly cwd: string;
  readonly command: 'run';
  readonly operation: 'start' | 'cancel' | 'complete';
  readonly sessionId: string;
  readonly userConfirmed: boolean;
}

interface PhaseArgumentsBase {
  readonly cwd: string;
  readonly command: 'phase';
  readonly phase: IntakePhase;
  readonly sessionId: string;
}

export interface PhaseBeginArguments extends PhaseArgumentsBase {
  readonly operation: 'begin';
  readonly interruption?: InterruptionAuthority;
  readonly blockerResolved: boolean;
}

export interface PhaseCompleteArguments extends PhaseArgumentsBase {
  readonly operation: 'complete';
  readonly userConfirmed?: true;
}

export interface PhaseStopArguments extends PhaseArgumentsBase {
  readonly operation: 'stop';
  readonly blocker: string;
  readonly interruption?: InterruptionAuthority;
}

export type PhaseArguments =
  | PhaseBeginArguments
  | PhaseCompleteArguments
  | PhaseStopArguments;
export type CliArguments = StatusArguments | RunArguments | PhaseArguments;

function invalidArguments(
  message: string,
  details: { readonly [key: string]: string },
): never {
  throw new WorkflowError({
    code: ERROR_CODES.INVALID_INPUT,
    message,
    details,
  });
}

function requireSessionId(argv: readonly string[]): string {
  if (argv[5] !== '--session-id' || argv[6] === undefined || argv[6].length === 0) {
    invalidArguments('Expected --session-id <provider:id>.', {
      argument: argv[5] ?? '',
    });
  }
  return argv[6];
}

function parseInterruption(value: string | undefined): InterruptionAuthority {
  if (!isInterruptionAuthority(value)) {
    invalidArguments('Invalid --interruption authority.', {
      value: value ?? '',
    });
  }
  return value;
}

function parseRunArguments(cwd: string, argv: readonly string[]): RunArguments {
  const operation = argv[3];
  if (operation !== 'start' && operation !== 'cancel' && operation !== 'complete') {
    invalidArguments('Unknown run operation.', { operation: operation ?? '' });
  }
  if (argv[4] !== '--session-id' || argv[5] === undefined || argv[5].length === 0) {
    invalidArguments('Expected --session-id <provider:id>.', {
      argument: argv[4] ?? '',
    });
  }

  const needsConfirmation = operation !== 'start';
  const expectedLength = needsConfirmation ? 7 : 6;
  if (needsConfirmation && argv[6] !== '--user-confirmed') {
    invalidArguments(`${operation} requires --user-confirmed.`, {
      argument: argv[6] ?? '',
    });
  }
  if (argv.length !== expectedLength) {
    invalidArguments('Unexpected run command argument.', {
      argument: argv[expectedLength] ?? '',
    });
  }

  return Object.freeze({
    cwd,
    command: 'run',
    operation,
    sessionId: argv[5],
    userConfirmed: needsConfirmation,
  });
}

function phaseBase(cwd: string, sessionId: string, phase: IntakePhase): PhaseArgumentsBase {
  return { cwd, command: 'phase', phase, sessionId };
}

function parsePhaseBegin(
  cwd: string,
  sessionId: string,
  options: readonly string[],
  phase: IntakePhase,
): PhaseBeginArguments {
  if (options.length === 0) {
    return Object.freeze({
      ...phaseBase(cwd, sessionId, phase),
      operation: 'begin',
      blockerResolved: false,
    });
  }
  if (options.length === 1 && options[0] === '--blocker-resolved') {
    return Object.freeze({
      ...phaseBase(cwd, sessionId, phase),
      operation: 'begin',
      blockerResolved: true,
    });
  }
  if (
    (options.length === 2 || options.length === 3)
    && options[0] === '--interruption'
    && (options.length === 2 || options[2] === '--blocker-resolved')
  ) {
    return Object.freeze({
      ...phaseBase(cwd, sessionId, phase),
      operation: 'begin',
      interruption: parseInterruption(options[1]),
      blockerResolved: options.length === 3,
    });
  }
  invalidArguments('Unexpected phase begin argument.', {
    argument: options[0] ?? '',
  });
}

function parsePhaseStop(
  cwd: string,
  sessionId: string,
  options: readonly string[],
  phase: IntakePhase,
): PhaseStopArguments {
  const blocker = options[1];
  if (options[0] !== '--blocker' || blocker === undefined || blocker.trim().length === 0) {
    invalidArguments('Expected --blocker <non-empty-text>.', {
      argument: options[0] ?? '',
    });
  }
  if (options.length === 2) {
    return Object.freeze({
      ...phaseBase(cwd, sessionId, phase),
      operation: 'stop',
      blocker,
    });
  }
  if (options.length === 4 && options[2] === '--interruption') {
    return Object.freeze({
      ...phaseBase(cwd, sessionId, phase),
      operation: 'stop',
      blocker,
      interruption: parseInterruption(options[3]),
    });
  }
  invalidArguments('Unexpected phase stop argument.', {
    argument: options[2] ?? '',
  });
}

function parsePhaseArguments(cwd: string, argv: readonly string[]): PhaseArguments {
  const operation = argv[3];
  if (operation !== 'begin' && operation !== 'complete' && operation !== 'stop') {
    invalidArguments('Unknown phase operation.', { operation: operation ?? '' });
  }
  if (argv[4] !== 'nttask' && argv[4] !== 'ntgrill') {
    invalidArguments('Unknown phase.', { phase: argv[4] ?? '' });
  }

  const phase = argv[4];
  const sessionId = requireSessionId(argv);
  const options = argv.slice(7);
  if (operation === 'begin') return parsePhaseBegin(cwd, sessionId, options, phase);
  if (operation === 'stop') return parsePhaseStop(cwd, sessionId, options, phase);
  if (phase === 'ntgrill') {
    if (options.length !== 1 || options[0] !== '--user-confirmed') {
      invalidArguments('ntgrill completion requires --user-confirmed.', { argument: options[0] ?? '' });
    }
    return Object.freeze({ ...phaseBase(cwd, sessionId, phase), operation: 'complete', userConfirmed: true });
  }
  if (options.length !== 0) {
    invalidArguments('The phase complete command accepts no extra arguments.', {
      argument: options[0] ?? '',
    });
  }
  return Object.freeze({
    ...phaseBase(cwd, sessionId, phase),
    operation: 'complete',
  });
}

export function operationForArguments(argv: readonly string[]): string {
  if (argv[0] !== '--cwd' || argv[1] === undefined || argv[1].length === 0) {
    return 'unknown';
  }
  if (
    argv[2] === 'run'
    && (argv[3] === 'start' || argv[3] === 'cancel' || argv[3] === 'complete')
  ) {
    return `run ${argv[3]}`;
  }
  if (
    argv[2] === 'phase'
    && (argv[3] === 'begin' || argv[3] === 'complete' || argv[3] === 'stop')
    && (argv[4] === 'nttask' || argv[4] === 'ntgrill')
  ) {
    return `phase ${argv[3]} ${argv[4]}`;
  }
  return argv[2] ?? 'unknown';
}

export function parseArguments(argv: readonly string[]): CliArguments {
  if (argv[0] !== '--cwd' || argv[1] === undefined || argv[1].length === 0) {
    invalidArguments('Expected --cwd <path> before the command.', {
      argument: argv[0] ?? '',
    });
  }

  const command = argv[2];
  if (command === 'status') {
    if (argv.length !== 3) {
      invalidArguments('The status command accepts no arguments.', {
        argument: argv[3] ?? '',
      });
    }
    return Object.freeze({ cwd: argv[1], command });
  }
  if (command === 'run') return parseRunArguments(argv[1], argv);
  if (command === 'phase') return parsePhaseArguments(argv[1], argv);

  invalidArguments('Unknown command.', { command: command ?? '' });
}
