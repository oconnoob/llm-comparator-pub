import { useCallback, useEffect, useRef, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  createAnalysisJob,
  createAnalysisJobFromRuns,
  deleteRuns,
  exportRunsUrl,
  getAllRuns,
  getRun,
  getRuns,
  streamAnalysisJob,
} from "../api/client";
import type {
  AnalysisProgressEvent,
  RunDetail,
  RunListItem,
} from "../api/types";
import { cn } from "../lib/utils";

// ── Colors ───────────────────────────────────────────────────────────────────

const PALETTE = ["#22c55e", "#3b82f6", "#f97316", "#a855f7", "#ef4444"];

// ── Chart helpers ─────────────────────────────────────────────────────────────

interface ChartData {
  modelNames: string[];
  scoredCount: number;
  winRates: Array<{ name: string; value: number }>;
  avgScores: Array<{ name: string; value: number }>;
  avgTokens: Array<{ name: string; value: number }>;
  avgTtft: Array<{ name: string; value: number }>;
  avgTps: Array<{ name: string; value: number }>;
}

function buildChartData(runs: RunListItem[]): ChartData | null {
  if (runs.length === 0) return null;

  // Collect all model names from responses
  const modelSet = new Set<string>();
  for (const r of runs) {
    for (const m of Object.keys(r.responses)) modelSet.add(m);
  }
  const modelNames = [...modelSet];
  if (modelNames.length === 0) return null;

  // Metrics accumulators
  const tokenSums: Record<string, number> = {};
  const tokenN: Record<string, number> = {};
  const ttftSums: Record<string, number> = {};
  const ttftN: Record<string, number> = {};
  const tpsSums: Record<string, number> = {};
  const tpsN: Record<string, number> = {};
  for (const m of modelNames) {
    tokenSums[m] = tokenN[m] = ttftSums[m] = ttftN[m] = tpsSums[m] = tpsN[m] = 0;
  }

  for (const r of runs) {
    for (const [m, resp] of Object.entries(r.responses)) {
      const mt = resp.metrics;
      if (mt.token_count != null) { tokenSums[m] += mt.token_count; tokenN[m]++; }
      if (mt.ttft_ms != null)     { ttftSums[m]  += mt.ttft_ms;     ttftN[m]++;  }
      if (mt.tokens_per_sec != null) { tpsSums[m] += mt.tokens_per_sec; tpsN[m]++; }
    }
  }

  // Scoring (only scored runs)
  const scorable = runs.filter((r) => r.rankings && r.scores);
  const scoredModelNames =
    scorable.length > 0 ? Object.keys(scorable[0].rankings!) : modelNames;
  const winCounts: Record<string, number> = {};
  const scoreSums: Record<string, number> = {};
  for (const m of scoredModelNames) { winCounts[m] = scoreSums[m] = 0; }
  for (const r of scorable) {
    for (const m of scoredModelNames) {
      if (r.rankings![m] === 1) winCounts[m]++;
      scoreSums[m] += r.scores![m] ?? 0;
    }
  }

  return {
    modelNames,
    scoredCount: scorable.length,
    winRates: scoredModelNames.map((m) => ({
      name: m,
      value: scorable.length > 0
        ? Math.round((winCounts[m] / scorable.length) * 100)
        : 0,
    })),
    avgScores: scoredModelNames.map((m) => ({
      name: m,
      value: scorable.length > 0
        ? parseFloat((scoreSums[m] / scorable.length).toFixed(2))
        : 0,
    })),
    avgTokens: modelNames.map((m) => ({
      name: m,
      value: tokenN[m] > 0 ? Math.round(tokenSums[m] / tokenN[m]) : 0,
    })),
    avgTtft: modelNames.map((m) => ({
      name: m,
      value: ttftN[m] > 0 ? Math.round(ttftSums[m] / ttftN[m]) : 0,
    })),
    avgTps: modelNames.map((m) => ({
      name: m,
      value: tpsN[m] > 0 ? parseFloat((tpsSums[m] / tpsN[m]).toFixed(1)) : 0,
    })),
  };
}

// ── Sub-components ────────────────────────────────────────────────────────────

function ChartCard({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-800 p-4">
      <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">
        {title}
      </h3>
      {children}
    </div>
  );
}

