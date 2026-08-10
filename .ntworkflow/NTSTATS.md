# ntstats Phase Contract

**Status:** Confirmed on 2026-08-10
**Public entry point:** `ntstats`
**Legal input:** Any workflow state, including no active run
**Workflow transition:** None
**Canonical artifact:** None

## Purpose

`ntstats` is a read-only view over local project telemetry. It answers how many
tokens were used, which tools actually ran, how large their observed textual
results were, and how elapsed time was distributed where the providers expose
enough evidence.

The phase deliberately remains small. It does not create a report, acquire
exclusive phase ownership, run supporting agents, change workflow state,
repair data, or require a database, dashboard, service, or OpenTelemetry
collector. `ntreflect` reads the full normalized telemetry directly and never
depends on a prior `ntstats` invocation or its top-20 presentation limit.

## Invocation and scopes

Without an explicit scope, `ntstats` selects:

1. the active run, when one exists;
2. otherwise the most recently completed run identifiable in retained telemetry;
3. otherwise a successful `no telemetry data yet` result.

The user may request a `session`, `task`, `phase`, `run`, or `project` scope in
natural language. A session scope contains the root provider session and all
proved descendants. A request for one named agent contains only that agent's
own events. A task scope contains events attributed to that task while it was
active in `ntwork`. Work performed in `delivery-ready` has no task attribution.
A phase scope is resolved inside one run. A run scope contains all its phases.

An ambiguous selector produces one clarification question. An unknown selector
is an input error. The runtime never selects a similar ID or the newest
provider transcript as a guess.

Project scope contains retained telemetry for completed runs, the active run,
and sessions that originated outside any run. Canceled runs are excluded from
the project aggregate but remain directly queryable by run ID. An event that
was born with a run ID never becomes an outside-run event after cancellation.

## Delivery-ready lifecycle

The workflow sequence is:

```text
nttask -> ntgrill -> ntplan -> ntwork -> delivery-ready -> work-complete
```

`delivery-ready` is a passive workflow phase, not a second state inside
`ntwork`. It has no public skill or canonical artifact. `ntwork` enters it only
after handing off the ready pull request with its required gates complete.

During `delivery-ready`, the user chooses whether to perform manual review,
invoke any agents or skills, change code, and run checks. Neotolis does not
govern or validate that work. Every Claude Code or Codex session proved to
belong to the project while this phase is active is attributed to the active
run and the `delivery-ready` phase, but not to a task.

Neotolis does not inspect Git or GitHub to prove a merge. The phase ends when
the user says the work is finished or starts a new non-empty task. Starting
that task prepares its run directory first, then uses one state commit to
close the prior `delivery-ready` run and select the new run. If the commit
fails, the prior run remains unchanged; an unexpected partial directory
blocks retry until the user resolves it. A different task during any earlier
phase still requires explicit cancellation.

## Sources and provider boundary

Each normalized field has one authoritative source class:

- provider-native usage owns token counters;
- project hooks own supported local, custom, and MCP tool lifecycle;
- versioned provider adapters own hosted-tool gaps and agent relationships;
- workflow-boundary telemetry owns session, run, phase, and task boundaries.

Claude Code and Codex have separate small adapters. Provider-native transcript
or session formats are versioned best-effort inputs rather than stable
Neotolis interfaces. A provider-format change makes affected metrics partial or
unavailable; it does not authorize guessing or block unrelated workflow work.

OpenTelemetry is never required or enabled by Neotolis. When the user has
already configured it and it provides a proved exact interval, the applicable
provider adapter may use that interval.

Hooks match every provider-supported tool path rather than a tool allowlist.
They preserve the provider's canonical tool name and call ID. The collector
never reads or retains tool arguments merely to classify a call. Hook failure
must not block, rewrite, approve, or deny the underlying tool operation; it
reduces telemetry availability and surfaces a warning instead.

## Local storage

All normalized telemetry remains under:

```text
.ntworkflow/telemetry/<provider>/<native-session-id>.jsonl
```

There is one append-only JSONL journal per provider-native session identity.
The normalized model needs only four logical event families:

- model usage;
- tool lifecycle;
- agent relation;
- workflow boundary.

An event stores only the telemetry `format` version, provider, stable source identity when
available, session or agent identity, timestamps, available workflow
attribution, lifecycle status, and numeric metrics relevant to that event.
Prompts, hidden reasoning, commands, tool arguments, model responses, tool
result content, and binary or base64 payloads are not stored.

