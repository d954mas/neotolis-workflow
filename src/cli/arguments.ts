import { ERROR_CODES, WorkflowError } from '../core/errors.ts';
import { isInterruptionAuthority } from '../runtime/phase.ts';
import type { IntakePhase, InterruptionAuthority } from '../runtime/phase.ts';
import { NTWORK_ROLES } from '../runtime/ntwork.ts';
import type { NtworkRole } from '../runtime/ntwork.ts';

type StateChangingPhase = IntakePhase | 'ntwork';

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
  readonly phase: StateChangingPhase;
  readonly sessionId: string;
}

export interface PhaseBeginArguments extends PhaseArgumentsBase {
  readonly operation: 'begin';
  readonly interruption?: InterruptionAuthority;
  readonly blockerResolved: boolean;
  readonly researcherAvailable?: boolean;
  readonly criticAvailable?: boolean;
  readonly availableWorkRoles?: ReadonlySet<NtworkRole>;
  readonly existingChangesConfirmed?: boolean;
  readonly baseBranch?: string;
}

export interface PhaseCompleteArguments extends PhaseArgumentsBase {
  readonly operation: 'complete';
  readonly userConfirmed?: true;
  readonly criticPassed?: true;
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
export interface PlanArguments {
  readonly cwd: string;
  readonly command: 'plan';
  readonly operation: 'validate';
  readonly sessionId: string;
  readonly criticPassed?: true;
  readonly userConfirmed?: true;
  readonly amendmentRecovery?: true;
}
export interface TaskBeginArguments {
  readonly cwd: string;
  readonly command: 'task';
  readonly operation: 'begin';
  readonly taskId: string;
  readonly sessionId: string;
  readonly existingChangesConfirmed: boolean;
}
export interface TaskCompleteArguments {
  readonly cwd: string;
  readonly command: 'task';
  readonly operation: 'complete';
  readonly taskId: string;
  readonly sessionId: string;
  readonly commitId: string;
}
export type TaskArguments = TaskBeginArguments | TaskCompleteArguments;

export interface WorkEvidenceArguments {
  readonly cwd: string;
  readonly command: 'work';
  readonly operation: 'record';
  readonly record: 'evidence';
  readonly sessionId: string;
  readonly gate: string;
  readonly procedure: string;
  readonly result: string;
  readonly expected: string;
  readonly sourceIds: readonly string[];
}

export interface WorkTaskReviewArguments {
  readonly cwd: string;
  readonly command: 'work';
  readonly operation: 'record';
  readonly record: 'task-review';
  readonly taskId: string;
  readonly sessionId: string;
  readonly packet: 'pass' | 'block';
  readonly quality: 'pass' | 'block';
  readonly sourceIds: readonly string[];
}
export interface WorkGateArguments {
  readonly cwd: string;
  readonly command: 'work';
  readonly operation: 'record';
  readonly record: 'gate';
  readonly gate: 'whole-plan' | 'nyquist' | 'spec-integration' | 'code-review' | 'ci';
  readonly sessionId: string;
  readonly verdict: 'pass' | 'fail' | 'block' | 'not-required';
  readonly procedure: string;
  readonly result: string;
  readonly expected: string;
  readonly sourceIds: readonly string[];
}
export interface WorkFixCommitArguments {
  readonly cwd: string;
  readonly command: 'work';
  readonly operation: 'record';
  readonly record: 'fix-commit';
  readonly sessionId: string;
  readonly scope: string;
  readonly commitId: string;
  readonly procedure: string;
  readonly result: string;
  readonly expected: string;
  readonly sourceIds: readonly string[];
}
export interface WorkPullRequestArguments {
  readonly cwd: string;
  readonly command: 'work';
  readonly operation: 'record';
  readonly record: 'pull-request';
  readonly sessionId: string;
  readonly id: string;
  readonly url: string;
}
export type WorkArguments = WorkEvidenceArguments | WorkTaskReviewArguments | WorkGateArguments | WorkFixCommitArguments | WorkPullRequestArguments;
export type CliArguments = StatusArguments | RunArguments | PhaseArguments | PlanArguments | TaskArguments | WorkArguments;

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

function phaseBase(cwd: string, sessionId: string, phase: StateChangingPhase): PhaseArgumentsBase {
  return { cwd, command: 'phase', phase, sessionId };
}

function parsePhaseBegin(
  cwd: string,
  sessionId: string,
  options: readonly string[],
  phase: StateChangingPhase,
): PhaseBeginArguments {
  if (phase === 'ntplan' && options.some((option) => option === '--researcher-available' || option === '--critic-available')) {
    const roleFlags: string[] = options.filter((option) => option === '--researcher-available' || option === '--critic-available');
    if (new Set(roleFlags).size !== roleFlags.length) invalidArguments('Duplicate native role flag.', { argument: roleFlags[0] ?? '' });
    return Object.freeze({
      ...parsePhaseBegin(cwd, sessionId, options.filter((option) => !roleFlags.includes(option)), phase),
      researcherAvailable: roleFlags.includes('--researcher-available'),
      criticAvailable: roleFlags.includes('--critic-available'),
    });
  }
  if (phase === 'ntwork' && options.some((option) => option.endsWith('-available'))) {
    const allowed = new Set(NTWORK_ROLES.map((role) => `--${role}-available`));
    const roleFlags = options.filter((option) => option.endsWith('-available'));
    const unknown = roleFlags.find((flag) => !allowed.has(flag));
    if (unknown !== undefined) invalidArguments('Unknown native ntwork role flag.', { argument: unknown });
    if (new Set(roleFlags).size !== roleFlags.length) invalidArguments('Duplicate native role flag.', { argument: roleFlags[0] ?? '' });
    const parsed = parsePhaseBegin(cwd, sessionId, options.filter((option) => !roleFlags.includes(option)), phase);
    return Object.freeze({
      ...parsed,
      availableWorkRoles: new Set(roleFlags.map((flag) => flag.slice(2, -10) as NtworkRole)),
    });
  }
  if (phase === 'ntwork' && options.includes('--existing-changes-confirmed')) {
    if (options.filter((option) => option === '--existing-changes-confirmed').length !== 1) {
      invalidArguments('Duplicate existing-changes confirmation.', { argument: '--existing-changes-confirmed' });
    }
    return Object.freeze({
      ...parsePhaseBegin(cwd, sessionId, options.filter((option) => option !== '--existing-changes-confirmed'), phase),
      existingChangesConfirmed: true,
    });
  }
  if (phase === 'ntwork' && options.includes('--base-branch')) {
    const index = options.indexOf('--base-branch');
    const value = options[index + 1];
    if (
      options.filter((option) => option === '--base-branch').length !== 1
      || value === undefined
      || value.trim().length === 0
    ) invalidArguments('Expected one --base-branch <branch>.', { argument: value ?? '' });
    return Object.freeze({
      ...parsePhaseBegin(cwd, sessionId, [
        ...options.slice(0, index), ...options.slice(index + 2),
      ], phase),
      baseBranch: value,
    });
  }
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
  phase: StateChangingPhase,
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
  if (argv[4] !== 'nttask' && argv[4] !== 'ntgrill' && argv[4] !== 'ntplan' && argv[4] !== 'ntwork') {
    invalidArguments('Unknown phase.', { phase: argv[4] ?? '' });
  }

  const phase = argv[4];
  const sessionId = requireSessionId(argv);
  const options = argv.slice(7);
  if (operation === 'begin') return parsePhaseBegin(cwd, sessionId, options, phase);
  if (operation === 'stop') return parsePhaseStop(cwd, sessionId, options, phase);
  if (phase === 'ntplan') {
    if (options.length !== 2 || options[0] !== '--critic-pass' || options[1] !== '--user-confirmed') {
      invalidArguments('ntplan completion requires --critic-pass --user-confirmed.', { argument: options[0] ?? '' });
    }
    return Object.freeze({ ...phaseBase(cwd, sessionId, phase), operation: 'complete', criticPassed: true, userConfirmed: true });
  }
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
    && (argv[4] === 'nttask' || argv[4] === 'ntgrill' || argv[4] === 'ntplan' || argv[4] === 'ntwork')
  ) {
    return `phase ${argv[3]} ${argv[4]}`;
  }
  if (argv[2] === 'plan' && (argv[3] === 'validate' || argv[3] === 'amend')) return `plan ${argv[3]}`;
  if (argv[2] === 'task' && argv[3] === 'begin') return 'task begin';
  if (argv[2] === 'task' && argv[3] === 'complete') return 'task complete';
  if (argv[2] === 'work' && argv[3] === 'record' && argv[4]) return `work record ${argv[4]}`;
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
  if (command === 'task') {
    if (
      (argv[3] !== 'begin' && argv[3] !== 'complete')
      || !argv[4]
      || argv[5] !== '--session-id'
      || !argv[6]
    ) {
      invalidArguments('Expected task begin|complete <task-id> --session-id <provider:id>.', {
        argument: argv[3] ?? '',
      });
    }
    if (argv[3] === 'complete') {
      if (argv.length !== 9 || argv[7] !== '--commit-id' || !argv[8]) {
        invalidArguments('task complete requires --commit-id <git-commit>.', {
          argument: argv[7] ?? '',
        });
      }
      return Object.freeze({
        cwd: argv[1], command, operation: 'complete', taskId: argv[4],
        sessionId: argv[6], commitId: argv[8],
      });
    }
    if (argv.length !== 7 && !(argv.length === 8 && argv[7] === '--existing-changes-confirmed')) {
      invalidArguments('Unexpected task begin argument.', { argument: argv[7] ?? '' });
    }
    return Object.freeze({
      cwd: argv[1], command, operation: 'begin', taskId: argv[4], sessionId: argv[6],
      existingChangesConfirmed: argv[7] === '--existing-changes-confirmed',
    });
  }
  if (command === 'work') {
    if (argv[3] !== 'record') {
      invalidArguments('Expected work record operation.', { argument: argv[3] ?? '' });
    }
    if (argv[4] === 'evidence') {
      if (
        argv.length !== 17 || argv[5] !== '--session-id' || !argv[6]
        || argv[7] !== '--gate' || !argv[8]
        || argv[9] !== '--procedure' || !argv[10]
        || argv[11] !== '--result' || !argv[12]
        || argv[13] !== '--expected' || !argv[14]
        || argv[15] !== '--source-id' || !argv[16]
      ) invalidArguments('Invalid work evidence arguments.', { argument: argv[5] ?? '' });
      return Object.freeze({
        cwd: argv[1], command, operation: 'record', record: 'evidence',
        sessionId: argv[6], gate: argv[8], procedure: argv[10], result: argv[12],
        expected: argv[14], sourceIds: argv[16].split(',').map((id) => id.trim()),
      });
    }
    if (argv[4] === 'task-review') {
      if (
        argv.length !== 14 || !argv[5]
        || argv[6] !== '--session-id' || !argv[7]
        || argv[8] !== '--packet' || (argv[9] !== 'pass' && argv[9] !== 'block')
        || argv[10] !== '--quality' || (argv[11] !== 'pass' && argv[11] !== 'block')
        || argv[12] !== '--source-id' || !argv[13]
      ) invalidArguments('Invalid work task-review arguments.', { argument: argv[5] ?? '' });
      return Object.freeze({
        cwd: argv[1], command, operation: 'record', record: 'task-review',
        taskId: argv[5], sessionId: argv[7], packet: argv[9], quality: argv[11],
        sourceIds: argv[13].split(',').map((id) => id.trim()),
      });
    }
    if (argv[4] === 'gate') {
      const gate = argv[5];
      const verdict = argv[9];
      if (
        argv.length !== 18
        || !['whole-plan', 'nyquist', 'spec-integration', 'code-review', 'ci'].includes(gate ?? '')
        || argv[6] !== '--session-id' || !argv[7]
        || argv[8] !== '--verdict'
        || !['pass', 'fail', 'block', 'not-required'].includes(verdict ?? '')
        || argv[10] !== '--procedure' || !argv[11]
        || argv[12] !== '--result' || !argv[13]
        || argv[14] !== '--expected' || !argv[15]
        || argv[16] !== '--source-id' || !argv[17]
      ) invalidArguments('Invalid work gate arguments.', { argument: argv[5] ?? '' });
      return Object.freeze({
        cwd: argv[1], command, operation: 'record', record: 'gate',
        gate: gate as WorkGateArguments['gate'], sessionId: argv[7],
        verdict: verdict as WorkGateArguments['verdict'], procedure: argv[11],
        result: argv[13], expected: argv[15],
        sourceIds: argv[17].split(',').map((id) => id.trim()),
      });
    }
    if (argv[4] === 'fix-commit') {
      if (
        argv.length !== 19 || argv[5] !== '--session-id' || !argv[6]
        || argv[7] !== '--scope' || !argv[8]
        || argv[9] !== '--commit-id' || !argv[10]
        || argv[11] !== '--procedure' || !argv[12]
        || argv[13] !== '--result' || !argv[14]
        || argv[15] !== '--expected' || !argv[16]
        || argv[17] !== '--source-id' || !argv[18]
      ) invalidArguments('Invalid work fix-commit arguments.', { argument: argv[5] ?? '' });
      return Object.freeze({
        cwd: argv[1], command, operation: 'record', record: 'fix-commit',
        sessionId: argv[6], scope: argv[8], commitId: argv[10], procedure: argv[12],
        result: argv[14], expected: argv[16],
        sourceIds: argv[18].split(',').map((id) => id.trim()),
      });
    }
    if (argv[4] === 'pull-request') {
      if (
        argv.length !== 11 || argv[5] !== '--session-id' || !argv[6]
        || argv[7] !== '--id' || !argv[8]
        || argv[9] !== '--url' || !argv[10]
      ) invalidArguments('Invalid work pull-request arguments.', { argument: argv[5] ?? '' });
      return Object.freeze({
        cwd: argv[1], command, operation: 'record', record: 'pull-request',
        sessionId: argv[6], id: argv[8], url: argv[10],
      });
    }
    invalidArguments('Unknown work record operation.', { operation: argv[4] ?? '' });
  }
  if (command === 'plan') {
    if (argv[3] === 'validate' && argv.length === 6 && argv[4] === '--session-id' && argv[5]) {
      return Object.freeze({ cwd: argv[1], command, operation: 'validate', sessionId: argv[5] });
    }
    if (
      argv[3] === 'validate' && argv.length === 7
      && argv[4] === '--session-id' && argv[5]
      && argv[6] === '--amendment-recovery'
    ) {
      return Object.freeze({
        cwd: argv[1], command, operation: 'validate', sessionId: argv[5],
        amendmentRecovery: true,
      });
    }
    if (
      argv[3] === 'validate' && (argv.length === 8 || argv.length === 9)
      && argv[4] === '--session-id' && argv[5]
      && argv[6] === '--critic-pass' && argv[7] === '--user-confirmed'
      && (argv.length === 8 || argv[8] === '--amendment-recovery')
    ) {
      return Object.freeze({
        cwd: argv[1], command, operation: 'validate', sessionId: argv[5],
        criticPassed: true, userConfirmed: true,
        ...(argv[8] === '--amendment-recovery' ? { amendmentRecovery: true as const } : {}),
      });
    }
    invalidArguments('Expected plan validate, optionally with critic PASS and user confirmation.', { argument: argv[3] ?? '' });
  }

  invalidArguments('Unknown command.', { command: command ?? '' });
}