function HBarChart({
  title,
  data,
  unit = "",
  maxDomain,
}: {
  title: string;
  data: Array<{ name: string; value: number }>;
  unit?: string;
  maxDomain?: number;
}) {
  return (
    <ChartCard title={title}>
      <ResponsiveContainer width="100%" height={160}>
        <BarChart data={data} layout="vertical" margin={{ left: 8, right: 24 }}>
          <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e5e7eb" />
          <XAxis
            type="number"
            domain={[0, maxDomain ?? "auto"]}
            tick={{ fontSize: 10 }}
            tickFormatter={(v: number) => `${v}${unit}`}
          />
          <YAxis type="category" dataKey="name" width={80} tick={{ fontSize: 10 }} />
          <Tooltip
            formatter={(v) => [`${v}${unit}`]}
            contentStyle={{ fontSize: 11 }}
          />
          <Bar dataKey="value" radius={[0, 3, 3, 0]}>
            {data.map((_, i) => (
              <Cell key={i} fill={PALETTE[i % PALETTE.length]} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

function WinPieChart({ data }: { data: Array<{ name: string; value: number }> }) {
  return (
    <ChartCard title="Win Rate (%)">
      <ResponsiveContainer width="100%" height={200}>
        <PieChart margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
          <Pie
            data={data}
            dataKey="value"
            nameKey="name"
            cx="50%"
            cy="45%"
            outerRadius={60}
            label={({ value }) => (value ? `${value}%` : "")}
            labelLine={false}
          >
            {data.map((_, i) => (
              <Cell key={i} fill={PALETTE[i % PALETTE.length]} />
            ))}
          </Pie>
          <Tooltip
            formatter={(v) => [`${v}%`]}
            contentStyle={{ fontSize: 11 }}
          />
          <Legend wrapperStyle={{ fontSize: 10 }} verticalAlign="bottom" />
        </PieChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

function ProgressLog({ events }: { events: string[] }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [events]);

  if (events.length === 0) return null;

  return (
    <div
      ref={ref}
      className="mb-4 max-h-32 overflow-y-auto rounded-lg border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900 p-3 text-xs font-mono space-y-0.5"
    >
      {events.map((e, i) => (
        <div key={i} className="text-gray-500 dark:text-gray-400">
          {e}
        </div>
      ))}
    </div>
  );
}

function DetailPanel({
  result,
  onClose,
}: {
  result: RunDetail;
  onClose: () => void;
}) {
  const models = Object.keys(result.responses);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl max-w-3xl w-full max-h-[80vh] overflow-y-auto">
        <div className="sticky top-0 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 px-5 py-3 flex justify-between items-center">
          <h3 className="text-sm font-semibold">Run Detail</h3>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-lg cursor-pointer"
          >
            ✕
          </button>
        </div>
        <div className="px-5 py-4 space-y-4">
          <div>
            <p className="text-xs text-gray-400 uppercase tracking-wider mb-1">
              Prompt
            </p>
            <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap">
              {result.prompt}
            </p>
          </div>
          {models.map((m, i) => (
            <div key={m}>
              <div className="flex items-center gap-2 mb-1">
                <span
                  className="text-xs font-semibold"
                  style={{ color: PALETTE[i % PALETTE.length] }}
                >
                  {m}
                </span>
                {result.rankings && (
                  <span className="text-xs text-gray-400">
                    Rank #{result.rankings[m]} · Score{" "}
                    {result.scores?.[m]?.toFixed(1) ?? "—"}/5
                  </span>
                )}
              </div>
              <p className="text-xs text-gray-600 dark:text-gray-400 whitespace-pre-wrap bg-gray-50 dark:bg-gray-800 rounded p-2">
                {result.responses[m].text}
              </p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

const PAGE_SIZE = 20;
const MAX_LOG = 200;

export function AnalyzePage({
  demoMode = false,
  apiKey = "",
  onNeedApiKey,
}: {
  demoMode?: boolean;
  apiKey?: string;
  onNeedApiKey?: () => void;
}) {
  const [runs, setRuns] = useState<RunListItem[]>([]);
  const [allRuns, setAllRuns] = useState<RunListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [detail, setDetail] = useState<RunDetail | null>(null);
  const [running, setRunning] = useState(false);
  const [progressLog, setProgressLog] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  const esCleanup = useRef<(() => void) | null>(null);

  const loadPage = useCallback((p: number) => {
    getRuns(p, PAGE_SIZE)
      .then((data) => {
        setRuns(data.items);
        setTotal(data.total);
      })
      .catch(() => setError("Failed to load runs."));
  }, []);

  const loadAllForCharts = useCallback(() => {
    getAllRuns()
      .then(setAllRuns)
      .catch(() => {});
  }, []);

  useEffect(() => { loadPage(page); }, [page, loadPage]);
  useEffect(() => { loadAllForCharts(); }, [loadAllForCharts]);
  useEffect(() => { return () => { esCleanup.current?.(); }; }, []);

  // Stable model names derived from all available runs (for empty-state axes).
  const runsSource = allRuns.length > 0 ? allRuns : runs;
  const stableModelNames = (() => {
    const s = new Set<string>();
    for (const r of runsSource) for (const m of Object.keys(r.responses)) s.add(m);
    return [...s];
  })();
  const stableScoredNames = (() => {
    const scored = runsSource.find((r) => r.scores);
    return scored ? Object.keys(scored.scores!) : stableModelNames;
  })();

  // Charts show data only when rows are selected; zero-value otherwise.
  const chartRuns =
    selectedIds.size > 0
      ? runsSource.filter((r) => selectedIds.has(r.run_id))
      : [];
  const chartData = buildChartData(chartRuns);

  // Always display a ChartData shape so all charts render at fixed size.
  const zeros = (names: string[]) => names.map((name) => ({ name, value: 0 }));
  const displayData: ChartData = chartData ?? {
    modelNames: stableModelNames,
    scoredCount: 0,
    winRates: zeros(stableScoredNames),
    avgScores: zeros(stableScoredNames),
    avgTokens: zeros(stableModelNames),
    avgTtft: zeros(stableModelNames),
    avgTps: zeros(stableModelNames),
  };

  const appendLog = (line: string) => {
    setProgressLog((prev) => {
      const next = [...prev, line];
      return next.length > MAX_LOG ? next.slice(-MAX_LOG) : next;
    });
  };

  const handleEvent = (event: AnalysisProgressEvent) => {
    if (event.type === "status") {
      appendLog(`ℹ ${event.message}`);
    } else if (event.type === "progress") {
      appendLog(`[${event.step}] ${event.completed}/${event.total}`);
    } else if (event.type === "error") {
      appendLog(`✗ ${event.message}`);
    } else if (event.type === "done") {
      appendLog("✓ Done.");
      setRunning(false);
      setSelectedIds(new Set());
      loadPage(1);
      setPage(1);
      loadAllForCharts();
    }
  };

  const startStream = async (jobId: string) => {
    esCleanup.current = streamAnalysisJob(
      jobId,
      handleEvent,
      () => setRunning(false),
      (msg) => { setError(msg); setRunning(false); },
    );
  };

  const handleAnalyzeSelected = async () => {
    if (running) return;
    if (demoMode && !apiKey) { onNeedApiKey?.(); return; }
    esCleanup.current?.();
    esCleanup.current = null;
    setRunning(true);
    setProgressLog([]);
    setError(null);
    try {
      const runIds = selectedIds.size > 0 ? [...selectedIds] : undefined;
      const { job_id } = await createAnalysisJobFromRuns(runIds);
      await startStream(job_id);
    } catch (err) {
      setRunning(false);
      setError(err instanceof Error ? err.message : "Failed to start analysis.");
    }
  };

  const handleLoadExample = async () => {
    // Bypass the demo key guard — example data is pre-scored and needs no inference.
    if (running) return;
    const res = await fetch("/example.jsonl");
    const blob = await res.blob();
    const file = new File([blob], "example.jsonl", { type: "application/x-ndjson" });
    esCleanup.current?.();
    esCleanup.current = null;
    setRunning(true);
    setProgressLog([]);
    setError(null);
    try {
      const { job_id } = await createAnalysisJob(file);
      await startStream(job_id);
    } catch (err) {
      setRunning(false);
      setError(err instanceof Error ? err.message : "Failed to import file.");
    }
  };

  const handleImport = async (file: File) => {
    if (running) return;
    if (demoMode && !apiKey) { onNeedApiKey?.(); return; }
    esCleanup.current?.();
    esCleanup.current = null;
    setRunning(true);
    setProgressLog([]);
    setError(null);
    try {
      const { job_id } = await createAnalysisJob(file);
      await startStream(job_id);
    } catch (err) {
      setRunning(false);
      setError(err instanceof Error ? err.message : "Failed to import file.");
    }
  };

  const handleDelete = async () => {
    if (selectedIds.size === 0 || running) return;
    try {
      await deleteRuns([...selectedIds]);
      setSelectedIds(new Set());
      loadPage(page);
      loadAllForCharts();
    } catch {
      setError("Failed to delete selected runs.");
    }
  };

  const openDetail = (runId: string) => {
    getRun(runId).then(setDetail).catch(() => {});
  };

  const toggleId = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    const allOnPageSelected = runs.every((r) => selectedIds.has(r.run_id));
    if (allOnPageSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        runs.forEach((r) => next.add(r.run_id));
        return next;
      });
    }
  };

  const selectAllGlobal = () => {
    setSelectedIds(new Set(allRuns.map((r) => r.run_id)));
  };

  const totalPages = Math.ceil(total / PAGE_SIZE);
  const allOnPageSelected =
    runs.length > 0 && runs.every((r) => selectedIds.has(r.run_id));
  const allSelected = allOnPageSelected;
  const allGlobalSelected = allRuns.length > 0 && selectedIds.size >= allRuns.length;

  const scoreModelNames = (() => {
    const scored = allRuns.find((r) => r.scores);
    return scored ? Object.keys(scored.scores!) : [];
  })();

  const analyzeLabel =
    selectedIds.size > 0
      ? `🔬 Analyze ${selectedIds.size} selected`
      : `🔬 Analyze all`;

  const chartLabel =
    selectedIds.size > 0
      ? `${selectedIds.size} selected run${selectedIds.size === 1 ? "" : "s"}`
      : `all ${allRuns.length} run${allRuns.length === 1 ? "" : "s"}`;

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

      {/* ── Action bar ── */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <button
          onClick={() => !running && importInputRef.current?.click()}
          disabled={running}
          className="text-xs px-3 py-1.5 rounded-md bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
        >
          📂 Import JSONL
        </button>
        <button
          onClick={handleLoadExample}
          disabled={running}
          className="text-xs px-3 py-1.5 rounded-md bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
        >
          Load example data
        </button>
        <input
          ref={importInputRef}
          type="file"
          accept=".jsonl,application/x-ndjson"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) { handleImport(file); e.target.value = ""; }
          }}
        />

        <button
          onClick={handleAnalyzeSelected}
          disabled={running || total === 0}
          className={cn(
            "text-xs px-3 py-1.5 rounded-md transition-colors",
            running || total === 0
              ? "bg-gray-100 dark:bg-gray-800 text-gray-400 cursor-not-allowed"
              : "bg-green-500 hover:bg-green-600 text-white cursor-pointer",
          )}
        >
          {running ? "⏳ Running…" : analyzeLabel}
        </button>

        {selectedIds.size > 0 && (
          <>
            <button
              onClick={handleDelete}
              disabled={running}
              className="text-xs px-3 py-1.5 rounded-md bg-red-100 dark:bg-red-950 text-red-600 dark:text-red-400 hover:bg-red-200 dark:hover:bg-red-900 transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
            >
              🗑 Delete {selectedIds.size} selected
            </button>
            <button
              onClick={() => setSelectedIds(new Set())}
              className="text-xs px-2 py-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 cursor-pointer"
            >
              Clear
            </button>
          </>
        )}

        <div className="ml-auto flex gap-2">
          {selectedIds.size > 0 && (
            <a
              href={exportRunsUrl([...selectedIds])}
              download="runs.jsonl"
              className="text-xs px-3 py-1.5 rounded-md bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
            >
              Export selected ({selectedIds.size})
            </a>
          )}
          <a
            href={exportRunsUrl()}
            download="runs.jsonl"
            className="text-xs px-3 py-1.5 rounded-md bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
          >
            Export all
          </a>
        </div>
      </div>

      <ProgressLog events={progressLog} />

      {/* ── Charts ── */}
      {total > 0 && (
        <div className="mb-8">
          <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1">
            Charts
          </h2>
          <p className="text-xs text-gray-400 dark:text-gray-500 mb-3">
            {chartData
              ? `Showing ${chartLabel}${chartData.scoredCount > 0 ? ` · ${chartData.scoredCount} scored` : ""}`
              : "Select rows to populate charts"}
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <HBarChart title="Avg Token Count" data={displayData.avgTokens} />
            <HBarChart title="Avg Tokens / sec" data={displayData.avgTps} unit=" tok/s" />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <WinPieChart data={displayData.winRates} />
            <HBarChart
              title="Avg Helpfulness Score"
              data={displayData.avgScores}
              unit="/5"
              maxDomain={5}
            />
          </div>
        </div>
      )}

      {/* ── Unified runs table ── */}
      {total > 0 ? (
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300">
              All Runs ({total})
            </h2>
          </div>

          {/* Select-all-in-database banner (shown when current page is fully checked) */}
          {allOnPageSelected && total > PAGE_SIZE && (
            <div className="mb-2 flex items-center gap-2 rounded-md bg-green-50 dark:bg-green-950/40 border border-green-200 dark:border-green-800 px-3 py-2 text-xs text-green-700 dark:text-green-400">
              {allGlobalSelected ? (
                <>
                  <span>All {allRuns.length} runs are selected.</span>
                  <button
                    onClick={() => setSelectedIds(new Set())}
                    className="underline cursor-pointer hover:no-underline"
                  >
                    Clear selection
                  </button>
                </>
              ) : (
                <>
                  <span>All {runs.length} runs on this page are selected.</span>
                  <button
                    onClick={selectAllGlobal}
                    className="underline cursor-pointer hover:no-underline"
                  >
                    Select all {allRuns.length} runs in the database
                  </button>
                </>
              )}
            </div>
          )}

          <p className="text-xs text-gray-400 dark:text-gray-500 mb-2">
            Tokens/sec reflects steady-state generation throughput and excludes time-to-first-token. Rankings are assigned independently by the scoring model (avoiding ties in the case of equivalent scores).
          </p>
          <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-800">
            <table className="w-full text-xs">
              <thead className="bg-gray-50 dark:bg-gray-900 text-gray-500 dark:text-gray-400">
                <tr>
                  <th className="px-3 py-2 w-8">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={toggleAll}
                      className="cursor-pointer"
                    />
                  </th>
                  <th className="px-3 py-2 text-left font-medium">Date</th>
                  <th className="px-3 py-2 text-left font-medium">Prompt</th>
                  <th className="px-3 py-2 text-left font-medium">Models</th>
                  {scoreModelNames.map((m) => (
                    <th key={m} className="px-3 py-2 text-left font-medium">
                      {m}
                    </th>
                  ))}
                  <th className="px-3 py-2 text-left font-medium">Winner</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {runs.map((r) => {
                  const winner =
                    r.rankings &&
                    Object.entries(r.rankings).find(
                      ([, rank]) => rank === 1,
                    )?.[0];
                  const modelNames = Object.keys(r.responses);
                  return (
                    <tr
                      key={r.run_id}
                      onClick={() => openDetail(r.run_id)}
                      className={cn(
                        "hover:bg-gray-50 dark:hover:bg-gray-900/50 transition-colors cursor-pointer",
                        selectedIds.has(r.run_id) &&
                          "bg-green-50 dark:bg-green-950/30",
                      )}
                    >
                      <td
                        className="px-3 py-2"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <input
                          type="checkbox"
                          checked={selectedIds.has(r.run_id)}
                          onChange={() => toggleId(r.run_id)}
                          className="cursor-pointer"
                        />
                      </td>
                      <td className="px-3 py-2 text-gray-400 whitespace-nowrap">
                        {new Date(r.created_at).toLocaleDateString()}
                      </td>
                      <td className="px-3 py-2 max-w-[200px] truncate text-gray-700 dark:text-gray-300">
                        {r.prompt_preview}
                      </td>
                      <td className="px-3 py-2 text-gray-400">
                        {modelNames.join(", ")}
                      </td>
                      {scoreModelNames.map((m) => (
                        <td
                          key={m}
                          className="px-3 py-2 font-mono text-gray-600 dark:text-gray-400"
                        >
                          {r.scores?.[m] != null
                            ? r.scores[m].toFixed(1)
                            : "—"}
                        </td>
                      ))}
                      <td className="px-3 py-2 font-medium text-green-600 dark:text-green-400">
                        {winner ??
                          (modelNames.length > 0 ? (
                            <span className="text-gray-300 dark:text-gray-600 font-normal">
                              unscored
                            </span>
                          ) : (
                            "—"
                          ))}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="flex justify-center gap-1 mt-3">
              {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
                <button
                  key={p}
                  onClick={() => setPage(p)}
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
      ) : (
        <div className="flex flex-col items-center justify-center py-16 text-center text-gray-400">
          <p className="text-sm">No runs yet.</p>
          <p className="text-xs mt-1">
            Submit prompts on the Prompt page, or import a{" "}
            <code className="bg-gray-100 dark:bg-gray-800 px-1 rounded">
              .jsonl
            </code>{" "}
            file above.
          </p>
        </div>
      )}

      {detail && <DetailPanel result={detail} onClose={() => setDetail(null)} />}
    </div>
  );
}
