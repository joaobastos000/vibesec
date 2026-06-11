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

