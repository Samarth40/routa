import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { KanbanCardArtifacts } from "../kanban-card-artifacts";

describe("KanbanCardArtifacts", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows agent-first artifact guidance and current requirement coverage", async () => {
    let getCount = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/tasks/task-1/artifacts" && (!init?.method || init.method === "GET")) {
        getCount += 1;
        return {
          ok: true,
          json: async () => ({
            artifacts: getCount > 1
              ? [{
                id: "artifact-1",
                type: "screenshot",
                taskId: "task-1",
                workspaceId: "workspace-1",
                providedByAgentId: "agent-1",
                content: "encoded-image",
                context: "Review proof",
                status: "provided",
                createdAt: "2025-01-01T00:00:00.000Z",
                updatedAt: "2025-01-01T00:00:00.000Z",
                metadata: {
                  filename: "review.png",
                  mediaType: "image/png",
                },
              }]
              : [],
          }),
        } as Response;
      }

      throw new Error(`Unexpected fetch: ${init?.method ?? "GET"} ${url}`);
    });

    vi.stubGlobal("fetch", fetchMock);

    const { rerender } = render(
      <KanbanCardArtifacts
        taskId="task-1"
        requiredArtifacts={["screenshot", "test_results"]}
        refreshSignal={0}
      />,
    );

    expect(await screen.findByText("No artifacts attached yet.")).toBeTruthy();

    rerender(
      <KanbanCardArtifacts
        taskId="task-1"
        requiredArtifacts={["screenshot", "test_results"]}
        refreshSignal={1}
      />,
    );

    expect(await screen.findByText("Review proof")).toBeTruthy();
    expect(screen.getByText(/This lane expects agent-generated evidence/i)).toBeTruthy();
    expect(screen.getByText(/capture_screenshot/i)).toBeTruthy();
    expect(screen.getByText(/provide_artifact/i)).toBeTruthy();
    expect(screen.getByText(/Ready Screenshot/i)).toBeTruthy();
    expect(screen.getByText(/Missing Test Results/i)).toBeTruthy();
    expect(screen.getByText(/by agent-1/i)).toBeTruthy();
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
  });
});
