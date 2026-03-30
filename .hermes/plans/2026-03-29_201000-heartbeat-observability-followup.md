# Heartbeat Observability Follow-up Plan

Status: in progress
Date: 2026-03-29 20:10 local
Repo: /Users/eru/Documents/GitHub/paperclip
Primary skills: systematic-debugging, paperclip-disciplined-slice-delivery, writing-plans

## Goal
Fix the remaining observability mismatch where a wakeup/requested heartbeat is visible in run or activity evidence but agent-facing read models still look stale because they only expose `lastHeartbeatAt`.

## Current context
Just completed and committed:
- 2906342b fix: govern hermes validation helper paths

Observed product gap carried over from earlier live dogfood evidence:
- wakeup / execution evidence can exist before or alongside actual run execution state changes
- agent-facing read models and UI primarily expose only `lastHeartbeatAt`
- that means users can see a planner run / wakeup evidence path while the agent list/settings still read as stale or ambiguous

Current code findings:
- `lastHeartbeatAt` is updated when a run starts and again when it finalizes in `server/src/services/heartbeat.ts`
- `lastHeartbeatAt` is not updated when a wakeup is merely queued, deferred, or coalesced
- `packages/shared/src/types/agent.ts` and `packages/shared/src/types/heartbeat.ts` expose only heartbeat timing, not last wakeup request timing/status
- agent list and instance heartbeat settings UI render `lastHeartbeatAt` directly with no distinction between:
  - last actual run heartbeat transition
  - last wakeup request / queued execution attempt

## Root-cause hypothesis
The bug is not that `lastHeartbeatAt` is wrong; it is that the read model is incomplete.

Specifically:
- `lastHeartbeatAt` currently behaves like “last actual run lifecycle transition”
- users also need “latest wakeup request/request state” observability
- without that second field, the UI appears stale even when Paperclip has queued/coalesced/deferred work correctly

## Proposed narrow slice
Add a derived latest wakeup observability surface without changing the meaning of `lastHeartbeatAt`.

### Server
- Extend agent-facing read models with derived wakeup metadata from latest `agentWakeupRequests` row per agent:
  - `lastWakeupRequestedAt`
  - `lastWakeupStatus`
  - optional `lastWakeupReason`
- Hydrate that data for:
  - company agent list
  - single-agent fetch
  - instance heartbeat settings agent list

### Shared types
- Extend shared Agent / InstanceSchedulerHeartbeatAgent types to include the new derived fields.

### UI
- Keep `lastHeartbeatAt` labeled as heartbeat/run timing.
- Add a compact wakeup-status indicator so queued/deferred/coalesced activity is visible and no longer looks stale.
- On scheduler/instance settings page, show wakeup state next to the existing heartbeat timing.
- On agent list page, show recent wakeup state when present.

## Files likely to change
- packages/shared/src/types/agent.ts
- packages/shared/src/types/heartbeat.ts
- server/src/services/agents.ts
- server/src/routes/agents.ts
- server/src/__tests__/heartbeat-verification-output.test.ts
- possibly a new focused server test around agent read-model hydration
- ui/src/pages/Agents.tsx
- ui/src/pages/InstanceSettings.tsx
- ui/src/api/agents.ts if required by type imports only

## Investigation / implementation order
1. Reconfirm clean repo state except local plan/tmp artifacts.
2. Add failing/coverage tests first for the server read-model gap.
3. Implement latest wakeup-request hydration on server.
4. Extend shared types.
5. Update UI rendering to distinguish heartbeat timing vs wakeup timing/status.
6. Run targeted server tests.
7. Run broader `pnpm build`.
8. Browser-validate one fresh wakeup/issue flow showing the new observability.
9. Commit the slice immediately.

## Validation plan
### Targeted
- relevant heartbeat / agent route/service tests
- existing `heartbeat-verification-output.test.ts`

### Broader
- `pnpm build`

### Live/browser
- trigger one fresh wakeup-backed agent run or issue-backed execution
- verify UI shows:
  - accurate `lastHeartbeatAt`
  - separate recent wakeup request status/time
  - no stale-looking agent row when work was just queued/requested

## Done criteria
- root cause confirmed via code evidence
- read model extended without redefining `lastHeartbeatAt`
- UI shows both heartbeat and wakeup observability clearly
- targeted tests pass
- full build passes
- live/browser validation confirms the stale-observability confusion is resolved
- slice committed separately
