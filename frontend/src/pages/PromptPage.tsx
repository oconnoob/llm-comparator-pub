import { useCallback, useEffect, useRef, useState } from "react";
import {
  createRun,
  deleteAllRuns,
  deleteRuns,
  exportRunsUrl,
  getConfig,
  getRuns,
  streamRun,
} from "../api/client";
import type { Metrics, RunListItem, StreamEvent } from "../api/types";
import { cn } from "../lib/utils";

// ── Constants ────────────────────────────────────────────────────────────────

const EXAMPLE_PROMPTS = [
  "Explain quantum entanglement to a 10-year-old in exactly 5 sentences.",
  "Write a Python function to find all prime factors of a number.",
  "What would happen if the Moon suddenly disappeared? Describe the effects.",
  "A farmer has 17 sheep. All but 9 die. How many sheep are left?",
];

const MODEL_COLORS = [
  {
    border: "border-green-300 dark:border-green-700",
    bg: "bg-green-50 dark:bg-green-950",
    header: "bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200",
    label: "text-green-700 dark:text-green-400",
  },
  {
    border: "border-blue-300 dark:border-blue-700",
    bg: "bg-blue-50 dark:bg-blue-950",
    header: "bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200",
    label: "text-blue-700 dark:text-blue-400",
  },
  {
    border: "border-orange-300 dark:border-orange-700",
    bg: "bg-orange-50 dark:bg-orange-950",
    header:
      "bg-orange-100 dark:bg-orange-900 text-orange-800 dark:text-orange-200",
    label: "text-orange-700 dark:text-orange-400",
  },
];

// ── Types ────────────────────────────────────────────────────────────────────

type ModelStatus = "idle" | "streaming" | "done" | "error";

