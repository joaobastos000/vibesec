# VibinGuard Architecture

VibinGuard is organized around a shared core scanner.

1. The generation guard checks AI-generated drafts in memory before they are written, committed, logged, or shared.
2. Static analyzers produce deterministic findings from local code.
3. Optional external tools enrich results with Semgrep and npm audit.
4. The AI layer adds explanation, fix prompts, and patch suggestions only after local secret checks pass.
5. Interfaces consume one normalized scan result shape.

The MVP keeps networked AI optional so solo developers can run in local-only mode with Ollama or static-only scans.

## Generation Guard

The generation guard is VibinGuard's first security boundary. It accepts code or diffs produced by an AI coding tool as an in-memory draft, runs local deterministic rules, and returns a blocking decision.

Blocking findings include hardcoded secrets, secret-like public environment variables, and high or critical severity issues. When blocked, callers must not apply the generated content to the workspace, print it into logs, send it to a remote model, or allow it into a commit.

Typical flow:

1. AI coding tool proposes code.
2. Extension, CLI, or backend calls `guardGeneratedContent`.
3. VibinGuard returns `blocked: true` with findings and a fix prompt, or `blocked: false`.
4. Only non-blocked content may be written to disk.

The backend exposes this as `POST /guard/generated` for local integrations.

