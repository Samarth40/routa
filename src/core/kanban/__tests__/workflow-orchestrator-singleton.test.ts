import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createInMemorySystem } from "../../routa-system";
import { getHttpSessionStore } from "../../acp/http-session-store";
import {
  getWorkflowOrchestrator,
  resetWorkflowOrchestrator,
  startWorkflowOrchestrator,
} from "../workflow-orchestrator-singleton";
import { getInternalApiOrigin } from "../agent-trigger";

describe("workflow orchestrator singleton prompt path", () => {
  beforeEach(() => {
    resetWorkflowOrchestrator();
  });

  afterEach(() => {
    resetWorkflowOrchestrator();
  });

  it("sends recovery prompt via agent tools when routa agent session exists", async () => {
    const system = createInMemorySystem();
    const createAgentResult = await system.tools.createAgent({
      name: "watchdog-test-agent",
      role: "ROUTA",
      workspaceId: "default",
    });
    expect(createAgentResult.success).toBe(true);
    const sessionAgentId = (createAgentResult.data as { agentId: string }).agentId;
    const sessionId = "session-watchdog-tool-path";

    const sessionStore = getHttpSessionStore();
    sessionStore.upsertSession({
      sessionId,
      workspaceId: "default",
      cwd: "/tmp",
      routaAgentId: sessionAgentId,
      createdAt: new Date().toISOString(),
    });

    const readConversation = vi
      .spyOn(system.tools, "readAgentConversation")
      .mockResolvedValue({ success: true, data: { messages: [] } });
    const messageAgent = vi
      .spyOn(system.tools, "messageAgent")
      .mockResolvedValue({ success: true, data: { delivered: true } });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, {
      status: 200,
    }));

    startWorkflowOrchestrator(system);
    const orchestrator = getWorkflowOrchestrator(system);
    await (orchestrator as unknown as {
      notifyKanbanAgent: (params: {
        workspaceId: string;
        sessionId: string;
        cardId: string;
        cardTitle: string;
        boardId: string;
        columnId: string;
        reason: string;
        mode: "watchdog_retry";
      }) => Promise<void>;
    }).notifyKanbanAgent({
      workspaceId: "default",
      sessionId,
      cardId: "card-1",
      cardTitle: "Test card",
      boardId: "board-1",
      columnId: "dev",
      reason: "No activity for too long.",
      mode: "watchdog_retry",
    });

    expect(readConversation).toHaveBeenCalledWith({
      agentId: sessionAgentId,
      lastN: 5,
    });
    expect(messageAgent).toHaveBeenCalledWith({
      fromAgentId: sessionAgentId,
      toAgentId: sessionAgentId,
      message: expect.stringContaining(`acp session id = ${sessionId}`),
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("falls back to session/prompt when agent message fails", async () => {
    const system = createInMemorySystem();
    const createAgentResult = await system.tools.createAgent({
      name: "watchdog-fallback-agent",
      role: "ROUTA",
      workspaceId: "default",
    });
    const sessionAgentId = (createAgentResult.data as { agentId: string }).agentId;
    const sessionId = "session-watchdog-fallback-path";

    const sessionStore = getHttpSessionStore();
    sessionStore.upsertSession({
      sessionId,
      workspaceId: "default",
      cwd: "/tmp",
      routaAgentId: sessionAgentId,
      createdAt: new Date().toISOString(),
    });

    vi.spyOn(system.tools, "readAgentConversation").mockResolvedValue({ success: true, data: { messages: [] } });
    vi.spyOn(system.tools, "messageAgent").mockResolvedValue({ success: false, error: "temporary failure" });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, {
      status: 200,
    }));

    startWorkflowOrchestrator(system);
    const orchestrator = getWorkflowOrchestrator(system);
    await (orchestrator as unknown as {
      notifyKanbanAgent: (params: {
        workspaceId: string;
        sessionId: string;
        cardId: string;
        cardTitle: string;
        boardId: string;
        columnId: string;
        reason: string;
        mode: "watchdog_retry";
      }) => Promise<void>;
    }).notifyKanbanAgent({
      workspaceId: "default",
      sessionId,
      cardId: "card-1",
      cardTitle: "Test card",
      boardId: "board-1",
      columnId: "dev",
      reason: "No activity for too long.",
      mode: "watchdog_retry",
    });

    expect(fetchSpy).toHaveBeenCalledWith(
      `${getInternalApiOrigin()}/api/acp`,
      expect.objectContaining({
        method: "POST",
      }),
    );
  });
});
