# @vibinguard/core

Shared scanner engine for VibinGuard.

The core package is intentionally interface-agnostic. It can run from the CLI, the backend API, or a VS Code extension and returns one normalized `ScanResult`.

## What It Does

- Discovers supported source files in Node.js, Next.js, Express, and NestJS projects.
- Runs deterministic local checks for common AI-generated security mistakes.
- Optionally invokes Semgrep and npm audit when available.
- Produces friendly bilingual explanations and copy-paste fix prompts.
- Calculates a Vibe Security Score from 0 to 100.

## Example

```ts
import { createScanner } from "@vibinguard/core";

const scanner = createScanner({
  language: "pt-BR",
  ai: { provider: "local" },
});

const result = await scanner.scan({
  target: process.cwd(),
  mode: "project",
});

console.log(result.score.value);
```

## MVP Boundaries

This package ships safe local heuristics first. The AI analyzer is designed as a provider boundary so the backend can later plug in LangChain.js, OpenAI, Anthropic, Ollama, and RAG without changing CLI or extension contracts.

