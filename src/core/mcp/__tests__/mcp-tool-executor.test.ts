import { describe, expect, it, vi } from "vitest";
import type { AgentTools } from "@/core/tools/agent-tools";
import { executeMcpTool, getMcpToolDefinitions } from "../mcp-tool-executor";

describe("mcp-tool-executor artifact support", () => {
  it("exposes artifact tools in essential mode", () => {
    const essentialNames = new Set(getMcpToolDefinitions("essential").map((tool) => tool.name));

    expect(essentialNames.has("provide_artifact")).toBe(true);
    expect(essentialNames.has("list_artifacts")).toBe(true);
    expect(essentialNames.has("capture_screenshot")).toBe(true);
    expect(essentialNames.has("request_artifact")).toBe(true);
  });

  it("routes provide_artifact execution through AgentTools", async () => {
    const provideArtifact = vi.fn().mockResolvedValue({
      success: true,
      data: {
        artifactId: "artifact-1",
        status: "provided",
      },
    });

    const result = await executeMcpTool(
      {
        provideArtifact,
      } as unknown as AgentTools,
      "provide_artifact",
      {
        workspaceId: "workspace-1",
        agentId: "agent-1",
        type: "screenshot",
        taskId: "task-1",
        content: "base64-image",
        context: "Review proof",
        metadata: {
          filename: "review.png",
        },
      },
    );

    expect(provideArtifact).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      agentId: "agent-1",
      type: "screenshot",
      taskId: "task-1",
      content: "base64-image",
      context: "Review proof",
      requestId: undefined,
      metadata: {
        filename: "review.png",
      },
    });
    expect(result.isError).toBe(false);
    expect(JSON.parse(result.content[0]?.text ?? "{}")).toMatchObject({
      artifactId: "artifact-1",
      status: "provided",
    });
  });
});
