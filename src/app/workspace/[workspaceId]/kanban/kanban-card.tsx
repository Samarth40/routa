"use client";

import { useState, type DragEvent } from "react";
import type { AcpProviderInfo } from "@/client/acp-client";
import type { CodebaseData } from "@/client/hooks/use-workspaces";
import type { SessionInfo, TaskInfo, WorktreeInfo } from "../types";

interface SpecialistOption {
  id: string;
  name: string;
  role: string;
}

export interface KanbanCardProps {
  task: TaskInfo;
  linkedSession?: SessionInfo;
  availableProviders: AcpProviderInfo[];
  specialists: SpecialistOption[];
  codebases: CodebaseData[];
  allCodebaseIds: string[];
  worktreeCache: Record<string, WorktreeInfo>;
  queuePosition?: number;
  onDragStart: () => void;
  onOpenDetail: () => void;
  onDelete: () => void;
  onPatchTask: (taskId: string, payload: Record<string, unknown>) => Promise<TaskInfo>;
  onRetryTrigger: (taskId: string) => Promise<void>;
  onRefresh: () => void;
}

const ROLE_OPTIONS = ["CRAFTER", "ROUTA", "GATE", "DEVELOPER"];

function getPriorityTone(priority?: string) {
  switch ((priority ?? "medium").toLowerCase()) {
    case "high":
    case "urgent":
      return "bg-rose-100 text-rose-700 ring-1 ring-inset ring-rose-200 dark:bg-rose-900/20 dark:text-rose-300 dark:ring-rose-900/40";
    case "medium":
      return "bg-amber-100 text-amber-800 ring-1 ring-inset ring-amber-200 dark:bg-amber-900/20 dark:text-amber-300 dark:ring-amber-900/40";
    case "low":
      return "bg-emerald-100 text-emerald-700 ring-1 ring-inset ring-emerald-200 dark:bg-emerald-900/20 dark:text-emerald-300 dark:ring-emerald-900/40";
    default:
      return "bg-slate-200 text-slate-700 ring-1 ring-inset ring-slate-200 dark:bg-[#1c1f2e] dark:text-slate-300 dark:ring-white/5";
  }
}

function getSessionTone(sessionStatus?: "connecting" | "ready" | "error", queuePosition?: number) {
  if (queuePosition) {
    return "bg-amber-100 text-amber-700 ring-1 ring-inset ring-amber-200 dark:bg-amber-900/20 dark:text-amber-300 dark:ring-amber-900/40";
  }

  switch (sessionStatus) {
    case "ready":
      return "bg-emerald-100 text-emerald-700 ring-1 ring-inset ring-emerald-200 dark:bg-emerald-900/20 dark:text-emerald-300 dark:ring-emerald-900/40";
    case "error":
      return "bg-rose-100 text-rose-700 ring-1 ring-inset ring-rose-200 dark:bg-rose-900/20 dark:text-rose-300 dark:ring-rose-900/40";
    case "connecting":
      return "bg-sky-100 text-sky-700 ring-1 ring-inset ring-sky-200 dark:bg-sky-900/20 dark:text-sky-300 dark:ring-sky-900/40";
    default:
      return "bg-slate-100 text-slate-600 ring-1 ring-inset ring-slate-200 dark:bg-[#181c28] dark:text-slate-300 dark:ring-white/5";
  }
}

function getStatusLabel(sessionStatus?: "connecting" | "ready" | "error", queuePosition?: number) {
  if (queuePosition) return `Queued #${queuePosition}`;
  if (sessionStatus === "connecting") return "Starting";
  if (sessionStatus === "ready") return "Live";
  if (sessionStatus === "error") return "Failed";
  return "Idle";
}

