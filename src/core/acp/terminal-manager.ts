/**
 * TerminalManager - Server-side terminal process manager for ACP terminal operations.
 *
 * Handles terminal/create, terminal/output, terminal/release, terminal/wait_for_exit,
 * terminal/kill requests from ACP agents by spawning real shell processes.
 *
 * Terminal output is forwarded to the client via session/update notifications
 * with sessionUpdate type "terminal_output" for rendering in xterm.js.
 *
 * Uses the platform bridge for process spawning, enabling support across
 * Web (Node.js), Tauri, and Electron environments.
 */

import path from "node:path";

import type { IProcessHandle } from "@/core/platform/interfaces";
import { getServerBridge } from "@/core/platform";

export type TerminalNotificationEmitter = (notification: {
  jsonrpc: "2.0";
  method: string;
  params: Record<string, unknown>;
}) => void;

interface ManagedTerminal {
  terminalId: string;
  sessionId: string;
  process: IProcessHandle;
  output: string;
  exitCode: number | null;
  exited: boolean;
  exitPromise: Promise<number>;
  createdAt: Date;
  cols?: number;
  rows?: number;
  usesPtyBridge: boolean;
  helperStdoutBuffer?: string;
  exitNotified?: boolean;
}

export class TerminalManager {
  private terminals = new Map<string, ManagedTerminal>();
  private terminalCounter = 0;
  private ptyBridgeCommand: string | null | undefined;

  /**
   * Create a terminal process.
   *
   * @param params - terminal/create params from the agent
   * @param sessionId - ACP session ID for notification routing
   * @param emitNotification - callback to emit session/update notifications
   * @returns { terminalId } for the created terminal
   */
  create(
    params: Record<string, unknown>,
    sessionId: string,
    emitNotification: TerminalNotificationEmitter
  ): { terminalId: string } {
    const terminalId = `term-${++this.terminalCounter}-${Date.now()}`;

    // Extract command from params
    const command = (params.command as string) ?? "/bin/bash";
    const args = (params.args as string[]) ?? [];
    const cwd = (params.cwd as string) ?? process.cwd();
    const env = (params.env as Record<string, string>) ?? {};

    console.log(
      `[TerminalManager] Creating terminal ${terminalId}: ${command} ${args.join(" ")} (cwd: ${cwd})`
    );

    // Emit terminal_created notification so the client knows to show a terminal
    emitNotification({
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId,
        update: {
          sessionUpdate: "terminal_created",
          terminalId,
          command,
          args,
        },
      },
    });

    const bridge = getServerBridge();
    if (!bridge.process.isAvailable()) {
      throw new Error("Process spawning is not available on this platform");
    }

    const mergedEnv = {
      ...env,
      FORCE_COLOR: "1",
      TERM: "xterm-256color",
    };
    const usePtyBridge = this.canUsePtyBridge(bridge.process);
    const proc = usePtyBridge
      ? bridge.process.spawn(
          this.getPtyBridgeCommand(bridge.process)!,
          this.buildPtyBridgeArgs(command, args, params),
          {
            stdio: ["pipe", "pipe", "pipe"],
            cwd,
            env: mergedEnv,
            shell: false,
          },
        )
      : bridge.process.spawn(command, args, {
          stdio: ["pipe", "pipe", "pipe"],
          cwd,
          env: mergedEnv,
          shell: true,
        });

    const output = "";
    let exitResolve: (code: number) => void;
    const exitPromise = new Promise<number>((resolve) => {
      exitResolve = resolve;
    });

    const managed: ManagedTerminal = {
      terminalId,
      sessionId,
      process: proc,
      output,
      exitCode: null,
      exited: false,
      exitPromise,
      createdAt: new Date(),
      cols: typeof params.cols === "number" ? params.cols : undefined,
      rows: typeof params.rows === "number" ? params.rows : undefined,
      usesPtyBridge: usePtyBridge,
      helperStdoutBuffer: "",
      exitNotified: false,
    };

