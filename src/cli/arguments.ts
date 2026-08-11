import { ERROR_CODES, WorkflowError } from '../core/errors.ts';

export interface StatusArguments {
  readonly cwd: string;
  readonly command: 'status';
}

function invalidArguments(message: string, details: { readonly [key: string]: string }): never {
  throw new WorkflowError({
    code: ERROR_CODES.INVALID_INPUT,
    message,
    details,
  });
}

export function parseArguments(argv: readonly string[]): StatusArguments {
  if (argv[0] !== '--cwd' || argv[1] === undefined || argv[1].length === 0) {
    invalidArguments('Expected --cwd <path> before the command.', {
      argument: argv[0] ?? '',
    });
  }

  const command = argv[2];
  if (command !== 'status') {
    invalidArguments('Unknown command.', { command: command ?? '' });
  }
  if (argv.length !== 3) {
    invalidArguments('The status command accepts no arguments.', {
      argument: argv[3] ?? '',
    });
  }

  return Object.freeze({ cwd: argv[1], command });
}
