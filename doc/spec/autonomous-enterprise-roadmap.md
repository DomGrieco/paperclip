# Autonomous Enterprise Program Roadmap

Status: Draft  
Date: 2026-03-21  
Audience: Product + Engineering  
Scope: Dependency-ordered roadmap for Paperclip's autonomous-enterprise program

## 1. Document Role

This document maps the approved program into a dependency-driven build sequence.

- `doc/SPEC.md` remains the umbrella architecture and long-horizon vision.
- `doc/SPEC-implementation.md` remains the current V1 baseline contract.
- This document defines the next major implementation program, the reference systems that inform it, and the order the work should land.

## 2. Primary Program Target

The primary target is an autonomous software company running on Paperclip:

1. Paperclip models company structure, work, policy, memory bindings, approvals, budgets, and evidence.
2. Paperclip agents act as orchestrators, not just direct runtime wrappers.
3. Software issues execute through planner, worker, and verification runs.
4. Work becomes reviewable through attached proof, not only status changes.
5. Human governance stays available throughout the system.

Broader enterprise automation remains part of the umbrella architecture, but as a later extension layer rather than the first delivery target.

## 3. Reference Systems

Paperclip should treat the following repos as named design inputs.
They are references, not product dependencies by default.

| Reference | What Paperclip should borrow |
| --- | --- |
| [Longshot](https://github.com/Blastgits/longshot) | swarm shape, bounded planner/worker delegation, task slicing, result reconciliation |
| [OpenAI Symphony](https://github.com/openai/symphony) | orchestration discipline, proof-of-work review bundles, evaluator summaries, durable review artifacts |
| [Pi coding agent](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent) | long-term worker harness, runtime extensibility, session model, tool conventions |
| [PageIndex](https://github.com/VectifyAI/PageIndex) | long-document retrieval, explainable knowledge recall, inspectable document context |
| [Google Workspace CLI](https://github.com/googleworkspace/cli) | later connector surface for enterprise operations |
| [OpenSandbox](https://github.com/alibaba/OpenSandbox) | candidate backend for self-hosted/local-first sandbox runners |
| [autoresearch](https://github.com/karpathy/autoresearch) / [pi-autoresearch](https://github.com/davebcn87/pi-autoresearch) | deferred self-improvement and R&D loops |

## 4. Program-Wide Design Constraints

These constraints apply across the full program:

- local-first and self-hosted by default
- Paperclip app container remains control plane, not the sandbox
- runners are separate service/process boundaries, but remain inside the same monorepo
- evidence policy is hierarchical and configurable at `company -> agent -> issue`
- default software evidence policy is `code + CI + evaluator summary`
- human-facing artifacts are policy-driven, not universally required
- TDD is the default execution policy for software work
- config is managed in Paperclip and materialized into runtime files for coding agents
- runtime projections target `codex`, `cursor`, `opencode`, and later `pi`
- `claude` is legacy/non-priority and should not shape the architecture

## 5. Program Sequence

The work should land as a dependency chain, not as parallel architecture tracks.

### 5.1 Feature 1: Hierarchical orchestration run graph

This is the architectural center.
Paperclip must durably model planner, worker, verification, retries, and evidence-bearing run state before the rest of the program can attach cleanly.

Primary output:

- issue-rooted run graph with planner, worker, and verification run types
- bounded parallel worker fan-out
- automatic repair loops
- review-ready evidence return path

See: `doc/spec/feature-1-hierarchical-orchestration.md`

### 5.2 Feature 2: Runner and sandbox plane

Once the run graph exists, Paperclip needs isolated execution:

- local/self-hosted runners
- browser-capable verification sandboxes
- artifact production and upload
- runner lifecycle and failure handling

This layer should stay backend-agnostic so Paperclip can support different sandbox implementations later.

### 5.3 Feature 3: Runtime bundle and agent operating surface

After runs and runners exist, the system needs a stable way to prepare worker context:

- policy resolution
- rules, skills, hooks
- MCP/tool bindings
- runtime bundle generation
- tool-specific projections

See: `doc/spec/agent-runtime-surface.md`

### 5.4 Feature 4: Memory and knowledge fabric

Once workers can run reliably, improve contextual quality:

- scoped recall packets
- provenance-rich memory reads/writes
- inspectable memory browsing
- long-document retrieval

This phase should deepen reasoning quality without destabilizing the orchestration core.

### 5.5 Feature 5: Enterprise connectors and operating systems

Only after the software-company loop is solid should Paperclip expand into broader business operations:

- email, docs, spreadsheets, calendar, storage
- external business workflow connectors
- non-software autonomous operating patterns

## 6. Explicit Deferrals

The following are intentionally deferred from the first major implementation horizon:

- unconstrained recursive swarm trees
- cloud-first runner fleet management
- broad enterprise-automation execution targets
- self-improving research loops
- advanced org redesign / self-hiring autonomy beyond the current company model

## 7. Completion Standard For The First Program Milestone

The first program milestone is complete only when Paperclip can reliably take a software issue through:

1. planner-led decomposition
2. bounded worker execution
3. verification with evaluator summary
4. policy-driven repair retries
5. evidence attachment back to the issue
6. clear review-ready terminal state for human oversight

That is the smallest complete loop that proves the architecture is working.
