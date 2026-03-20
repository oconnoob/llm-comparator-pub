import type {
  AnalysisJobCreated,
  AnalysisProgressEvent,
  AppConfig,
  PaginatedRuns,
  RunDetail,
  RunListItem,
  RunRequest,
  StreamEvent,
} from "./types";

const BASE = "/api";

// ── Demo mode: API key (sessionStorage — cleared on tab close) ────────────────

const API_KEY_SESSION_KEY = "llmc_api_key";

export function getStoredApiKey(): string {
  return sessionStorage.getItem(API_KEY_SESSION_KEY) ?? "";
}

export function setStoredApiKey(key: string): void {
  if (key) {
    sessionStorage.setItem(API_KEY_SESSION_KEY, key);
  } else {
    sessionStorage.removeItem(API_KEY_SESSION_KEY);
  }
}

// ── Demo mode: session ID (localStorage — survives refresh, isolated per user) ─

const SESSION_ID_KEY = "llmc_session_id";

export function getOrCreateSessionId(): string {
  let id = localStorage.getItem(SESSION_ID_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(SESSION_ID_KEY, id);
  }
  return id;
}

function demoHeaders(): Record<string, string> {
  const key = getStoredApiKey();
  const sid = getOrCreateSessionId();
  return {
    ...(key ? { "X-API-Key": key } : {}),
    "X-Session-ID": sid,
  };
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { ...demoHeaders(), ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(text);
  }
  return res.json() as Promise<T>;
}

// ----- Config -----

export async function getConfig(): Promise<AppConfig> {
  return request<AppConfig>("/config");
}

// ----- Runs -----

export async function createRun(body: RunRequest): Promise<{ run_id: string }> {
  return request<{ run_id: string }>("/runs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export async function getRuns(
  page: number,
  pageSize = 20,
): Promise<PaginatedRuns> {
  return request<PaginatedRuns>(`/runs?page=${page}&page_size=${pageSize}`);
}

export async function getAllRuns(): Promise<RunListItem[]> {
  const first = await getRuns(1, 100);
  if (first.total <= 100) return first.items;
  const rest = await Promise.all(
    Array.from({ length: Math.ceil((first.total - 100) / 100) }, (_, i) =>
      getRuns(i + 2, 100),
    ),
  );
  return [...first.items, ...rest.flatMap((p) => p.items)];
}

export async function getRun(runId: string): Promise<RunDetail> {
  return request<RunDetail>(`/runs/${runId}`);
}

export function streamRun(
  runId: string,
  onEvent: (e: StreamEvent) => void,
  onClose: () => void,
  onError?: (msg: string) => void,
): () => void {
  const es = new EventSource(`${BASE}/runs/${runId}/stream`);
  es.onmessage = (e: MessageEvent) => {
    try {
      const event = JSON.parse(e.data as string) as StreamEvent;
      onEvent(event);
      if (event.type === "stream_end") {
        es.close();
        onClose();
      }
    } catch {
      // malformed event — ignore
    }
  };
  es.onerror = () => {
    es.close();
    onError?.("Connection to server lost. Is the backend running?");
    onClose();
  };
  return () => es.close();
}

export async function deleteRuns(runIds: string[]): Promise<void> {
  const params = runIds.length ? `?ids=${runIds.join(",")}` : "";
  const res = await fetch(`${BASE}/runs${params}`, {
    method: "DELETE",
    headers: demoHeaders(),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(text);
  }
}

export async function deleteAllRuns(): Promise<void> {
  await deleteRuns([]);
}

export function exportRunsUrl(ids?: string[]): string {
  const params = ids?.length ? `?ids=${ids.join(",")}` : "";
  return `${BASE}/runs/export${params}`;
}

// ----- Analyze -----

export async function createAnalysisJob(
  file: File,
): Promise<AnalysisJobCreated> {
  const form = new FormData();
  form.append("file", file);
  return request<AnalysisJobCreated>("/analyze/jobs", {
    method: "POST",
    body: form,
  });
}

export async function createAnalysisJobFromRuns(
  runIds?: string[],
): Promise<AnalysisJobCreated> {
  return request<AnalysisJobCreated>("/analyze/jobs/from-runs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ run_ids: runIds ?? null }),
  });
}

export function streamAnalysisJob(
  jobId: string,
  onEvent: (e: AnalysisProgressEvent) => void,
  onClose: () => void,
  onError?: (msg: string) => void,
): () => void {
  const es = new EventSource(`${BASE}/analyze/jobs/${jobId}/stream`);
  es.onmessage = (e: MessageEvent) => {
    try {
      const event = JSON.parse(e.data as string) as AnalysisProgressEvent;
      onEvent(event);
      if (event.type === "done") {
        es.close();
        onClose();
      }
    } catch {
      // malformed event — ignore
    }
  };
  es.onerror = () => {
    es.close();
    onError?.("Connection to server lost. Is the backend running?");
    onClose();
  };
  return () => es.close();
}
