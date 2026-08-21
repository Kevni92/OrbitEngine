# 10 — Task Types and Agent Routing

OrbitEngine uses three explicit issue task types to separate architectural reasoning from routine implementation and exploratory work.

Every issue must contain exactly one authoritative body marker near the top:

```text
Task Type: Architecture
```

```text
Task Type: Implementation
```

```text
Task Type: Spike
```

Issue templates also use distinct title prefixes (`[ARCH]`, `[IMPL]`, `[SPIKE]`). Matching GitHub labels should mirror the type when available, but labels and titles are supplemental only. Agents must route from the body marker.

## Architecture

### Purpose

Use Architecture when the task requires a durable system-design decision rather than straightforward execution.

Typical examples:

- defining physical-state ownership and invariants;
- selecting propagation or numerical-integration strategies;
- defining reference-frame architecture;
- deciding TypeScript/C++ boundary contracts;
- designing fidelity promotion/demotion rules;
- designing encounter indexing or event scheduling;
- changing subsystem responsibilities or public API semantics.

### Execution authority

Architecture issues may be executed only in the ChatGPT Architecture Project/session.

Local/cloud coding agents must refuse them. They must not create a branch or make repository changes for an Architecture issue.

### Expected output

An Architecture issue should converge on a decision that implementation agents can follow. Depending on scope, the result should include:

- problem and constraints;
- selected approach;
- meaningful alternatives and rejected trade-offs;
- invariants and subsystem responsibilities;
- public/internal contracts and data ownership;
- numerical/performance implications where relevant;
- documentation/ADR-like updates;
- follow-up Implementation issues when code work is required.

Architecture work that changes repository content follows the normal issue → clean `main` → branch → validation → PR with `Closes #...` → CI → merge workflow.

## Implementation

### Purpose

Use Implementation when the architecture is already sufficiently decided and the remaining task is primarily execution.

Typical examples:

- implementing a specified value type or interface;
- adding tests for documented behavior;
- wiring an already-designed backend adapter;
- implementing a defined parser or importer;
- refactoring toward an explicitly documented contract;
- adding build/CI configuration from a known specification.

### Execution authority

Implementation issues are intended for local Codex/coding agents.

ChatGPT is responsible for discussing, refining, and creating these issues so they are implementation-ready. The issue should minimize architectural freedom where correctness depends on a specific design.

### Architecture escalation

If a coding agent discovers that an Implementation issue cannot be completed correctly without a non-trivial unresolved architecture decision, it must stop before making that decision.

It must report:

1. the exact missing decision;
2. why the current issue/docs do not answer it;
3. which implementation choices depend on it;
4. any factual constraints already discovered.

The decision is then handled in the ChatGPT Architecture Project/session. Codex must not silently choose a design merely to complete the task.

### Expected issue quality

A good Implementation issue normally contains:

- goal and scope;
- relevant architecture/docs references;
- explicit required behavior;
- interfaces/contracts that must be preserved;
- non-goals;
- edge cases and numerical tolerances where relevant;
- tests/validation required;
- acceptance criteria.

## Spike

### Purpose

Use Spike when uncertainty must be reduced through research, experimentation, benchmarking, or a disposable prototype before a durable decision can be made.

Typical examples:

- comparing integrator performance/accuracy;
- validating Node-API and Emscripten compatibility around one C++ abstraction;
- benchmarking data layouts for large asteroid catalogs;
- testing a candidate ephemeris-data format;
- exploring an API/library whose suitability is unknown.

### Execution authority

Spikes may be executed in ChatGPT or by local/cloud coding agents.

When a local/cloud coding agent detects `Task Type: Spike`, it must ask the user for explicit confirmation once before beginning substantive work or modifying the repository.

### Expected output

A Spike should separate:

- question or hypothesis;
- experiment/investigation;
- observations and measured results;
- limitations;
- recommendation, if supported;
- unresolved questions;
- suggested follow-up Architecture or Implementation issues.

A Spike does not itself silently establish production architecture. Architecture must adopt consequential design decisions explicitly.

## Classification guide

Use the simplest classification that matches the actual uncertainty:

- **Can the agent implement this from existing contracts without making a consequential design decision?** → Implementation.
- **Is a consequential design decision itself the task?** → Architecture.
- **Do we first need evidence to know which design or technology is viable?** → Spike.

When in doubt between Architecture and Implementation, classify as Architecture until the missing decisions are resolved. When in doubt because feasibility/evidence is missing, classify as Spike.

## Issue creation rules

Issues are normally discussed and made implementation-ready in ChatGPT before creation.

When creating an issue:

1. choose exactly one task type;
2. use the matching issue template/title prefix;
3. keep the authoritative `Task Type` marker unchanged;
4. apply the matching GitHub label if that label exists;
5. make acceptance criteria objective enough for another agent to determine completion;
6. do not put `Closes #...` in the issue — the implementing PR carries the closing keyword.
