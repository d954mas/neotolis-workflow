import { lstat, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { TextDecoder } from 'node:util';

import { ERROR_CODES, WorkflowError } from '../core/errors.ts';

const REQUIRED_SECTIONS = [
  'Brief',
  'Repository context',
  'Success',
] as const;
const OPTIONAL_SECTION = 'Open questions';

interface Heading {
  readonly level: 1 | 2;
  readonly text: string;
  readonly line: number;
}

function artifactFailure(path: string, reason: string, phase: 'nttask' | 'ntgrill'): never {
  throw new WorkflowError({
    code: ERROR_CODES.ARTIFACT_FAILURE,
    message: `BRIEF.md does not satisfy the ${phase} artifact contract.`,
    details: { path, reason },
  });
}

function parseBrief(markdown: string): { headings: Heading[]; lines: string[] } {
  const result: Heading[] = [];
  const lines = markdown.split(/\r?\n/u);
  let htmlComment = false;
  let fence: { character: '`' | '~'; length: number } | null = null;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    if (fence !== null) {
      const closingMatch = /^ {0,3}(`+|~+)[ \t]*$/u.exec(line);
      const closingMarker = closingMatch?.[1];
      if (
        closingMarker?.[0] === fence.character
        && closingMarker.length >= fence.length
      ) {
        fence = null;
      }
      continue;
    }

    // HTML comment blocks cannot supply headings or section content.
    if (htmlComment || /^ {0,3}<!--/u.test(line)) {
      // Keep visible text after the closing marker, including between adjacent comments.
      lines[index] = line.replace(/(?:^|<!--).*?(-->|$)/gu, (_comment, ending: string) => {
        htmlComment = ending !== '-->';
        return '';
      });
      continue;
    }

    const openingMatch = /^ {0,3}(`{3,}|~{3,})(.*)$/u.exec(line);
    if (openingMatch !== null) {
      const marker = openingMatch[1] ?? '';
      const info = openingMatch[2] ?? '';
      if (marker[0] !== '`' || !info.includes('`')) {
        fence = { character: marker[0] as '`' | '~', length: marker.length };
        continue;
      }
    }

    const match = /^ {0,3}(#{1,2})(?:[ \t]+|$)(.*)$/u.exec(line);
    if (match === null) continue;
    const rawText = (match[2] ?? '').replace(/(?:^|[ \t]+)#+[ \t]*$/u, '');
    result.push({
      level: match[1]?.length === 1 ? 1 : 2,
      text: rawText.trim(),
      line: index,
    });
  }

  return { headings: result, lines };
}

function validateBriefStructure(markdown: string, path: string, phase: 'nttask' | 'ntgrill'): void {
  const { headings: parsedHeadings, lines } = parseBrief(markdown);
  const titles = parsedHeadings.filter((heading) => heading.level === 1);
  const title = titles[0];
  if (titles.length !== 1 || title === undefined || title.text.length === 0) {
    artifactFailure(path, 'exactly one non-empty H1 is required', phase);
  }

  const sections = parsedHeadings.filter((heading) => heading.level === 2);
  const firstSection = sections[0];
  if (firstSection !== undefined && title.line > firstSection.line) {
    artifactFailure(path, 'the H1 must appear before all H2 sections', phase);
  }

  const sectionNames = sections.map((section) => section.text);
  if (phase === 'ntgrill' && sectionNames.includes(OPTIONAL_SECTION)) {
    throw new WorkflowError({
      code: ERROR_CODES.ARTIFACT_FAILURE,
      message: 'BRIEF.md does not satisfy the ntgrill artifact contract.',
      details: { path, reason: 'Open questions must be absent after shared understanding is confirmed' },
    });
  }
  const expected = sectionNames.length === REQUIRED_SECTIONS.length
    ? REQUIRED_SECTIONS
    : [...REQUIRED_SECTIONS, OPTIONAL_SECTION];
  if (
    sectionNames.length !== expected.length
    || !sectionNames.every((name, index) => name === expected[index])
  ) {
    artifactFailure(
      path,
      phase === 'nttask'
        ? 'required H2 sections must appear once in order; only a final Open questions section is optional'
        : 'required H2 sections must appear once in order; no additional sections are allowed',
      phase,
    );
  }

  for (const [index, section] of sections.entries()) {
    const nextLine = sections[index + 1]?.line ?? lines.length;
    const content = lines.slice(section.line + 1, nextLine).join('\n').trim();
    if (content.length === 0) {
      artifactFailure(path, `section ${section.text} must be non-empty`, phase);
    }
  }
}

export async function validateBrief(
  projectRoot: string,
  runId: string,
  phase: 'nttask' | 'ntgrill',
): Promise<void> {
  const runsPath = join(projectRoot, '.ntworkflow', 'runs');
  const runPath = join(runsPath, runId);
  const path = join(runPath, 'BRIEF.md');

  try {
    const runs = await lstat(runsPath);
    const run = await lstat(runPath);
    const brief = await lstat(path);
    if (!runs.isDirectory() || !run.isDirectory() || !brief.isFile()) {
      artifactFailure(path, 'BRIEF.md must be a regular file in the current run directory', phase);
    }
  } catch (error) {
    if (error instanceof WorkflowError) throw error;
    artifactFailure(path, 'BRIEF.md is missing or unreadable', phase);
  }

  let bytes: Buffer;
  try {
    bytes = await readFile(path);
  } catch {
    artifactFailure(path, 'BRIEF.md is missing or unreadable', phase);
  }

  let markdown: string;
  try {
    markdown = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    artifactFailure(path, 'BRIEF.md must contain valid UTF-8', phase);
  }
  validateBriefStructure(markdown, path, phase);
}

export function validateNttaskBrief(projectRoot: string, runId: string): Promise<void> {
  return validateBrief(projectRoot, runId, 'nttask');
}
