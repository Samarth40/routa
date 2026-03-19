import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTask, TaskStatus, type Task } from "@/core/models/task";

const taskStore = {
  findReadyTasks: vi.fn<(_: string) => Promise<Task[]>>(),
};

const system = {
  taskStore,
};

vi.mock("@/core/routa-system", () => ({
  getRoutaSystem: () => system,
}));

import { GET } from "../route";

describe("/api/tasks/ready GET", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    taskStore.findReadyTasks.mockResolvedValue([
      createTask({
        id: "task-ready-1",
        title: "Ready task",
        objective: "Run after dependencies complete",
        workspaceId: "workspace-1",
        boardId: "board-1",
        columnId: "todo",
        status: TaskStatus.PENDING,
      }),
    ]);
  });

  it("returns ready tasks for the requested workspace", async () => {
    const response = await GET(new NextRequest("http://localhost/api/tasks/ready?workspaceId=workspace-1"));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(taskStore.findReadyTasks).toHaveBeenCalledWith("workspace-1");
    expect(data.tasks).toHaveLength(1);
    expect(data.tasks[0]).toMatchObject({
      id: "task-ready-1",
      workspaceId: "workspace-1",
    });
  });

  it("rejects requests without workspaceId", async () => {
    const response = await GET(new NextRequest("http://localhost/api/tasks/ready"));
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data).toEqual({ error: "workspaceId is required" });
    expect(taskStore.findReadyTasks).not.toHaveBeenCalled();
  });
});
