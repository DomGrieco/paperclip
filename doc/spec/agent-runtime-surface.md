# Agent Runtime Surface Spec

Status: Draft  
Date: 2026-03-21  
Audience: Product + Engineering  
Scope: Runtime policy resolution, context bundling, memory recall, and tool-specific projections for coding agents

## 1. Document Role

This spec defines how Paperclip prepares execution context for coding runtimes.

- `doc/spec/feature-1-hierarchical-orchestration.md` defines when runs are created and how they progress.
- This document defines what a run receives: resolved policy, runtime files, memory recall, secrets handling, and tool-specific projections.
- `doc/spec/hermes-fleet-control-plane.md` defines how these runtime-surface concepts apply to a fleet of specialized Hermes workers with isolated homes, shared-context governance, and runner-plane execution.

## 2. Supported Runtime Targets

The first-class runtime targets for the new architecture are:

- `codex`
- `cursor`
- `opencode`
- `hermes`
- `pi` (planned long-term canonical worker harness)

`claude` support is legacy/non-priority.
It may remain for compatibility, but it must not shape the architecture, file layout, or abstraction boundaries.

`hermes` is the first-class runtime target for long-lived specialist workers that need:
- native tools
- local memory and skills
- session continuity across heartbeats
- controlled shared-context recall packets from Paperclip

## 3. Source Of Truth And Resolution Model

Paperclip is the management source of truth.
The runtime surface is resolved centrally, then materialized into the execution workspace for the coding runtime.

### 3.1 Config hierarchy

Effective runtime context resolves in this order:

1. company defaults
2. agent overrides
3. project-level operating context
4. issue-level overrides
5. run-specific overrides

The resolved result should be snapshotted per run so execution remains auditable and reproducible even if upstream config changes later.

### 3.2 Resolved policy surface

The effective bundle may include:

- skills
- project rules
- agent hooks
- tool / MCP bindings
- evidence policy
- TDD policy
- memory bindings
- runner constraints
- runtime-specific execution preferences

## 4. Canonical Runtime Bundle

Paperclip should maintain one canonical internal runtime bundle, then project it into runtime-specific files and conventions.

### 4.1 Canonical bundle responsibilities

The canonical bundle should be able to express:

- resolved instructions and operating rules
- task and issue context
- project operating context
- memory recall packet
- tool / MCP inventory
- runner metadata
- verification expectations
- evidence requirements

### 4.2 Workspace materialization

At execution time, Paperclip should materialize the bundle into a Paperclip-native tree inside the workspace.
Example conceptual layout:

- `.paperclip/runtime/`
- `.paperclip/context/`
- `.paperclip/memory/`
- `.paperclip/policies/`

This tree is for introspection, debugging, and stable internal structure.
It should not be the only surface the coding runtime sees.

## 5. Tool-Specific Projections

Different runtimes expect different file layouts, instruction conventions, and hook surfaces.
Paperclip should generate projections from the canonical bundle for the active runtime.

Examples:

- `codex`: skills, prompt/instructions, hook-compatible files, environment variables, API access
- `cursor`: workspace-facing rule and context projections aligned with Cursor conventions
- `opencode`: runtime-facing rules/hooks/context in the locations the tool expects
- `hermes`: Paperclip-governed runtime bundle, recall packet, env contract, and workspace bindings projected into a Hermes-compatible execution surface
- `pi`: future native projection aligned with Pi's session and tool surface

The projection layer exists so Paperclip can remain consistent internally while still meeting each runtime where it actually works.

## 6. Minimum Worker Startup Context

For Feature 1, a worker run should not start with only a task and repo.
The required baseline context is:

- task / issue / comment context
- repo / workspace context
- project operating context
- resolved rules / skills / hooks / tool bindings
- memory recall packet

This is the smallest context bundle that matches the intended quality bar for autonomous software work.

## 7. Memory Recall Contract

Workers should receive scoped memory, not an unstructured dump.

### 7.1 Recall packet requirements

A recall packet should carry:

- scope information (company, project, issue, run, agent as applicable)
- the recalled content
- provenance references
- freshness metadata
- optional ranking or confidence metadata

### 7.2 Design constraints

- memory must remain company-scoped
- memory should be inspectable and auditable
- Paperclip owns binding, provenance, and governance
- providers own storage, extraction, ranking, and retrieval strategy

This aligns with the direction laid out in `doc/memory-landscape.md` while keeping the runtime surface small.

## 8. Secrets And Live Credentials

Secrets should not be copied broadly into runtime files unless there is a clear reason.

Default rule:

- static runtime context goes into the bundle
- sensitive values go through env injection, runner-side mounts, or other scoped delivery
- bootstrap/import sources should be consumed during runtime preparation and omitted from the steady-state worker contract once equivalent managed state has been materialized

This keeps workspaces useful to coding agents without turning them into uncontrolled secret dumps.

## 9. Runtime Policy Defaults

The runtime surface must carry these defaults for software work:

- TDD is the default operating mode
- evidence expectations are inherited from hierarchical policy
- verification requirements are visible to workers before implementation starts
- runner constraints are visible before work is delegated

The goal is to make the desired behavior part of resolved runtime context, not merely an informal prompt preference.

## 10. Monorepo And Service Boundary Assumption

The runner system may be a separate service/process boundary, but it still lives in the same Paperclip monorepo.
Paperclip should share contracts and types across the monorepo while preserving a clean boundary between control plane and execution plane.

## 11. Reference Inputs

This runtime model should explicitly borrow from:

- [Pi coding agent](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent): extensible worker harness and session model
- [PageIndex](https://github.com/VectifyAI/PageIndex): long-document retrieval and inspectable contextual recall
- [Google Workspace CLI](https://github.com/googleworkspace/cli): later connector shape for enterprise extensions

These references should inform the design without becoming hard dependencies for Feature 1.
