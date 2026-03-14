---
title: "Kanban automation can overrun limited ACP provider capacity without queueing"
date: "2026-03-14"
status: open
severity: high
area: "kanban"
tags: ["kanban", "automation", "queue", "concurrency", "acp"]
reported_by: "codex"
related_issues:
  - https://github.com/phodal/routa/issues/148
---

# Kanban automation can overrun limited ACP provider capacity without queueing

## What Happened

Kanban card creation and column automation can start ACP coding sessions immediately without any board-level concurrency control. When multiple cards are created or auto-advanced close together, Routa may attempt to launch more ACP sessions than the configured provider capacity can handle.

## Expected Behavior

Kanban should expose an explicit queueing mechanism and a configurable concurrency limit so only a bounded number of ACP sessions run at once, while additional cards wait in queue and start later.

## Reproduction Context

- Environment: web
- Trigger: create or auto-advance multiple Kanban cards while column automation is enabled for a limited ACP provider

## Why This Might Happen

- Kanban automation currently creates sessions directly from `triggerAssignedTaskAgent` without a queue coordinator.
- Board settings expose column automation rules, but there is no board-level session concurrency limit or queued/running state for cards.

## Relevant Files

- `src/core/kanban/agent-trigger.ts`
- `src/core/kanban/workflow-orchestrator.ts`
- `src/core/kanban/workflow-orchestrator-singleton.ts`
- `src/core/models/kanban.ts`
- `src/core/models/task.ts`
- `src/app/workspace/[workspaceId]/kanban/kanban-settings-modal.tsx`
- `src/app/workspace/[workspaceId]/kanban/kanban-tab.tsx`

## Observations

- The session detail page already has local task queue handling for CRAFTER execution, so there is precedent for sequential dispatch.
- Kanban automation currently tracks active automations per card, but not provider capacity or pending queue order.

## References

- Local implementation task requested by user on 2026-03-14
