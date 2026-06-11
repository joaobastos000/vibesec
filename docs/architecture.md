# VibeGuard Architecture

VibeGuard is organized around a shared core scanner.

1. Static analyzers produce deterministic findings from local code.
2. Optional external tools enrich results with Semgrep and npm audit.
3. The AI layer adds explanation, fix prompts, and patch suggestions.
4. Interfaces consume one normalized scan result shape.

The MVP keeps networked AI optional so solo developers can run in local-only mode with Ollama or static-only scans.