There is no aggregate cache, summary journal, report history, telemetry
database, automatic retention, archive, sampling, or automatic deletion. Git
tracking policy remains entirely under user control. The user may remove any
telemetry journal manually without breaking workflow state or canonical
artifacts.

There is no independent event stream or telemetry registry. If all records for
a deleted journal are gone, `ntstats` reports no data rather than claiming to
know that the journal existed.

## Atomic append and snapshots

Concurrent writers serialize only the append operation with one short
cross-process telemetry lock. A writer constructs one complete record before
acquiring the lock, appends it as one newline-terminated operation, and releases
the lock immediately.

To create a snapshot, `ntstats` uses the same lock only long enough to capture
the in-memory file list and byte EOF of every included journal. It then releases
the lock and reads only those prefixes. Files and bytes created after the
captured boundaries belong to the next invocation. Invalid JSON inside a
captured prefix is corruption; there is no special active-file or trailing-line
repair rule and no snapshot artifact is written.

## Workflow attribution

An online hook records current workflow attribution when that context is
available. A provider event imported later is attributed by its proved source
identity and original timestamp against the existing runtime boundary events,
not against workflow state at import time. A task ID is assigned only while
that task was actually active.

When exact attribution cannot be proved, the event remains at the widest scope
that is proved and the narrower scope is partial or unavailable. Attribution is
never reconstructed from similar text, nearest timestamps, agent names, or
file recency.

## Token metrics

The normalized token fields are:

- total input tokens;
- cache-read input tokens when exposed;
- cache-write or cache-creation input tokens when exposed;
- output tokens.

Each provider adapter applies its provider's documented cache semantics. No
generic arithmetic is shared between Claude Code and Codex. Cumulative counters
become deltas only when ordering and the counter base are proved; otherwise the
metric is partial or unavailable.

Input and output remain separate and no grand total is displayed. Cache detail
is shown in parentheses and is never added twice:

```text
Tokens:
  input: 112,000 (cache read: 90,000, write: 4,000)
  output: 16,400
```

The rendered labels use the user's language.

## Tool-call metrics

The runtime preserves provider canonical names, including exact custom and MCP
names. It does not invent cross-provider categories such as `shell`,
`research`, or `other`.

One executed call is counted once only when its source provides a stable
correlation ID or one self-contained terminal event. Start, terminal, hook, and
provider records are merged only by a proved provider identity. A collector
record ID identifies that record; it never manufactures correlation between
independent records. When correlation is unavailable, one source owns that
event path and the affected coverage is partial. Fuzzy matching is forbidden.

A successfully completed call and a call that executed and returned an error
both count. A permission denial before execution does not count. A later
attempt with a new provider ID is simply another real call; `retry` is not a
separate metric. Transport continuation belongs to the original call only when
the provider supplies an explicit stable continuation identity. A standalone
agent-wait tool remains a real call.

For Codex code mode, proved leaf hook calls are the user-facing tool calls.
Their wrapper and transport polls are not added again. When leaf evidence is
unavailable, the wrapper may appear only as an explicitly partial representation. Unified
long-running shell continuation remains one call when the provider preserves
one call identity.

The default tool table contains the top 20 canonical names ordered by unique
completed call count. Each row may show:

- completed call count;
- observed lifecycle duration with `measured of observed` coverage;
- cumulative observed result characters.

The largest single observed result is shown separately. Tool lifecycle duration
is the proved start-to-terminal interval. It can contain approval waiting and
is not labeled execution or CPU time. Parallel call intervals may overlap and
must not be added to scope calendar time. The full untruncated tool set remains
available to `ntreflect` and on explicit user request.

## Observed result size

Result size is the number of textual characters visible to the authoritative
source. It is exact only when that source proves the model-visible
representation; otherwise it is partial. The metric is a diagnostic for noisy
tools, not a claim about exact context-window growth.

Non-text, image, audio, binary, and base64 payload sizes are unavailable rather
than estimated. Only the count is retained, never the content, and character
counts are never converted into estimated tokens.

## Time metrics

Total time is the real calendar boundary of the selected scope:

- session: start to end or snapshot;
- task: activation to completion;
- phase: entry to exit or snapshot;
- run: creation to `work-complete`, cancellation, or snapshot;
- project: the union of included run spans and outside-run session spans.

Other rows contain only proved intervals and use this exclusive priority:

