# Hermes Auth Profiles Spec

Status: Draft
Date: 2026-03-23
Audience: Product + Engineering
Scope: Shared provider-auth reuse for Hermes workers under Paperclip with isolated per-agent state

## 1. Purpose

This document defines how Paperclip should support Hermes provider authentication reuse across many Hermes workers without forcing each worker/container to re-authenticate from scratch.

The immediate need is local-first reuse of already-configured Hermes auth (for example Codex auth stored in `~/.hermes/auth.json`).

## 2. Core Decision

Provider auth for Hermes should be configured once and reused.

But Hermes worker-local state must remain isolated.

Therefore the architecture must split Hermes runtime state into:
- shared auth profile data
- per-agent private Hermes runtime state

## 3. State Layers

### 3.1 Shared Hermes auth profile

This layer contains durable provider login/auth artifacts that should be reused across workers.

Examples:
- `auth.json`
- selected provider config
- shared provider-related `.env` values when intentionally allowed
- optional runtime config defaults that are safe to share

### 3.2 Per-agent Hermes runtime state

This layer is private to a single Hermes worker/profile.

Examples:
- session DB / conversation history
- local memories
- local skills
- checkpoints
- per-project state

### 3.3 Paperclip-managed scoped secrets/context

This layer is owned by Paperclip and injected per run.

Examples:
- `PAPERCLIP_API_KEY`
- runtime bundle paths
- issue/project/company IDs
- policy flags
- project/company secrets

## 4. Why a split model is required

If all Hermes workers share one complete `HERMES_HOME`, then:
- sessions bleed across agents
- memories and skills contaminate each other
- project specialization degrades
- auditability becomes worse

If every Hermes worker authenticates separately, then:
- setup is repetitive and fragile
- 24/7 autonomy is harder
- provider auth becomes an operational bottleneck

So the right model is:
- shared auth
- isolated worker state

## 5. Local-first implementation target

For the current local Dockerized Paperclip setup, the first implementation target is:

1. mount the host Hermes home into the Paperclip server container as a read-only auth source
2. for each Hermes worker run, create/use a private worker `HERMES_HOME`
3. copy selected shared-auth files from the mounted source into the worker `HERMES_HOME`
4. run Hermes with `HERMES_HOME` pointed at the private worker home

This gives:
- one-time auth on the host machine
- reusable auth inside the Paperclip Docker runtime
- isolated worker sessions/memories

## 6. Shared auth source

Default local source path:
- host: `${HOME}/.hermes`
- container mount: `/paperclip/shared/hermes-home-source`

This source should be mounted read-only.

## 7. Worker Hermes home

Each Hermes run should use a worker-local Hermes home rooted under the agent-managed workspace/home.

Example:
- `/paperclip/instances/default/workspaces/<agent-id>/hermes-home`

Paperclip should set:
- `HERMES_HOME=<worker-home>`

This worker home becomes the private writable state area.

## 8. What gets copied from shared auth source

Initial local-first file allowlist:
- `auth.json`
- `.env` (optional and policy-sensitive; include only when intentionally desired)
- `config.yaml` (optional; include only if needed for provider/runtime behavior)

Do not copy by default:
- sessions
- state DB
- memories
- skills
- checkpoints
- browser screenshots
- cron jobs
- logs

Recommended v1 default behavior:
- copy `auth.json`
- optionally copy `.env` and `config.yaml` when present
- never copy sessions/memory/state DB

## 9. Auth profile abstraction in Paperclip

Long-term, Paperclip should model this explicitly as a reusable auth profile instead of only a filesystem convention.

Suggested entity shape:
- `id`
- `name`
- `description`
- `providerCapabilities`
- `sourceType` (`local_fs`, `secret_bundle`, later `remote_runner_profile`)
- `sourcePath` or managed ref
- `allowedCompanyIds`
- `allowedProjectIds`
- `allowedAgentIds` / role classes
- metadata / timestamps

But the initial local implementation can ship without a DB table if the behavior is otherwise clear and testable.

## 10. Security constraints

- shared auth source should be mounted read-only
- worker home should be writable and private
- Paperclip must not silently merge all worker state into one shared home
- profile reuse must be explicit and auditable
- future higher-trust and lower-trust worker groups should support separate auth profiles

## 11. Runtime behavior contract

Before Hermes execution, Paperclip should:

1. resolve worker-local Hermes home path
2. ensure it exists
3. sync allowed shared-auth files from the mounted source
4. inject `HERMES_HOME` into the Hermes runtime env
5. inject Paperclip run-specific env separately
6. materialize the runtime bundle into the worker workspace/home

## 12. Codex-specific local-first goal

The first proof point for this system is:
- Codex auth already stored in host `~/.hermes/auth.json`
- Paperclip Docker container mounts host `~/.hermes` read-only
- Hermes worker run gets a private `HERMES_HOME`
- Paperclip copies `auth.json` into that private worker home
- Hermes can reuse the existing Codex auth without re-login

Important nuance:
- shared auth alone is not enough if the worker model/provider configuration still points at the wrong provider
- for example, a worker defaulting to `anthropic/claude-sonnet-4` will still fail even if Codex auth is present
- Paperclip must eventually align Hermes default model/provider selection with the active shared auth profile or make the operator choose explicitly

## 13. Validation standard

A Hermes auth-profile slice is not done until:
- local Docker Paperclip still boots
- Hermes environment test succeeds or degrades clearly when auth is intentionally unavailable
- browser validation confirms Hermes agent configuration still works in the Paperclip UI
- worker-local Hermes home remains isolated from other workers
- shared auth source is not writable by the worker runtime

## 14. Future extensions

Later enhancements can add:
- first-class auth profile DB tables and UI
- multiple named auth profiles
- company/project-scoped auth profile assignment
- remote runner auth profile syncing
- selective provider-specific auth discovery surfaced in Paperclip UI
- dynamic Hermes model/provider discovery based on the active auth profile
