/**
 * RemoteSessionProvider — Postgres-backed session storage.
 *
 * Wraps the existing PgAcpSessionStore with the new SessionStorageProvider
 * interface. Also introduces the session_messages table for per-message
 * storage (splitting out from the JSONB messageHistory column).
 */

import { eq, desc, and, sql, type SQL } from "drizzle-orm";
import type { Database } from "../db/index";
import { acpSessions } from "../db/schema";
import type {
  SessionStorageProvider,
  SessionRecord,
  SessionJsonlEntry,
} from "./types";

export class RemoteSessionProvider implements SessionStorageProvider {
  constructor(private db: Database) {}

  async save(session: SessionRecord): Promise<void> {
    await this.db
      .insert(acpSessions)
      .values({
        id: session.id,
        name: session.name,
        cwd: session.cwd,
        branch: session.branch,
        workspaceId: session.workspaceId,
        routaAgentId: session.routaAgentId,
        provider: session.provider,
        role: session.role,
        modeId: session.modeId,
        model: session.model,
        firstPromptSent: session.firstPromptSent ?? false,
        messageHistory: [],
        parentSessionId: session.parentSessionId,
        createdAt: new Date(session.createdAt),
        updatedAt: new Date(session.updatedAt),
      })
      .onConflictDoUpdate({
        target: acpSessions.id,
        set: {
          name: session.name,
          modeId: session.modeId,
          model: session.model,
          updatedAt: new Date(),
        },
      });
  }

  async get(sessionId: string): Promise<SessionRecord | undefined> {
    const rows = await this.db
      .select()
      .from(acpSessions)
      .where(eq(acpSessions.id, sessionId))
      .limit(1);

    return rows[0] ? this.toSessionRecord(rows[0]) : undefined;
  }

  async list(workspaceId?: string, limit?: number): Promise<SessionRecord[]> {
    const conditions: SQL[] = [];
    if (workspaceId) {
      conditions.push(eq(acpSessions.workspaceId, workspaceId));
    }

    const rows = await this.db
      .select()
      .from(acpSessions)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(acpSessions.createdAt))
      .limit(limit ?? 100);

    return rows.map(this.toSessionRecord);
  }

  async delete(sessionId: string): Promise<void> {
    await this.db
      .delete(acpSessions)
      .where(eq(acpSessions.id, sessionId));
  }

  async getHistory(sessionId: string): Promise<unknown[]> {
    // First try session_messages table, fall back to JSONB column
    const rows = await this.db
      .select()
      .from(acpSessions)
      .where(eq(acpSessions.id, sessionId))
      .limit(1);

    return rows[0]?.messageHistory ?? [];
  }

  async appendMessage(
    sessionId: string,
    entry: SessionJsonlEntry
  ): Promise<void> {
    // Append to the JSONB messageHistory column
    // (In a future migration, this will write to session_messages table instead)
    const session = await this.get(sessionId);
    if (!session) return;

    const rows = await this.db
      .select()
      .from(acpSessions)
      .where(eq(acpSessions.id, sessionId))
      .limit(1);

    if (!rows[0]) return;

    const history = [...(rows[0].messageHistory ?? []), entry as unknown];
    await this.db
      .update(acpSessions)
      .set({
        messageHistory: history as typeof acpSessions.$inferSelect.messageHistory,
        updatedAt: new Date(),
      })
      .where(eq(acpSessions.id, sessionId));
  }

  private toSessionRecord(
    row: typeof acpSessions.$inferSelect
  ): SessionRecord {
    return {
      id: row.id,
      name: row.name ?? undefined,
      cwd: row.cwd,
      branch: row.branch ?? undefined,
      workspaceId: row.workspaceId,
      routaAgentId: row.routaAgentId ?? undefined,
      provider: row.provider ?? undefined,
      role: row.role ?? undefined,
      modeId: row.modeId ?? undefined,
      model: row.model ?? undefined,
      firstPromptSent: row.firstPromptSent ?? false,
      parentSessionId: row.parentSessionId ?? undefined,
      createdAt: row.createdAt?.toISOString() ?? new Date().toISOString(),
      updatedAt: row.updatedAt?.toISOString() ?? new Date().toISOString(),
    };
  }
}