1. observed model or tool work;
2. observed permission waiting;
3. observed waiting for the next user response;
4. the remaining interval is unclassified.

Parallel agents are unioned rather than summed. `Waiting for the user` means
only that the root interaction awaited another user message; it does not claim
the user was reading. Model/API duration means an observed provider request
interval, not pure model thought. Unclassified time may contain both idle time
and provider work that the available sources did not expose and must not be
interpreted further.

```text
Time:
  total: 32m
  observed agent work: 14m
  observed permission wait: 3m
  observed user wait: 8m
  unclassified: 7m
```

An unfinished tool call does not enter completed count, duration, or result-size
metrics. The report lists the number of unfinished calls separately.

## Agent aggregation

A session view shows the overall total, the root agent separately, and every
proved subagent in its tree. Token, call, and result-size totals sum unique
events. Agent time is unioned, never summed across parallel branches.

Claude hook agent IDs and Codex provider session relationships are normalized by
their respective adapters. When an agent is proved but its parent is not, the
agent remains in totals and is rendered under `parent unavailable`; tree
coverage becomes partial. Parentage is never inferred from timing, label, or
similar work.

Task, phase, run, and project views show only the unique agent count by default
to avoid noisy reports. Natural-language requests may expand the full tree or
one agent. The default top-20 tool table remains global to the selected scope,
not repeated for every agent.

## Availability

Every metric is `exact`, `partial`, or `unavailable`. Missing data is never
zero. Coverage uses honest absolute counts, such as `duration observed for 7 of
12 observed calls`; it never estimates a percentage of an unknown population.

Disabled or untrusted hooks, unsupported provider tool paths, provider-format
drift, deleted provider data, missing agent relations, and incomplete lifecycle
produce partial or unavailable metrics. A secondary source disagreement also
produces partial coverage. It is fatal only when contradictory records from the
same authoritative normalized source claim one canonical identity.

Telemetry capture failure does not stop agent work. Corrupt Neotolis-owned data
inside the selected snapshot does stop `ntstats`; it is not silently skipped or
repaired.

## Active runs and repeated invocation

When a scope contains an unfinished run, the report begins with a concise
warning that the statistics are preliminary. It also reports unfinished event
count when nonzero.

The current `ntstats` operation is not part of the snapshot it is reading.
There is no observer-turn classifier or exclusion registry. A previous
`ntstats` interaction is real model and tool work and may appear in a later
active-run or project snapshot. Calendar time of an active run continues to
advance. After `work-complete`, later statistics requests cannot change the
closed run, though they may be retained as outside-run project activity.

## Concise user output

The normal output is numeric and uses the user's language. It has no mandatory
interpretive paragraph:

```text
Run NT-007 — preliminary

Tokens:
  input: 112,000 (cache read: 90,000)
  output: 16,400

Time:
  total: 32m
  observed agent work: 14m
  observed permission wait: 3m
  observed user wait: 8m
  unclassified: 7m

Tools — top 20:
  shell_command: 41 · lifecycle 8m · 184,200 chars
  mcp__browser__navigate: 12 · lifecycle 1m 40s · 31,800 chars

Largest result:
  shell_command · 48,300 chars

Agents: 6
Data: partial — model/API time unavailable
```

Exact completed scopes omit preliminary and availability warnings. Session
scope expands the compact agent tree below these totals.

## Success and failure

`ntstats` succeeds when the selector is resolved, a snapshot is captured, all
readable in-scope normalized data is aggregated, and the concise output is
rendered. `partial`, `unavailable`, preliminary data, and no retained data are
successful results.

It fails only for:

- an unknown selector;
- unreadable or corrupt in-scope Neotolis telemetry;
- an unsupported in-scope Neotolis telemetry schema;
- a canonical identity conflict inside one authoritative normalized source;
- corrupt workflow context required by the selected scope.

The command never auto-repairs, migrates, guesses, falls back to a nearby
session, or mutates workflow state on either success or failure.

## Contract verification boundary

Future deterministic runtime tests must cover four behavior groups:

- Claude Code and Codex, including custom/MCP tools and nested agents;
- provider-ID deduplication, code-mode wrappers, and continuations;
- atomic snapshots, interval unions, and parallel activity;
- exact/partial/unavailable behavior, manual deletion, and corruption.

These are implementation acceptance groups, not new runtime artifacts or a
live-provider release bureaucracy.
