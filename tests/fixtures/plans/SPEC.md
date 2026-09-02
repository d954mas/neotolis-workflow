# Catalog export

## Outcome
Partners receive a deterministic catalog export.

## Scope
Export existing products; no catalog editing or new dependency.

## Requirements
Preserve Unicode product names and stable catalog order.

## Constraints
Use the repository's Node 24 ESM runtime.

## Acceptance criteria
- AC-1: Serialization preserves Unicode names and stable order.
- AC-2: The command writes the serialized catalog and exits successfully.
- AC-3: The existing catalog command and export work together without regressions.