export function KanbanCard({
  task,
  linkedSession,
  availableProviders,
  specialists,
  codebases,
  allCodebaseIds,
  worktreeCache,
  queuePosition,
  onDragStart,
  onOpenDetail,
  onDelete,
  onPatchTask,
  onRetryTrigger,
  onRefresh,
}: KanbanCardProps) {
  const sessionStatus = linkedSession?.acpStatus;
  const sessionError = linkedSession?.acpError;
  const canRetry = Boolean(task.assignedProvider) && (
    sessionStatus === "error" || (!task.triggerSessionId && task.columnId === "dev")
  ) && !queuePosition;
  const canRun = Boolean(task.assignedProvider) && !task.triggerSessionId && task.columnId !== "done" && !queuePosition;
  const [showAssignment, setShowAssignment] = useState(false);

  const assignedProvider = availableProviders.find((provider) => provider.id === task.assignedProvider);
  const assignedRole = task.assignedRole ?? "DEVELOPER";
  const assignedSpecialist = specialists.find((item) => item.id === task.assignedSpecialistId);
  const priorityTone = getPriorityTone(task.priority);
  const sessionTone = getSessionTone(sessionStatus, queuePosition);
  const statusLabel = getStatusLabel(sessionStatus, queuePosition);
  const automationSourceLabel = assignedProvider ? "Card override" : "Lane default";
  const automationSourceTone = assignedProvider
    ? "bg-violet-100 text-violet-700 ring-1 ring-inset ring-violet-200 dark:bg-violet-900/20 dark:text-violet-300 dark:ring-violet-900/40"
    : "bg-slate-100 text-slate-600 ring-1 ring-inset ring-slate-200 dark:bg-[#181c28] dark:text-slate-300 dark:ring-white/5";
  const executionSummaryParts = assignedProvider
    ? [assignedProvider.name, assignedRole, assignedSpecialist?.name].filter(Boolean)
    : ["Inherited from lane defaults"];
  const executionSummaryText = executionSummaryParts.join(" · ");
  const syncSummary = sessionStatus === "connecting"
    ? "Session starting..."
    : queuePosition
      ? `Queued #${queuePosition}`
      : sessionStatus === "error"
        ? (sessionError ?? "Session failed")
        : task.lastSyncError
          ? task.lastSyncError
          : task.githubSyncedAt
            ? `Synced ${new Date(task.githubSyncedAt).toLocaleString()}`
            : "Not synced";
  const objectiveText = task.objective?.trim() || "No objective captured yet.";

  const stopCardInteraction = (event: { stopPropagation: () => void }) => {
    event.stopPropagation();
  };

  const handleProviderChange = async (providerId: string) => {
    if (providerId) {
      await onPatchTask(task.id, {
        assignedProvider: providerId,
        assignedRole: task.assignedRole ?? "DEVELOPER",
      });
    } else {
      await onPatchTask(task.id, {
        assignedProvider: undefined,
        assignedRole: undefined,
        assignedSpecialistId: undefined,
        assignedSpecialistName: undefined,
      });
    }
    onRefresh();
  };

  const handleDragStart = (event: DragEvent<HTMLDivElement>) => {
    event.dataTransfer.setData("text/plain", task.id);
    event.dataTransfer.effectAllowed = "move";
    onDragStart();
  };

  return (
    <div
      draggable
      onDragStart={handleDragStart}
      onClick={onOpenDetail}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpenDetail();
        }
      }}
      role="button"
      tabIndex={0}
      aria-label={`Open ${task.title}`}
      className="group relative flex cursor-grab flex-col gap-3 rounded-[1.35rem] border border-slate-200/80 bg-white/95 p-3.5 shadow-[0_18px_40px_-28px_rgba(15,23,42,0.45)] transition duration-150 hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-[0_24px_48px_-28px_rgba(15,23,42,0.55)] active:cursor-grabbing focus:outline-none focus:ring-2 focus:ring-amber-400/50 dark:border-[#262938] dark:bg-[#0d1018] dark:shadow-[0_18px_40px_-28px_rgba(0,0,0,0.8)] dark:hover:border-[#34384a]"
      data-testid="kanban-card"
    >
      <div
        className="pointer-events-none absolute left-2.5 top-2.5 rounded-md p-1 text-slate-400 opacity-0 transition-opacity group-hover:opacity-100 dark:text-slate-500"
        title="Drag card"
        aria-label="Drag card"
      >
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6h.01M14 6h.01M10 12h.01M14 12h.01M10 18h.01M14 18h.01" />
        </svg>
      </div>

      <button
        onClick={(event) => {
          event.stopPropagation();
          onDelete();
        }}
        className="absolute right-2.5 top-2.5 rounded-lg p-1 text-red-500 opacity-0 transition-all hover:bg-red-100 hover:text-red-600 group-hover:opacity-100 dark:text-red-400 dark:hover:bg-red-900/20"
        title="Delete task"
        data-testid="kanban-card-delete"
      >
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
        </svg>
      </button>

      <div className="flex items-start justify-between gap-3 pr-6">
        <div className="min-w-0 flex-1">
          <div className="mb-2 flex flex-wrap items-center gap-1.5">
            {task.githubNumber ? (
              <a
                href={task.githubUrl}
                target="_blank"
                rel="noreferrer"
                onClick={stopCardInteraction}
                className="inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700 ring-1 ring-inset ring-amber-200 hover:bg-amber-100 dark:bg-amber-900/20 dark:text-amber-300 dark:ring-amber-900/40"
              >
                Issue #{task.githubNumber}
              </a>
            ) : (
              <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600 ring-1 ring-inset ring-slate-200 dark:bg-[#181c28] dark:text-slate-300 dark:ring-white/5">
                Local issue
              </span>
            )}
            <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] ${sessionTone}`}>
              {statusLabel}
            </span>
          </div>
          <div className="line-clamp-2 text-[15px] font-semibold leading-5 text-slate-900 dark:text-slate-100">
            {task.title}
          </div>
        </div>
        <span className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] ${priorityTone}`}>
          {task.priority ?? "medium"}
        </span>
      </div>

      <p className="line-clamp-3 text-[12px] leading-5 text-slate-600 dark:text-slate-400">{objectiveText}</p>

      {task.labels && task.labels.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {task.labels.map((label) => (
            <span key={label} className="rounded-full bg-amber-100/80 px-2 py-0.5 text-[10px] font-medium text-amber-800 ring-1 ring-inset ring-amber-200 dark:bg-amber-900/20 dark:text-amber-300 dark:ring-amber-900/40">
              {label}
            </span>
          ))}
        </div>
      )}

      {(((task.codebaseIds && task.codebaseIds.length > 0) || allCodebaseIds.length > 0) || task.worktreeId) && (
        <div className="flex flex-wrap gap-1.5">
          {(task.codebaseIds && task.codebaseIds.length > 0 ? task.codebaseIds : allCodebaseIds).map((cbId) => {
            const cb = codebases.find((c) => c.id === cbId);
            return cb ? (
              <span
                key={cbId}
                className="inline-flex items-center gap-1 rounded-full bg-violet-100/90 px-2 py-0.5 text-[10px] font-medium text-violet-700 ring-1 ring-inset ring-violet-200 dark:bg-violet-900/20 dark:text-violet-300 dark:ring-violet-900/40"
                data-testid="repo-badge"
              >
                <span className="h-1.5 w-1.5 rounded-full bg-violet-500" />
                {cb.label ?? cb.repoPath.split("/").pop() ?? cb.repoPath}
              </span>
            ) : (
              <span key={cbId} className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-medium text-red-600 ring-1 ring-inset ring-red-200 dark:bg-red-900/20 dark:text-red-400 dark:ring-red-900/40" title="Repository no longer available">
                ⚠ repo missing
              </span>
            );
          })}
          <WorktreeBadge task={task} worktreeCache={worktreeCache} onOpenDetail={onOpenDetail} stopCardInteraction={stopCardInteraction} />
        </div>
      )}

      <div className="rounded-2xl border border-slate-200/80 bg-slate-50/80 p-2.5 dark:border-[#262938] dark:bg-[#10131b]">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-400 dark:text-slate-500">
                Automation
              </div>
              <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${automationSourceTone}`}>
                {automationSourceLabel}
              </span>
            </div>
            <div className="mt-1.5 text-[12px] font-medium text-slate-700 dark:text-slate-200">
              {executionSummaryText}
            </div>
          </div>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              setShowAssignment((current) => !current);
            }}
            className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[10px] font-medium text-slate-600 transition hover:bg-slate-100 dark:border-gray-700 dark:bg-[#151826] dark:text-slate-300 dark:hover:bg-[#1b1e2b]"
          >
            {showAssignment ? "Done" : "Edit"}
          </button>
        </div>
        <div className="mt-2 flex items-center gap-2">
          <label className="flex min-w-0 flex-1 items-center gap-2 rounded-xl border border-slate-200 bg-white px-2.5 py-2 shadow-sm dark:border-gray-700 dark:bg-[#12141c]">
            <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500">
              Provider
            </span>
            <select
              value={task.assignedProvider ?? ""}
              disabled={availableProviders.length === 0}
              onMouseDown={stopCardInteraction}
              onClick={stopCardInteraction}
              onChange={(event) => {
                void handleProviderChange(event.target.value);
              }}
              className="min-w-0 flex-1 truncate bg-transparent text-[11px] font-medium text-slate-700 outline-none disabled:opacity-50 dark:text-slate-200"
              aria-label={`ACP provider for ${task.title}`}
              data-testid="kanban-card-acp-select"
            >
              <option value="">Use lane default</option>
              {availableProviders.map((provider) => (
                <option key={provider.id} value={provider.id}>
                  {provider.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        {showAssignment && (
          <AssignmentSection
            task={task}
            specialists={specialists}
            stopCardInteraction={stopCardInteraction}
            onPatchTask={onPatchTask}
            onRefresh={onRefresh}
          />
        )}

        <div className="mt-2 flex items-center justify-between gap-2 border-t border-slate-200/80 pt-2 dark:border-[#262938]">
          <div className="min-w-0 truncate text-[11px] text-slate-500 dark:text-slate-400">
            {syncSummary}
          </div>
          {(canRun || canRetry) && (
            <button
              onClick={() => void onRetryTrigger(task.id)}
              onClickCapture={stopCardInteraction}
              className={`shrink-0 rounded-full px-3 py-1 text-[11px] font-medium ${
                canRetry
                  ? "border border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100 dark:border-amber-800/50 dark:bg-amber-900/10 dark:text-amber-300"
                  : "border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:border-emerald-800/50 dark:bg-emerald-900/10 dark:text-emerald-300"
              }`}
            >
              {canRetry ? "Rerun" : "Run"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

interface WorktreeBadgeProps {
  task: TaskInfo;
  worktreeCache: Record<string, WorktreeInfo>;
  onOpenDetail: () => void;
  stopCardInteraction: (event: { stopPropagation: () => void }) => void;
}

function WorktreeBadge({ task, worktreeCache, onOpenDetail, stopCardInteraction }: WorktreeBadgeProps) {
  if (!task.worktreeId) return null;

  const wt = worktreeCache[task.worktreeId];
  if (!wt) {
    return (
      <div className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-500 ring-1 ring-inset ring-slate-200 dark:bg-[#181c28] dark:text-slate-400 dark:ring-white/5">
        Loading worktree...
      </div>
    );
  }

  const wtBadgeColor = wt.status === "active"
    ? "bg-emerald-100 text-emerald-700 ring-1 ring-inset ring-emerald-200 dark:bg-emerald-900/20 dark:text-emerald-300 dark:ring-emerald-900/40"
    : wt.status === "creating"
      ? "bg-amber-100 text-amber-700 ring-1 ring-inset ring-amber-200 dark:bg-amber-900/20 dark:text-amber-300 dark:ring-amber-900/40"
      : "bg-rose-100 text-rose-700 ring-1 ring-inset ring-rose-200 dark:bg-rose-900/20 dark:text-rose-300 dark:ring-rose-900/40";

  return (
    <button
      onClick={onOpenDetail}
      onClickCapture={stopCardInteraction}
      className="inline-flex items-center gap-1.5 rounded-full bg-white px-2 py-0.5 ring-1 ring-inset ring-slate-200 transition hover:bg-slate-50 dark:bg-[#151826] dark:ring-white/5 dark:hover:bg-[#1b1e2b]"
      title="Click to view worktree details"
      data-testid="worktree-badge"
    >
      <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${wtBadgeColor}`}>
        {wt.status}
      </span>
      <span className="max-w-30 truncate text-[10px] text-slate-500 dark:text-slate-400">{wt.branch}</span>
    </button>
  );
}