    if (usePtyBridge) {
      proc.stdout?.on("data", (chunk: Buffer) => {
        this.handlePtyBridgeStdout(managed, chunk, emitNotification);
      });
    } else {
      // Capture stdout
      proc.stdout?.on("data", (chunk: Buffer) => {
        const data = chunk.toString("utf-8");
        this.appendOutput(managed, data, emitNotification);
      });
    }

    // Capture stderr (merge into terminal output)
    proc.stderr?.on("data", (chunk: Buffer) => {
      const data = chunk.toString("utf-8");
      this.appendOutput(managed, data, emitNotification);
    });

    // Handle process exit
    proc.on("exit", (code, signal) => {
      console.log(
        `[TerminalManager] Terminal ${terminalId} exited: code=${code}, signal=${signal}`
      );
      this.markExited(managed, code ?? (signal ? 128 : 0), emitNotification);
      exitResolve!(managed.exitCode ?? 0);
    });

    proc.on("error", (err) => {
      console.error(
        `[TerminalManager] Terminal ${terminalId} error:`,
        err
      );
      managed.exited = true;
      managed.exitCode = 1;
      exitResolve!(1);
    });

    this.terminals.set(terminalId, managed);

    return { terminalId };
  }

  /**
   * Get accumulated output for a terminal.
   */
  getOutput(terminalId: string): { output: string } {
    const terminal = this.terminals.get(terminalId);
    if (!terminal) {
      return { output: "" };
    }
    return { output: terminal.output };
  }

  hasTerminal(sessionId: string, terminalId: string): boolean {
    const terminal = this.terminals.get(terminalId);
    return terminal?.sessionId === sessionId;
  }

  write(terminalId: string, data: string): void {
    const terminal = this.terminals.get(terminalId);
    if (!terminal || terminal.exited || !terminal.process.stdin?.writable) {
      throw new Error("Terminal is not writable");
    }

    if (terminal.usesPtyBridge) {
      terminal.process.stdin.write(`${JSON.stringify({
        type: "input",
        data: Buffer.from(data, "utf-8").toString("base64"),
      })}\n`);
      return;
    }

    terminal.process.stdin.write(data);
  }

  resize(terminalId: string, cols?: number, rows?: number): void {
    const terminal = this.terminals.get(terminalId);
    if (!terminal || terminal.exited) {
      throw new Error("Terminal not found");
    }

    terminal.cols = typeof cols === "number" ? cols : terminal.cols;
    terminal.rows = typeof rows === "number" ? rows : terminal.rows;
    if (terminal.usesPtyBridge && terminal.process.stdin?.writable) {
      terminal.process.stdin.write(`${JSON.stringify({
        type: "resize",
        cols: terminal.cols,
        rows: terminal.rows,
      })}\n`);
    }
  }

  private appendOutput(
    terminal: ManagedTerminal,
    data: string,
    emitNotification: TerminalNotificationEmitter,
  ): void {
    terminal.output += data;
    emitNotification({
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: terminal.sessionId,
        update: {
          sessionUpdate: "terminal_output",
          terminalId: terminal.terminalId,
          data,
        },
      },
    });
  }

  private markExited(
    terminal: ManagedTerminal,
    exitCode: number,
    emitNotification: TerminalNotificationEmitter,
  ): void {
    if (terminal.exitNotified) return;
    terminal.exitCode = exitCode;
    terminal.exited = true;
    terminal.exitNotified = true;
    emitNotification({
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: terminal.sessionId,
        update: {
          sessionUpdate: "terminal_exited",
          terminalId: terminal.terminalId,
          exitCode,
        },
      },
    });
  }

  private handlePtyBridgeStdout(
    terminal: ManagedTerminal,
    chunk: Buffer,
    emitNotification: TerminalNotificationEmitter,
  ): void {
    terminal.helperStdoutBuffer = `${terminal.helperStdoutBuffer ?? ""}${chunk.toString("utf-8")}`;
    const lines = terminal.helperStdoutBuffer.split("\n");
    terminal.helperStdoutBuffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      try {
        const frame = JSON.parse(trimmed) as
          | { type: "output"; data: string }
          | { type: "exit"; exitCode?: number };
        if (frame.type === "output" && typeof frame.data === "string") {
          this.appendOutput(
            terminal,
            Buffer.from(frame.data, "base64").toString("utf-8"),
            emitNotification,
          );
        }
        if (frame.type === "exit") {
          this.markExited(terminal, frame.exitCode ?? 0, emitNotification);
        }
      } catch {
        this.appendOutput(terminal, `${trimmed}\n`, emitNotification);
      }
    }
  }

  private canUsePtyBridge(processAdapter: ReturnType<typeof getServerBridge>["process"]): boolean {
    return process.platform !== "win32" && Boolean(this.getPtyBridgeCommand(processAdapter));
  }

  private getPtyBridgeCommand(
    processAdapter: ReturnType<typeof getServerBridge>["process"],
  ): string | null {
    if (this.ptyBridgeCommand !== undefined) {
      return this.ptyBridgeCommand;
    }

    for (const candidate of ["python3", "python"]) {
      if (typeof processAdapter.execSync !== "function") {
        break;
      }
      try {
        const resolved = processAdapter.execSync(`which ${candidate}`).trim().split("\n")[0];
        if (resolved) {
          this.ptyBridgeCommand = resolved;
          return resolved;
        }
      } catch {
        // Try next candidate.
      }
    }

    this.ptyBridgeCommand = null;
    return null;
  }

  private buildPtyBridgeArgs(
    command: string,
    args: string[],
    params: Record<string, unknown>,
  ): string[] {
    const helperPath = path.resolve(process.cwd(), "scripts/pty-bridge.py");
    const bridgeArgs = [helperPath];
    if (typeof params.cols === "number") {
      bridgeArgs.push("--cols", String(params.cols));
    }
    if (typeof params.rows === "number") {
      bridgeArgs.push("--rows", String(params.rows));
    }
    bridgeArgs.push("--", command, ...args);
    return bridgeArgs;
  }

  /**
   * Wait for a terminal process to exit.
   */
  async waitForExit(terminalId: string): Promise<{ exitCode: number }> {
    const terminal = this.terminals.get(terminalId);
    if (!terminal) {
      return { exitCode: -1 };
    }

    if (terminal.exited) {
      return { exitCode: terminal.exitCode ?? 0 };
    }

    const exitCode = await terminal.exitPromise;
    return { exitCode };
  }

  /**
   * Kill a terminal process.
   */
  kill(terminalId: string): void {
    const terminal = this.terminals.get(terminalId);
    if (!terminal || terminal.exited) return;

    console.log(`[TerminalManager] Killing terminal ${terminalId}`);

    try {
      terminal.process.kill("SIGTERM");
      // Force kill after 3 seconds
      setTimeout(() => {
        if (!terminal.exited) {
          terminal.process.kill("SIGKILL");
        }
      }, 3000);
    } catch (err) {
      console.error(
        `[TerminalManager] Error killing terminal ${terminalId}:`,
        err
      );
    }
  }

  /**
   * Release terminal resources.
   */
  release(terminalId: string): void {
    const terminal = this.terminals.get(terminalId);
    if (!terminal) return;

    console.log(`[TerminalManager] Releasing terminal ${terminalId}`);

    if (!terminal.exited) {
      this.kill(terminalId);
    }
    this.terminals.delete(terminalId);
  }

  /**
   * Dispose of all terminals.
   */
  disposeAll(): void {
    for (const [id] of this.terminals) {
      this.release(id);
    }
  }
}

// Singleton
let singleton: TerminalManager | undefined;

export function getTerminalManager(): TerminalManager {
  if (!singleton) {
    singleton = new TerminalManager();
  }
  return singleton;
}
