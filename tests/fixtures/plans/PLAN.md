# Catalog export implementation

## Approach
Add a serializer, then wire it into the existing command.

## Technical decisions
Reuse the catalog module and built-in Node test runner.

## Dependency graph
- NT-001-01: none
- NT-001-02: NT-001-01

## Execution order
1. NT-001-01
2. NT-001-02

## Task index
- NT-001-01: Verified serializer.
- NT-001-02: Command integration.

## Final validation
- AC-3: Run `npm test` and `npm run check`; all existing and new tests pass. Retain fresh command output after the final task.