interface AssignmentSectionProps {
  task: TaskInfo;
  specialists: SpecialistOption[];
  stopCardInteraction: (event: { stopPropagation: () => void }) => void;
  onPatchTask: (taskId: string, payload: Record<string, unknown>) => Promise<TaskInfo>;
  onRefresh: () => void;
}

function AssignmentSection({
  task,
  specialists,
  stopCardInteraction,
  onPatchTask,
  onRefresh,
}: AssignmentSectionProps) {
  return (
    <div className="mt-2 space-y-2 border-t border-slate-200/80 pt-2 dark:border-[#262938]">
      {!task.assignedProvider && (
        <div className="rounded-xl border border-dashed border-slate-200 bg-white/80 px-3 py-2 text-[11px] text-slate-500 dark:border-gray-700 dark:bg-[#10131a] dark:text-gray-400">
          Select a provider above only if this card needs to override the lane default.
        </div>
      )}

      {task.assignedProvider && (
        <div className="flex items-center gap-2">
          <span className="w-16 shrink-0 text-[10px] font-medium text-slate-500 dark:text-gray-400">Role</span>
          <select
            value={task.assignedRole ?? "DEVELOPER"}
            onClick={stopCardInteraction}
            onChange={async (event) => {
              await onPatchTask(task.id, { assignedRole: event.target.value });
              onRefresh();
            }}
            className="flex-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] text-slate-700 dark:border-gray-700 dark:bg-[#12141c] dark:text-slate-200"
          >
            {ROLE_OPTIONS.map((role) => (
              <option key={role} value={role}>{role}</option>
            ))}
          </select>
        </div>
      )}

      {task.assignedProvider && (
        <div className="flex items-center gap-2">
          <span className="w-16 shrink-0 text-[10px] font-medium text-slate-500 dark:text-gray-400">Specialist</span>
          <select
            value={task.assignedSpecialistId ?? ""}
            onClick={stopCardInteraction}
            onChange={async (event) => {
              const specialist = specialists.find((item) => item.id === event.target.value);
              await onPatchTask(task.id, {
                assignedSpecialistId: event.target.value || undefined,
                assignedSpecialistName: specialist?.name ?? undefined,
                assignedRole: specialist?.role ?? task.assignedRole,
              });
              onRefresh();
            }}
            className="min-w-0 flex-1 truncate rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] text-slate-700 dark:border-gray-700 dark:bg-[#12141c] dark:text-slate-200"
          >
            <option value="">None</option>
            {specialists.map((specialist) => (
              <option key={specialist.id} value={specialist.id}>
                {specialist.name}
              </option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
}
