# VibinGuard

VibinGuard is a local-first security guard for AI-generated code. Its primary goal is to catch secrets and high-risk patterns before they become commits, logs, screenshots, or shared artifacts.

## MVP status

The current MVP includes:

- A VS Code extension with a pre-paste clipboard guard.
- Current-file, project, and scan-on-save checks.
- Native diagnostics and a detailed output channel.
- A friendly security review grouped by file with plain-language guidance.
- A reusable TypeScript scanning core.
- A lightweight Fastify API for generated-content and project scans.
- Deterministic local rules with redacted evidence.
- An optional second semantic review through a local, loopback-only Ollama model.
- Local AI correction proposals that are redacted, re-scanned, previewed, and applied only after confirmation.

The extension does not currently intercept arbitrary output from third-party AI extensions. The clipboard guard owns the pre-insertion path, while file and project scans provide defense before commit. Local AI is disabled by default and deterministic protection does not depend on it.

## Repository

```text
packages/core       Shared scanner and security rules
packages/extension  VS Code extension and VSIX packaging
packages/backend    Optional Fastify API
packages/cli        Early CLI package
docs                Architecture notes
```

## Development

Requirements: Node.js 22 or newer and npm 10 or newer.

```powershell
npm ci
npm run typecheck
npm run test
npm run build
```

Build the local VSIX:

```powershell
npm run package --workspace vibin-guard
```

The package is written to `packages/extension/dist/vibin-guard.vsix`.

Build the single-file pilot kit with the VSIX, English test guide, and SHA-256 checksum:

```powershell
npm run package:pilot --workspace vibin-guard
```

The kit is written to `packages/extension/dist/vibinguard-0.2.0-pilot.zip`.

## Security and privacy

The extension runs without telemetry or remote AI calls. Its optional AI review communicates only with a user-configured loopback Ollama process after minimizing and redacting source context. Do not use real credentials in examples, tests, screenshots, or issue reports.

See `SECURITY.md` for vulnerability reporting guidance and `packages/extension/PRIVACY.md` for extension data handling.

## License

MIT
