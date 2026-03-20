# LLM Comparator

[![Deploy to DigitalOcean](https://www.deploytodo.com/do-btn-blue.svg)](https://cloud.digitalocean.com/apps/new?repo=https://github.com/oconnoob/llm-comparator-pub/tree/main)

Compare outputs from three LLM inference endpoints side-by-side, with real-time streaming, latency metrics, and a reward-model-driven quality analysis pipeline.

## Features

**Prompt page**
- Send a prompt to three models simultaneously and watch responses stream in real time
- Per-model latency metrics: TTFT, total generation time, tokens/sec, token count
- Latency figures are end-to-end (client → server → model → client) and include network overhead
- Paginated run history with scored indicator; JSONL export and bulk delete

**Analyze page**
- Upload a `.jsonl` dataset (prompt-only, prompt+responses, or fully annotated)
- Automatically generate responses and/or score them with a preference model
- Select runs to filter charts: win-rate pie, avg helpfulness score, avg tokens, avg TTFT, avg tok/s
- Per-run results table with full detail panel; JSONL export and bulk delete

**Demo mode**
- Set `DEMO_MODE=true` to show an API key input in the header
- Users supply their own key; it is used only for inference calls and never stored
- Each browser session gets isolated run history (no sharing between users)

## Prerequisites

- Python 3.12+ and [uv](https://docs.astral.sh/uv/)
- Node.js 18+ and npm

## Quick Start (local dev)

```bash
git clone https://github.com/oconnoob/llm-comparator-pub
cd llm-comparator
cp .env.example .env
# Edit .env with your endpoints and keys
```

**Backend:**
```bash
uv sync
uv run python main.py
# → http://localhost:8000
```

**Frontend:**
```bash
cd frontend
npm install
npm run dev
# → http://localhost:5173
```

## Configuration

All model names and endpoints are set via environment variables. All endpoints must be OpenAI-compatible (`POST /v1/chat/completions`).

```env
# Inference models — base URL only, no /chat/completions suffix
MODEL_1_ENDPOINT=https://inference.do-ai.run   # serverless inference, dedicated endpoint, or local Ollama
MODEL_1_NAME=GPT-OSS 120B                       # display name shown in UI
MODEL_1_MODEL_ID=openai-gpt-oss-120b            # API model identifier (required for most hosted APIs)
MODEL_1_API_KEY=sk-...

MODEL_2_ENDPOINT=...
MODEL_2_NAME=...
MODEL_2_MODEL_ID=...
MODEL_2_API_KEY=...

MODEL_3_ENDPOINT=...
MODEL_3_NAME=...
MODEL_3_MODEL_ID=...
MODEL_3_API_KEY=...

# Preference / scoring model (any capable instruction model works)
PREFERENCE_MODEL_ENDPOINT=...
PREFERENCE_MODEL_NAME=...
PREFERENCE_MODEL_MODEL_ID=...
PREFERENCE_MODEL_API_KEY=...

# Demo mode (optional)
DEMO_MODE=false
CORS_ORIGINS=http://localhost:5173,http://localhost:3000
```

### Endpoint options

Any OpenAI-compatible endpoint works:

- **[DigitalOcean Serverless Inference](https://www.digitalocean.com/products/ai-ml/serverless-inference)** — pay-per-token, no setup required. Use `https://inference.do-ai.run` as the endpoint and set `MODEL_ID` to the model slug (e.g. `llama3.3-70b-instruct`).
- **DigitalOcean dedicated endpoints** — lower latency, reserved throughput. Use the endpoint URL assigned to your deployment.
- **Local Ollama** — `http://localhost:11434` with no API key required.
- **Any other OpenAI-compatible API** — set the base URL and API key accordingly.

See `.env.example` for a local/self-hosted configuration and `.env.demo.example` for a DigitalOcean Serverless Inference demo setup.

## JSONL Dataset Format

The Analyze page accepts three forms of JSONL input. See `examples/` for sample files.

**Form 1 — prompt only** (responses and scores generated automatically):
```json
{"prompt": "Explain quantum entanglement simply."}
```

**Form 2 — prompt + responses** (only scoring/ranking generated):
```json
{"prompt": "Hello", "responses": {"Model A": "Hi!", "Model B": "Hey!"}, "metrics": {...}}
```

**Form 3 — fully annotated** (imported as-is, no generation):
```json
{"prompt": "Hello", "responses": {...}, "scores": {"Model A": 4.5}, "rankings": {"Model A": 1}}
```

## Deploying to DigitalOcean App Platform

Two App Platform specs are included:

| File | Purpose |
|------|---------|
| `.do/app.yaml` | Production deployment — you supply model endpoints and API keys |
| `.do/app-demo.yaml` | Demo deployment — models pre-configured, users supply their own key via the UI |

**Deploy with [doctl](https://docs.digitalocean.com/reference/doctl/how-to/install/):**

```bash
# First-time deploy — creates the app and returns an app ID
doctl apps create --spec .do/app.yaml

# Subsequent deploys — update the existing app
doctl apps update <app-id> --spec .do/app.yaml

# Look up your app ID
doctl apps list
```

You can also deploy from the dashboard: create a new app from the GitHub repo and DO will detect `.do/app.yaml` automatically.

The SQLite database is stored on the container's ephemeral filesystem. For persistent history across deploys, attach a DO Managed Database (Postgres) and update `DATABASE_URL`.

## Development

```bash
# Run tests
uv run pytest

# Lint / format
uv run ruff check app/ tests/
uv run ruff format app/ tests/

# FastAPI interactive docs (local)
# http://localhost:8000/docs
```

The pre-commit hook runs lint + format + tests automatically before each commit.

## Project Structure

```
├── app/                  FastAPI backend
│   ├── config.py         Settings (pydantic-settings, env vars)
│   ├── main.py           App factory + static file serving
│   ├── models/           ORM (SQLAlchemy), Pydantic schemas
│   ├── repositories/     DB access layer
│   ├── routers/          HTTP route handlers (runs, analyze, health)
│   └── services/         LLM client, scoring, JSONL helpers
├── frontend/             React + Vite + Tailwind frontend
│   └── src/
│       ├── api/          Typed API client + TypeScript types
│       └── pages/        PromptPage, AnalyzePage
├── tests/                pytest test suite
├── examples/             Sample JSONL files for import
├── docs/                 Architecture, ADRs, diagrams, API contracts
├── .do/app.yaml          DigitalOcean App Platform spec (production)
├── .do/app-demo.yaml     DigitalOcean App Platform spec (demo mode)
├── main.py               Dev entry point (uvicorn)
├── .env.example          Environment variable template (local/self-hosted)
└── .env.demo.example     Environment variable template (demo mode, DO Serverless Inference)
```

## Architecture

See [`docs/AI_CONTEXT.md`](docs/AI_CONTEXT.md) for full architecture documentation and [`docs/adr/`](docs/adr/) for architecture decisions.
