import { beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";

import { TerminalManager } from "../terminal-manager";
import type { IProcessHandle, WritableStreamLike } from "@/core/platform/interfaces";

class FakeWritable implements WritableStreamLike {
  writable = true;
  writes: Array<string | Buffer> = [];

  write(data: string | Buffer): boolean {
    this.writes.push(data);
    return true;
  }
}

class FakeProcess extends EventEmitter implements IProcessHandle {
  pid = 1234;
  stdin = new FakeWritable();
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  exitCode: number | null = null;

  kill(): void {
    this.emit("exit", 0, null);
  }
}

const spawnMock = vi.fn();
const execSyncMock = vi.fn(() => "/usr/bin/python3\n");

vi.mock("@/core/platform", () => ({
  getServerBridge: () => ({
    process: {
      isAvailable: () => true,
      spawn: spawnMock,
      execSync: execSyncMock,
    },
  }),
}));

describe("TerminalManager", () => {
  let manager: TerminalManager;
  let process: FakeProcess;

  beforeEach(() => {
    manager = new TerminalManager();
    process = new FakeProcess();
    spawnMock.mockReset();
    spawnMock.mockReturnValue(process);
    execSyncMock.mockClear();
  });

  it("writes browser input back to the terminal process", () => {
    const result = manager.create(
      { command: "/bin/sh", args: ["-c", "cat"] },
      "session-1",
      vi.fn(),
    );

    expect(manager.hasTerminal("session-1", result.terminalId)).toBe(true);

    manager.write(result.terminalId, "ls -la\n");

    expect(process.stdin.writes).toEqual([
      `${JSON.stringify({
        type: "input",
        data: Buffer.from("ls -la\n", "utf-8").toString("base64"),
      })}\n`,
    ]);
  });

  it("tracks resize metadata without requiring a PTY backend", () => {
    const result = manager.create(
      { command: "/bin/sh", args: ["-c", "cat"], cols: 80, rows: 24 },
      "session-1",
      vi.fn(),
    );

    expect(() => manager.resize(result.terminalId, 120, 40)).not.toThrow();
    expect(process.stdin.writes[0]).toBe(
      `${JSON.stringify({ type: "resize", cols: 120, rows: 40 })}\n`,
    );
  });
});