interface ModelState {
  status: ModelStatus;
  text: string;
  metrics: Metrics | null;
  error: string | null;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmt(n: number | null | undefined, decimals = 0, unit = "") {
  if (n == null) return "—";
  return n.toFixed(decimals) + unit;
}

// ── Sub-components ───────────────────────────────────────────────────────────

function MetricsBadge({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <span className="inline-flex flex-col items-center gap-0.5">
      <span className="text-xs text-gray-400 dark:text-gray-500">{label}</span>
      <span className="text-sm font-mono font-medium text-gray-700 dark:text-gray-300">
        {value}
      </span>
    </span>
  );
}

function ModelColumn({
  name,
  state,
  colorIdx,
}: {
  name: string;
  state: ModelState;
  colorIdx: number;
}) {
  const color = MODEL_COLORS[colorIdx % MODEL_COLORS.length];
  const outputRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom while streaming
  useEffect(() => {
    if (state.status === "streaming" && outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [state.text, state.status]);

  return (
    <div
      className={cn(
        "flex flex-col rounded-lg border overflow-hidden",
        color.border,
      )}
    >
      {/* Model name header */}
      <div
        className={cn(
          "px-3 py-2 text-center text-xs font-semibold uppercase tracking-wider",
          color.header,
        )}
      >
        {name}
      </div>

      {/* Status line */}
      <div className="px-3 py-1.5 flex items-center gap-1.5 border-b border-gray-100 dark:border-gray-800 min-h-[28px]">
        {state.status === "idle" && (
          <span className="text-xs text-gray-400 dark:text-gray-500 italic">
            Waiting…
          </span>
        )}
        {state.status === "streaming" && (
          <>
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
            <span className="text-xs text-gray-500 dark:text-gray-400">
              Generating…
            </span>
          </>
        )}
        {state.status === "done" && (
          <span className="text-xs text-green-600 dark:text-green-400 font-medium">
            ✓ Done
          </span>
        )}
        {state.status === "error" && (
          <span className="text-xs text-red-500 font-medium truncate">
            ✗ {state.error}
          </span>
        )}
      </div>

      {/* Output text area */}
      <div
        ref={outputRef}
        className={cn(
          "flex-1 overflow-y-auto p-3 text-sm leading-relaxed whitespace-pre-wrap min-h-48 font-mono",
          "text-gray-800 dark:text-gray-200",
          color.bg,
        )}
      >
        {state.text || (
          <span className="text-gray-300 dark:text-gray-600">
            Output will appear here…
          </span>
        )}
        {state.status === "streaming" && (
          <span className="inline-block w-1 h-4 bg-gray-500 animate-pulse ml-0.5 align-text-bottom" />
        )}
      </div>

      {/* Metrics footer */}
      {state.metrics && (
        <div
          className={cn(
            "px-3 py-2 flex justify-around border-t border-gray-100 dark:border-gray-800",
            "bg-white/60 dark:bg-gray-900/60",
          )}
        >
          <MetricsBadge
            label="TTFT"
            value={fmt(state.metrics.ttft_ms, 0, "ms")}
          />
          <MetricsBadge
            label="Total"
            value={fmt(state.metrics.total_ms ? state.metrics.total_ms / 1000 : null, 1, "s")}
          />
          <MetricsBadge
            label="tok/s"
            value={fmt(state.metrics.tokens_per_sec, 1)}
          />
          <MetricsBadge
            label="tokens"
            value={String(state.metrics.token_count)}
          />
        </div>
      )}
    </div>
  );
}

function RunsTable({
  runs,
  total,
  page,
  pageSize,
  modelNames,
  selected,
  loading,
  onToggle,
  onToggleAll,
  onPageChange,
  onDelete,
  onDeleteAll,
}: {
  runs: RunListItem[];
  total: number;
  page: number;
  pageSize: number;
  modelNames: string[];
  selected: Set<string>;
  loading: boolean;
  onToggle: (id: string) => void;
  onToggleAll: () => void;
  onPageChange: (p: number) => void;
  onDelete: () => void;
  onDeleteAll: () => void;
}) {
  const totalPages = Math.ceil(total / pageSize);
  const allSelected = runs.length > 0 && runs.every((r) => selected.has(r.run_id));

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300">
          History ({total})
        </h2>
        <div className="flex gap-2">
          {selected.size > 0 && (
            <>
              <a
                href={exportRunsUrl([...selected])}
                download="runs.jsonl"
                className="text-xs px-3 py-1.5 rounded-md bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
              >
                Export selected ({selected.size})
              </a>
              <button
                onClick={onDelete}
                className="text-xs px-3 py-1.5 rounded-md bg-red-100 dark:bg-red-950 text-red-600 dark:text-red-400 hover:bg-red-200 dark:hover:bg-red-900 transition-colors cursor-pointer"
              >
                🗑 Delete {selected.size} selected
              </button>
            </>
          )}
          <a
            href={exportRunsUrl()}
            download="runs.jsonl"
            className="text-xs px-3 py-1.5 rounded-md bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
          >
            Export all
          </a>
          <button
            onClick={onDeleteAll}
            className="text-xs px-3 py-1.5 rounded-md bg-red-100 dark:bg-red-950 text-red-600 dark:text-red-400 hover:bg-red-200 dark:hover:bg-red-900 transition-colors cursor-pointer"
          >
            🗑 Delete all
          </button>
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-800">
        <table className="w-full text-xs">
          <thead className="bg-gray-50 dark:bg-gray-900 text-gray-500 dark:text-gray-400">
            <tr>
              <th className="px-3 py-2 w-8">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={onToggleAll}
                  className="cursor-pointer"
                />
              </th>
              <th className="px-3 py-2 text-left font-medium">Prompt</th>
              {modelNames.map((m) => (
                <th key={m} className="px-3 py-2 text-left font-medium">
                  {m}
                </th>
              ))}
              <th className="px-3 py-2 text-left font-medium">Scored</th>
              <th className="px-3 py-2 text-left font-medium">Time</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
            {loading && (
              <tr>
                <td
                  colSpan={4 + modelNames.length}
                  className="px-3 py-6 text-center text-gray-400 dark:text-gray-500 animate-pulse"
                >
                  Loading…
                </td>
              </tr>
            )}
            {!loading && runs.length === 0 && (
              <tr>
                <td
                  colSpan={4 + modelNames.length}
                  className="px-3 py-6 text-center text-gray-400 dark:text-gray-500"
                >
                  No runs yet — generate something above!
                </td>
              </tr>
            )}
            {runs.map((run) => (
              <tr
                key={run.run_id}
                className="hover:bg-gray-50 dark:hover:bg-gray-900/50 transition-colors"
              >
                <td className="px-3 py-2">
                  <input
                    type="checkbox"
                    checked={selected.has(run.run_id)}
                    onChange={() => onToggle(run.run_id)}
                    className="cursor-pointer"
                  />
                </td>
                <td className="px-3 py-2 max-w-[200px] truncate text-gray-700 dark:text-gray-300">
                  {run.prompt_preview}
                </td>
                {modelNames.map((m) => (
                  <td
                    key={m}
                    className="px-3 py-2 max-w-[200px] truncate text-gray-500 dark:text-gray-400"
                  >
                    {run.responses[m]?.preview ?? "—"}
                  </td>
                ))}
                <td className="px-3 py-2">
                  {run.scores ? (
                    <span className="text-green-600 dark:text-green-400 font-medium">✓</span>
                  ) : (
                    <span className="text-gray-300 dark:text-gray-600">—</span>
                  )}
                </td>
                <td className="px-3 py-2 text-gray-400 dark:text-gray-500 whitespace-nowrap">
                  {new Date(run.created_at).toLocaleTimeString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex justify-center gap-1 mt-3">
          {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
            <button
              key={p}
              onClick={() => onPageChange(p)}
              className={cn(
                "w-7 h-7 rounded text-xs transition-colors",
                p === page
                  ? "bg-green-500 text-white"
                  : "bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700",
              )}
            >
              {p}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main page ────────────────────────────────────────────────────────────────

const PAGE_SIZE = 20;

export function PromptPage({
  demoMode = false,
  apiKey = "",
  onNeedApiKey,
}: {
  demoMode?: boolean;
  apiKey?: string;
  onNeedApiKey?: () => void;
}) {
  const [modelNames, setModelNames] = useState<string[]>([
    "Model 1",
    "Model 2",
    "Model 3",
  ]);
  const [prompt, setPrompt] = useState("");
  const [temperature, setTemperature] = useState(0.6);
  const [maxTokens, setMaxTokens] = useState(4096);
  const [generating, setGenerating] = useState(false);
  const [modelStates, setModelStates] = useState<Record<string, ModelState>>(
    {},
  );
  const [runs, setRuns] = useState<RunListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [runsLoading, setRunsLoading] = useState(true);
  const esCleanup = useRef<(() => void) | null>(null);

  // Load config on mount
  useEffect(() => {
    getConfig()
      .then((cfg) => setModelNames(cfg.models.map((m) => m.name)))
      .catch(() =>
        setError("Could not reach backend. Is it running on port 8000?"),
      );
  }, []);

  // Initialize empty model states whenever model names change
  useEffect(() => {
    setModelStates(
      Object.fromEntries(
        modelNames.map((n) => [
          n,
          { status: "idle", text: "", metrics: null, error: null },
        ]),
      ),
    );
  }, [modelNames]);

  const loadRuns = useCallback((p: number) => {
    setRunsLoading(true);
    getRuns(p, PAGE_SIZE)
      .then((data) => {
        setRuns(data.items);
        setTotal(data.total);
      })
      .catch(() => setError("Failed to load run history."))
      .finally(() => setRunsLoading(false));
  }, []);

  useEffect(() => {
    loadRuns(page);
  }, [page, loadRuns]);

  const handleEvent = (event: StreamEvent) => {
    if (event.type === "token") {
      setModelStates((prev) => ({
        ...prev,
        [event.model]: {
          status: "streaming",
          text: (prev[event.model]?.text ?? "") + event.token,
          metrics: null,
          error: null,
        },
      }));
    } else if (event.type === "done") {
      setModelStates((prev) => ({
        ...prev,
        [event.model]: {
          ...(prev[event.model] ?? {
            status: "done",
            text: "",
            error: null,
          }),
          status: "done",
          metrics: event.metrics,
        },
      }));
    } else if (event.type === "error") {
      setModelStates((prev) => ({
        ...prev,
        [event.model]: {
          status: "error",
          text: prev[event.model]?.text ?? "",
          metrics: null,
          error: event.message,
        },
      }));
    } else if (event.type === "stream_end") {
      setGenerating(false);
      setPage(1);
      loadRuns(1);
    }
  };

  const handleGenerate = async () => {
    if (!prompt.trim() || generating) return;
    if (demoMode && !apiKey) { onNeedApiKey?.(); return; }

    // Reset states to idle/streaming
    setModelStates(
      Object.fromEntries(
        modelNames.map((n) => [
          n,
          { status: "idle", text: "", metrics: null, error: null },
        ]),
      ),
    );
    setGenerating(true);

    try {
      const { run_id } = await createRun({
        prompt: prompt.trim(),
        temperature,
        max_tokens: maxTokens,
      });

      esCleanup.current = streamRun(
        run_id,
        handleEvent,
        () => setGenerating(false),
        (msg) => setError(msg),
      );
    } catch (err) {
      setGenerating(false);
      setError(err instanceof Error ? err.message : "Failed to start generation.");
    }
  };

  useEffect(() => {
    return () => {
      esCleanup.current?.();
    };
  }, []);

  const toggleSelected = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    setSelected((prev) =>
      prev.size === runs.length ? new Set() : new Set(runs.map((r) => r.run_id)),
    );
  };

  const handleDelete = async () => {
    if (selected.size === 0) return;
    try {
      await deleteRuns([...selected]);
      setSelected(new Set());
      loadRuns(page);
    } catch {
      setError("Failed to delete selected runs.");
    }
  };

  const handleDeleteAll = async () => {
    if (!window.confirm(`Delete all ${total} runs? This cannot be undone.`)) return;
    try {
      await deleteAllRuns();
      setSelected(new Set());
      setPage(1);
      loadRuns(1);
    } catch {
      setError("Failed to delete all runs.");
    }
  };

  return (
    <div>
      {error && (
        <div className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950 px-4 py-3 text-sm text-red-700 dark:text-red-400">
          <span>⚠ {error}</span>
          <button
            onClick={() => setError(null)}
            className="text-red-400 hover:text-red-600 dark:hover:text-red-300 cursor-pointer shrink-0"
          >
            ✕
          </button>
        </div>
      )}

      <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
        Enter a prompt and see how each model responds in real-time.
      </p>

      {/* ── Input area ── */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_220px] gap-3 mb-3">
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleGenerate();
          }}
          placeholder="Enter your prompt here…"
          rows={4}
          className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2.5 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-green-400 dark:focus:ring-green-600 placeholder:text-gray-300 dark:placeholder:text-gray-600"
        />

        {/* Params panel */}
        <div className="flex flex-col gap-3 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-3">
          <label className="text-xs text-gray-500 dark:text-gray-400">
            <div className="flex justify-between mb-1">
              <span>Max Tokens</span>
              <input
                type="number"
                min={1}
                max={32768}
                value={maxTokens}
                onChange={(e) =>
                  setMaxTokens(Math.max(1, parseInt(e.target.value) || 1))
                }
                className="w-16 text-right bg-transparent border-b border-gray-200 dark:border-gray-700 focus:outline-none text-gray-700 dark:text-gray-300 text-xs"
              />
            </div>
            <input
              type="range"
              min={64}
              max={4096}
              step={64}
              value={maxTokens}
              onChange={(e) => setMaxTokens(parseInt(e.target.value))}
              className="w-full accent-green-500 cursor-pointer"
            />
          </label>

          <label className="text-xs text-gray-500 dark:text-gray-400">
            <div className="flex justify-between mb-1">
              <span>Temperature</span>
              <input
                type="number"
                min={0}
                max={2}
                step={0.1}
                value={temperature}
                onChange={(e) =>
                  setTemperature(
                    Math.min(2, Math.max(0, parseFloat(e.target.value) || 0)),
                  )
                }
                className="w-16 text-right bg-transparent border-b border-gray-200 dark:border-gray-700 focus:outline-none text-gray-700 dark:text-gray-300 text-xs"
              />
            </div>
            <input
              type="range"
              min={0}
              max={2}
              step={0.05}
              value={temperature}
              onChange={(e) => setTemperature(parseFloat(e.target.value))}
              className="w-full accent-green-500 cursor-pointer"
            />
          </label>
        </div>
      </div>

      {/* Generate button */}
      <button
        onClick={handleGenerate}
        disabled={generating || !prompt.trim()}
        className={cn(
          "w-full py-3 rounded-lg font-semibold text-sm transition-colors",
          generating || !prompt.trim()
            ? "bg-gray-200 dark:bg-gray-800 text-gray-400 dark:text-gray-600 cursor-not-allowed"
            : "bg-green-500 hover:bg-green-600 text-white cursor-pointer",
        )}
      >
        {generating ? "⏳ Generating…" : "🚀 Generate All"}
      </button>

      {/* Example prompts */}
      <div className="mt-3 flex flex-wrap gap-2">
        <span className="text-xs text-gray-400 dark:text-gray-500 self-center">
          ≡ Examples:
        </span>
        {EXAMPLE_PROMPTS.map((ex) => (
          <button
            key={ex}
            onClick={() => setPrompt(ex)}
            className="text-xs px-2.5 py-1 rounded-full border border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors max-w-[260px] truncate cursor-pointer"
            title={ex}
          >
            {ex}
          </button>
        ))}
      </div>

      {/* ── Model columns ── */}
      <div className="mt-5 grid grid-cols-1 md:grid-cols-3 gap-4">
        {modelNames.map((name, idx) => (
          <ModelColumn
            key={name}
            name={name}
            state={
              modelStates[name] ?? {
                status: "idle",
                text: "",
                metrics: null,
                error: null,
              }
            }
            colorIdx={idx}
          />
        ))}
      </div>

      {/* ── History ── */}
      <RunsTable
        runs={runs}
        total={total}
        page={page}
        pageSize={PAGE_SIZE}
        modelNames={modelNames}
        selected={selected}
        loading={runsLoading}
        onToggle={toggleSelected}
        onToggleAll={toggleAll}
        onPageChange={setPage}
        onDelete={handleDelete}
        onDeleteAll={handleDeleteAll}
      />
    </div>
  );
}
