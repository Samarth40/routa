"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import type { ArtifactType } from "@/core/models/artifact";
import type { ArtifactInfo } from "../types";

interface KanbanCardArtifactsProps {
  taskId: string;
  compact?: boolean;
  requiredArtifacts?: ArtifactType[];
  refreshSignal?: number;
}

const ARTIFACT_LABELS: Record<ArtifactType, string> = {
  screenshot: "Screenshot",
  test_results: "Test Results",
  code_diff: "Code Diff",
  logs: "Logs",
};

function formatArtifactTypeLabel(type: ArtifactType): string {
  return ARTIFACT_LABELS[type] ?? type;
}

function formatArtifactTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Time unavailable";
  return date.toLocaleString();
}

export function KanbanCardArtifacts({
  taskId,
  compact = false,
  requiredArtifacts = [],
  refreshSignal = 0,
}: KanbanCardArtifactsProps) {
  const [artifacts, setArtifacts] = useState<ArtifactInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const loadArtifacts = async () => {
      setLoading(true);
      setLoadError(null);
      try {
        const response = await fetch(`/api/tasks/${encodeURIComponent(taskId)}/artifacts`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const data = await response.json().catch(() => ({}));
        if (controller.signal.aborted) return;
        if (!response.ok) {
          throw new Error(data.error ?? "Failed to load artifacts");
        }
        setArtifacts(Array.isArray(data.artifacts) ? data.artifacts as ArtifactInfo[] : []);
      } catch (error) {
        if (controller.signal.aborted) return;
        setLoadError(error instanceof Error ? error.message : "Failed to load artifacts");
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    };

    void loadArtifacts();
    return () => controller.abort();
  }, [refreshSignal, taskId]);

  const coverage = useMemo(() => {
    const counts = new Map<ArtifactType, number>();
    for (const artifact of artifacts) {
      counts.set(artifact.type, (counts.get(artifact.type) ?? 0) + 1);
    }
    return counts;
  }, [artifacts]);

  const screenshotCount = coverage.get("screenshot") ?? 0;
  const missingRequiredArtifacts = requiredArtifacts.filter((type) => (coverage.get(type) ?? 0) === 0);

  return (
    <section className={`border border-gray-200/80 bg-white shadow-sm dark:border-[#232736] dark:bg-[#121620] ${compact ? "rounded-2xl p-3" : "rounded-3xl p-4"}`}>
      <div className={compact ? "mb-2" : "mb-3"}>
        <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-400 dark:text-gray-500">
          Artifacts
        </div>
        <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
          Agent-produced evidence attached to this task.
        </div>
      </div>

      <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-900/10 dark:text-emerald-300 ${compact ? "px-2 py-0.5 text-[10px]" : "px-2.5 py-1 text-[11px]"}`}>
              {artifacts.length} total
            </span>
            <span className={`inline-flex items-center gap-1 rounded-full border border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-900/40 dark:bg-sky-900/10 dark:text-sky-300 ${compact ? "px-2 py-0.5 text-[10px]" : "px-2.5 py-1 text-[11px]"}`}>
              {screenshotCount} screenshots
            </span>
            {requiredArtifacts.map((type) => {
              const present = (coverage.get(type) ?? 0) > 0;
              return (
                <span
                  key={type}
                  className={`inline-flex items-center gap-1 rounded-full border ${present
                    ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-900/10 dark:text-emerald-300"
                    : "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/40 dark:bg-amber-900/10 dark:text-amber-300"
                  } ${compact ? "px-2 py-0.5 text-[10px]" : "px-2.5 py-1 text-[11px]"}`}
                >
                  {present ? "Ready" : "Missing"} {formatArtifactTypeLabel(type)}
                </span>
              );
            })}
          </div>

          {loading ? (
            <div className="rounded-2xl border border-dashed border-gray-200 bg-gray-50 px-4 py-5 text-sm text-gray-500 dark:border-gray-700 dark:bg-[#0d1018] dark:text-gray-400">
              Loading artifacts...
            </div>
          ) : loadError ? (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-900/40 dark:bg-rose-900/10 dark:text-rose-300">
              {loadError}
            </div>
          ) : artifacts.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-gray-200 bg-gray-50 px-4 py-5 text-sm text-gray-500 dark:border-gray-700 dark:bg-[#0d1018] dark:text-gray-400">
              No artifacts attached yet.
            </div>
          ) : (
            <div className="space-y-3">
              {artifacts.map((artifact) => {
                const mediaType = artifact.metadata?.mediaType || "image/png";
                const screenshotSrc = artifact.type === "screenshot" && artifact.content
                  ? `data:${mediaType};base64,${artifact.content}`
                  : null;

                return (
                  <article
                    key={artifact.id}
                    className="rounded-2xl border border-gray-200/80 bg-gray-50/70 p-3 dark:border-gray-700 dark:bg-[#0d1018]"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] font-medium text-amber-800 dark:border-amber-900/40 dark:bg-amber-900/10 dark:text-amber-200">
                            {formatArtifactTypeLabel(artifact.type)}
                          </span>
                          {artifact.providedByAgentId && (
                            <span className="text-xs text-gray-500 dark:text-gray-400">
                              by {artifact.providedByAgentId}
                            </span>
                          )}
                          {artifact.metadata?.filename && (
                            <span className="truncate text-xs text-gray-500 dark:text-gray-400">
                              {artifact.metadata.filename}
                            </span>
                          )}
                        </div>
                        <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                          {formatArtifactTimestamp(artifact.createdAt)}
                        </div>
                      </div>
                      <div className="truncate text-[11px] uppercase tracking-[0.16em] text-gray-400 dark:text-gray-500">
                        {artifact.status}
                      </div>
                    </div>

                    {artifact.context && (
                      <p className="mt-2 text-sm leading-6 text-gray-700 dark:text-gray-300">{artifact.context}</p>
                    )}

                    {screenshotSrc ? (
                      <Image
                        src={screenshotSrc}
                        alt={artifact.context || "Attached screenshot"}
                        width={1200}
                        height={800}
                        unoptimized
                        className="mt-3 max-h-56 w-full rounded-xl border border-gray-200 object-cover dark:border-gray-700"
                      />
                    ) : artifact.content ? (
                      <pre className="mt-3 overflow-x-auto rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs leading-5 text-gray-700 dark:border-gray-700 dark:bg-[#121620] dark:text-gray-300">
                        {artifact.content}
                      </pre>
                    ) : null}
                  </article>
                );
              })}
            </div>
          )}
        </div>

        <div className="rounded-2xl border border-gray-200/80 bg-gray-50/70 p-3 dark:border-gray-700 dark:bg-[#0d1018]">
          <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">Agent interface</div>
          <div className="mt-1 text-xs leading-5 text-gray-500 dark:text-gray-400">
            This lane expects agent-generated evidence, not manual user uploads.
          </div>

          <div className="mt-3 space-y-3 text-sm leading-6 text-gray-700 dark:text-gray-300">
            {requiredArtifacts.length > 0 && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-amber-800 dark:border-amber-900/40 dark:bg-amber-900/10 dark:text-amber-300">
                {missingRequiredArtifacts.length === 0
                  ? `Next-lane requirements are satisfied: ${requiredArtifacts.map((type) => formatArtifactTypeLabel(type)).join(", ")}.`
                  : `Missing for next move: ${missingRequiredArtifacts.map((type) => formatArtifactTypeLabel(type)).join(", ")}.`}
              </div>
            )}

            <div className="rounded-xl border border-slate-200 bg-white px-3 py-3 dark:border-slate-700 dark:bg-[#121620]">
              <div className="text-xs font-semibold uppercase tracking-[0.16em] text-gray-400 dark:text-gray-500">
                Preferred tools
              </div>
              <ul className="mt-2 space-y-2 text-sm leading-6 text-gray-700 dark:text-gray-300">
                <li><code>capture_screenshot</code> for visual proof tied to this task.</li>
                <li><code>provide_artifact</code> for test results, diffs, or logs.</li>
                <li><code>list_artifacts</code> before <code>move_card</code> to confirm the gate is satisfied.</li>
              </ul>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white px-3 py-3 text-xs leading-6 text-gray-600 dark:border-slate-700 dark:bg-[#121620] dark:text-gray-400">
              Task API also exposes <code>GET /api/tasks/{taskId}/artifacts</code> for reading evidence and
              <code> POST /api/tasks/{taskId}/artifacts</code> for agent-side artifact submission.
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
