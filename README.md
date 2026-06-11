# VibeGuard

VibeGuard is an AI security assistant for vibe coders: developers who ask Cursor, Claude, Copilot, or similar agents to generate code and need fast, practical security review before shipping.

The MVP focuses on solo developers:

- VS Code extension for scanning the current file or project.
- CLI for local scans, watch mode, and Markdown reports.
- Lightweight Node.js backend for heavier AI and RAG workflows.
- Shared TypeScript core engine used by every interface.

## Monorepo

```text
vibeguard/
  packages/
    core/       Shared hybrid scanner engine
    backend/    Fastify API service
    cli/        Terminal interface
    extension/  VS Code extension
  docs/
```

## Stack

- Node.js 22, TypeScript, npm workspaces, Turbo, tsup.
- Fastify, Helmet, Zod.
- LangChain.js with OpenAI/Anthropic-ready interfaces and local Ollama fallback.
- Semgrep, ESLint security rules, and npm audit integration points.
- Chroma or Supabase Vector for the later RAG-backed knowledge base.

## Quick Start

```bash
npm install
npm run build
npm run test
```

Run a core smoke scan after build:

```bash
npm --workspace @vibeguard/core run test
```

## Current Status

This first milestone creates the full monorepo structure and implements the shared `@vibeguard/core` scanner. Backend, CLI, and extension packages are scaffolded and ready for the next steps.


# @vibeguard/backend

Fastify API that exposes the `@vibeguard/core` scanner over HTTP.  
Used by the CLI and VS Code extension for heavier scans and future AI/RAG workflows.

## Quick start

```bash
# from monorepo root
npm install
npm run build

# start the dev server (auto-restarts on change)
npm --workspace @vibeguard/backend run dev
```

The server listens on `http://127.0.0.1:4317` by default.

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `4317` | TCP port |
| `HOST` | `127.0.0.1` | Bind address |
| `NODE_ENV` | — | Set to `production` to suppress stack traces |

Copy `.env.example` to `.env` at the repo root and fill in the AI provider keys as needed.

## Endpoints

### `GET /health`

```bash
curl http://127.0.0.1:4317/health
```

```json
{ "status": "ok", "version": "0.1.0", "timestamp": "2025-01-01T00:00:00.000Z" }
```

### `GET /version`

```bash
curl http://127.0.0.1:4317/version
```

```json
{ "name": "@vibeguard/backend", "version": "0.1.0", "engine": ">=22.0.0" }
```

### `POST /scan`

```bash
curl -X POST http://127.0.0.1:4317/scan \
  -H "Content-Type: application/json" \
  -d '{
    "target": ".",
    "mode": "project",
    "config": {
      "language": "pt-BR",
      "ai": { "provider": "disabled" }
    }
  }'
```

Returns a `ScanResult` from `@vibeguard/core` — score, summary, and full findings list.

**Body schema:**

| Field | Type | Required | Default |
|---|---|---|---|
| `target` | `string` (non-empty) | ✅ | — |
| `mode` | `"file" \| "project"` | no | `"project"` |
| `config` | `Partial<ScanConfig>` | no | `{}` |

## Tests

```bash
npm --workspace @vibeguard/backend run test
```

## Architecture notes

- `src/server.ts` — exports `buildServer()` (testable) and `startServer()` (process entry).  
- `src/index.ts` — loads `.env` and calls `startServer()` only when run directly.  
- LangChain/RAG stubs are intentionally absent; the `config.ai` field is passed straight to `@vibeguard/core`, which already handles provider dispatch.
