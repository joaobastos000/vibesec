# @vibinguard/backend

Fastify API that exposes the `@vibinguard/core` scanner over HTTP.
Used by the CLI and VS Code extension for heavier scans and future AI/RAG workflows.

## Quick start

```bash
# from monorepo root
npm install
npm run build

# start the dev server (auto-restarts on change)
npm --workspace @vibinguard/backend run dev
```

The server listens on `http://127.0.0.1:4317` by default.

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `4317` | TCP port |
| `HOST` | `127.0.0.1` | Bind address |
| `NODE_ENV` | — | Set to `production` to suppress stack traces |
| `VIBINGUARD_API_TOKEN` | random per run | Token required on every `POST` request, at least 16 characters. When unset, a random token is printed once at startup. |
| `VIBINGUARD_ALLOWED_HOSTS` | — | Comma-separated extra `Host` header names to accept. `127.0.0.1`, `localhost`, and `[::1]` are always accepted. |

Copy `.env.example` to `.env` at the repo root and fill in the AI provider keys as needed.

## Access control

The API reads files from disk, so it is locked down even on loopback:

- Every `POST` request must send `Authorization: Bearer <token>`. Missing or wrong tokens get `401 UNAUTHORIZED`.
- Requests whose `Host` header is not a loopback name or listed in `VIBINGUARD_ALLOWED_HOSTS` get `403 FORBIDDEN_HOST`. This blocks DNS-rebinding attacks from web pages.
- If you bind to a non-loopback `HOST`, set `VIBINGUARD_API_TOKEN` and `VIBINGUARD_ALLOWED_HOSTS` explicitly.

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
{ "name": "@vibinguard/backend", "version": "0.1.0", "engine": ">=22.0.0" }
```

### `POST /scan`

```bash
curl -X POST http://127.0.0.1:4317/scan \
  -H "Authorization: Bearer $VIBINGUARD_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "target": ".",
    "mode": "project",
    "config": {
      "ai": { "provider": "disabled" }
    }
  }'
```

Returns a `ScanResult` from `@vibinguard/core` — score, summary, and full findings list.

**Body schema:**

| Field | Type | Required | Default |
|---|---|---|---|
| `target` | `string` (non-empty) | ✅ | — |
| `mode` | `"file" \| "project"` | no | `"project"` |
| `config` | `Partial<ScanConfig>` | no | `{}` |

## Tests

```bash
npm --workspace @vibinguard/backend run test
```

## Architecture notes

- `src/server.ts` — exports `buildServer()` (testable) and `startServer()` (process entry).  
- `src/index.ts` — loads `.env` and calls `startServer()` only when run directly.  
- LangChain/RAG stubs are intentionally absent; the `config.ai` field is passed straight to `@vibinguard/core`, which already handles provider dispatch.
