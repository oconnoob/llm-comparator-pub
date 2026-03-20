export interface RunRequest {
  prompt: string;
  temperature: number;
  max_tokens: number;
}

export interface Metrics {
  ttft_ms: number | null;
  total_ms: number | null;
  tokens_per_sec: number | null;
  token_count: number;
}

export interface ModelResponsePreview {
  preview: string;
  metrics: Metrics;
}

export interface ModelResponseDetail {
  text: string;
  metrics: Metrics;
}

export interface RunListItem {
  run_id: string;
  created_at: string;
  prompt_preview: string;
  responses: Record<string, ModelResponsePreview>;
  scores: Record<string, number> | null;
  rankings: Record<string, number> | null;
}

export interface RunDetail {
  run_id: string;
  prompt: string;
  temperature: number;
  max_tokens: number;
  created_at: string;
  responses: Record<string, ModelResponseDetail>;
  scores: Record<string, number> | null;
  rankings: Record<string, number> | null;
}

export interface PaginatedRuns {
  total: number;
  page: number;
  page_size: number;
  items: RunListItem[];
}

// ----- SSE stream events -----

export type StreamEvent =
  | { type: "token"; model: string; token: string }
  | { type: "done"; model: string; metrics: Metrics }
  | { type: "error"; model: string; message: string }
  | { type: "stream_end" };

// ----- Analyze -----

export interface AnalysisJobCreated {
  job_id: string;
  detected_form: number;
}

export type AnalysisProgressEvent =
  | { type: "status"; message: string }
  | { type: "progress"; step: string; completed: number; total: number }
  | { type: "done" }
  | { type: "error"; message: string };

export interface AppConfig {
  models: Array<{ name: string }>;
  demo_mode: boolean;
}
