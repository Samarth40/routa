// Shared types for workspace dashboard components

export interface SessionInfo {
  sessionId: string;
  name?: string;
  cwd: string;
  workspaceId: string;
  provider?: string;
  role?: string;
  acpStatus?: "connecting" | "ready" | "error";
  acpError?: string;
  createdAt: string;
}

export interface TaskInfo {
  id: string;
  title: string;
  objective?: string;
  status: string;
  boardId?: string;
  columnId?: string;
  position?: number;
  priority?: string;
  labels?: string[];
  assignee?: string;
  assignedTo?: string;
  assignedProvider?: string;
  assignedRole?: string;
  assignedSpecialistId?: string;
  assignedSpecialistName?: string;
  triggerSessionId?: string;
  githubId?: string;
  githubNumber?: number;
  githubUrl?: string;
  githubRepo?: string;
  githubState?: string;
  githubSyncedAt?: string;
  lastSyncError?: string;
  sessionId?: string;
  /** Associated codebase IDs for this task */
  codebaseIds?: string[];
  /** Git worktree ID for this task */
  worktreeId?: string;
  createdAt: string;
}

export interface KanbanColumnAutomationInfo {
  enabled: boolean;
  providerId?: string;
  role?: string;
  specialistId?: string;
  specialistName?: string;
}

export interface KanbanColumnInfo {
  id: string;
  name: string;
  color?: string;
  position: number;
  stage: string;
  visible?: boolean;
  automation?: KanbanColumnAutomationInfo;
}

export interface KanbanBoardInfo {
  id: string;
  workspaceId: string;
  name: string;
  isDefault: boolean;
  columns: KanbanColumnInfo[];
  createdAt: string;
  updatedAt: string;
}

export interface BackgroundTaskInfo {
  id: string;
  title: string;
  prompt: string;
  agentId: string;
  status: string;
  triggerSource?: string;
  priority?: string;
  resultSessionId?: string;
  errorMessage?: string;
  attempts: number;
  maxAttempts: number;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  lastActivity?: string;
  currentActivity?: string;
  toolCallCount?: number;
  inputTokens?: number;
  outputTokens?: number;
}

export interface TraceInfo {
  id: string;
  agentName?: string;
  agentRole?: string;
  action?: string;
  summary?: string;
  durationMs?: number;
  createdAt: string;
}

export interface WorktreeInfo {
  id: string;
  codebaseId: string;
  workspaceId: string;
  worktreePath: string;
  branch: string;
  baseBranch: string;
  status: "creating" | "active" | "error" | "removing";
  sessionId?: string;
  label?: string;
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
}
