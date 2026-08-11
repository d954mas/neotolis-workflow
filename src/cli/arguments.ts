import { ERROR_CODES, WorkflowError } from '../core/errors.ts';

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

export type CliArguments = StatusArguments | RunArguments;

function invalidArguments(message: string, details: { readonly [key: string]: string }): never {
  throw new WorkflowError({
    code: ERROR_CODES.INVALID_INPUT,
    message,
    details,
  });
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

  invalidArguments('Unknown command.', { command: command ?? '' });
}
