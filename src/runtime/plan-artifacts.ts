import { lstat, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { ERROR_CODES, WorkflowError } from '../core/errors.ts';
import { parseMarkdown } from './artifacts.ts';

const TASK_ID = 'NT-\\d{3,}-\\d{2,}';
const ACCEPTANCE_ID = 'AC-[1-9]\\d*';
const SPEC_SECTIONS = ['Outcome', 'Scope', 'Requirements', 'Constraints', 'Acceptance criteria'];
const PLAN_SECTIONS = ['Approach', 'Technical decisions', 'Dependency graph', 'Execution order', 'Task index', 'Final validation'];
const PACKET_SECTIONS = ['Goal', 'Scope', 'Dependencies', 'Acceptance coverage', 'Verification'];

function invalid(path: string, reason: string): never {
  throw new WorkflowError({
    code: ERROR_CODES.ARTIFACT_FAILURE,
    message: 'Planning artifacts do not satisfy the ntplan contract.',
    details: { path, reason },
  });
}

async function requireKind(path: string, kind: 'file' | 'directory'): Promise<void> {
  try {
    const stat = await lstat(path);
    if (kind === 'file' ? !stat.isFile() : !stat.isDirectory()) invalid(path, `expected a regular ${kind}`);
  } catch (error) {
    if (error instanceof WorkflowError) throw error;
    invalid(path, `missing or unreadable ${kind}`);
  }
}

async function document(path: string, required: readonly string[]) {
  await requireKind(path, 'file');
  let source: string;
  try { source = new TextDecoder('utf-8', { fatal: true }).decode(await readFile(path)); }
  catch { invalid(path, 'expected readable UTF-8 Markdown'); }
  const { headings, lines, visibleLines } = parseMarkdown(source);
  const titles = headings.filter(h => h.level === 1);
  const title = titles[0];
  if (titles.length !== 1 || !title?.text || headings[0] !== title) invalid(path, 'exactly one non-empty leading H1 is required');
  const sections: Record<string, string> = {};
  const visibleSections: Record<string, string> = {};
  const h2s = headings.filter(h => h.level === 2);
  for (const [index, heading] of h2s.entries()) {
    if (Object.hasOwn(sections, heading.text)) invalid(path, `duplicate section ${heading.text}`);
    sections[heading.text] = lines.slice(heading.line + 1, h2s[index + 1]?.line ?? lines.length).join('\n').trim();
    visibleSections[heading.text] = visibleLines.slice(heading.line + 1, h2s[index + 1]?.line ?? lines.length).join('\n').trim();
  }
  for (const name of required) if (!sections[name]) invalid(path, `missing or empty section ${name}`);
  return { title: title.text, sections, visibleSections };
}

function unique(ids: string[], path: string): string[] {
  if (new Set(ids).size !== ids.length) invalid(path, 'duplicate ID');
  return ids;
}

function idList(body: string, pattern: string, path: string): string[] {
  if (body === 'none') return [];
  const ids = body.split(',').map(id => id.trim());
  if (!ids.every(id => new RegExp(`^${pattern}$`, 'u').test(id))) invalid(path, 'expected comma-separated IDs or none');
  return unique(ids, path);
}

function rows(body: string, pattern: string, path: string): Array<[string, string]> {
  const parsed: Array<[string, string]> = [];
  for (const line of body.split('\n').filter(line => line.trim())) {
    const match = new RegExp(`^- (${pattern}): (\\S.*)$`, 'u').exec(line.trim());
    if (!match) invalid(path, 'expected non-empty - ID: description rows');
    parsed.push([match[1] as string, match[2] as string]);
  }
  unique(parsed.map(([id]) => id), path);
  return parsed;
}

/** Structural gate only: semantic evidence, verification quality and criticism belong to the phase. */
export async function validatePlanArtifacts(projectRoot: string, runId: string): Promise<string[]> {
  const runs = join(projectRoot, '.ntworkflow', 'runs');
  const run = join(runs, runId);
  const tasks = join(run, 'tasks');
  for (const path of [runs, run, tasks]) await requireKind(path, 'directory');
  const specPath = join(run, 'SPEC.md');
  const planPath = join(run, 'PLAN.md');
  const spec = await document(specPath, SPEC_SECTIONS);
  const plan = await document(planPath, PLAN_SECTIONS);
  const acceptance = rows(spec.sections['Acceptance criteria'] as string, ACCEPTANCE_ID, specPath).map(([id]) => id);
  const order = (plan.sections['Execution order'] as string).split('\n').filter(line => line.trim()).map((line, i) => {
    const match = new RegExp(`^${i + 1}\\. (${TASK_ID})$`, 'u').exec(line.trim());
    if (!match) invalid(planPath, 'execution order must be a numbered list of task IDs');
    return match[1] as string;
  });
  unique(order, planPath);
  if (!order.length) invalid(planPath, 'at least one executable task is required');
  const graph = new Map(rows(plan.sections['Dependency graph'] as string, TASK_ID, planPath));
  const index = rows(plan.sections['Task index'] as string, TASK_ID, planPath).map(([id]) => id);
  const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every(id => b.includes(id));
  if (!sameSet(order, [...graph.keys()]) || !sameSet(order, index)) invalid(planPath, 'graph, order and task index must contain exactly the same tasks');
  let entries: string[];
  try { entries = await readdir(tasks); } catch { invalid(tasks, 'unreadable task directory'); }
  if (!sameSet(entries, order.map(id => `${id}.md`))) invalid(tasks, 'packet files must exactly match the task index');
  const owned = new Set<string>();
  const own = (ids: string[], path: string) => {
    for (const id of ids) {
      if (!acceptance.includes(id)) invalid(path, `unknown acceptance ID ${id}`);
      if (owned.has(id)) invalid(path, `multiply owned acceptance ID ${id}`);
      owned.add(id);
    }
  };
  for (const [position, id] of order.entries()) {
    const path = join(tasks, `${id}.md`);
    if (id !== `${runId}-${String(position + 1).padStart(2, '0')}`) invalid(path, 'task ID must derive from the run ID and stable order');
    const packet = await document(path, PACKET_SECTIONS);
    if (!packet.title.startsWith(`${id}: `) || !packet.title.slice(id.length + 2).trim()) invalid(path, 'displayed ID must match the packet filename');
    const dependencies = idList(packet.sections.Dependencies as string, TASK_ID, path);
    for (const dependency of dependencies) {
      const dependencyIndex = order.indexOf(dependency);
      if (dependencyIndex < 0) invalid(path, `unknown dependency ${dependency}`);
      if (dependencyIndex >= position) invalid(path, 'dependency cycle or dependency does not precede its dependent');
    }
    if (!sameSet(dependencies, idList(graph.get(id) as string, TASK_ID, planPath))) invalid(planPath, `graph disagrees with canonical dependencies of ${id}`);
    own(idList(packet.sections['Acceptance coverage'] as string, ACCEPTANCE_ID, path), path);
  }
  // Free prose lists whole-suite procedures; only explicit AC rows claim final ownership.
  const finalRows = (plan.visibleSections['Final validation'] as string).split('\n').filter(line => /^\s*- AC-/u.test(line)).join('\n');
  own(rows(finalRows, ACCEPTANCE_ID, planPath).map(([id]) => id), planPath);
  for (const id of acceptance) if (!owned.has(id)) invalid(specPath, `unowned acceptance ID ${id}`);
  return order;
}
