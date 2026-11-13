# Changelog

## 0.2.2

### Security

- Fixed a Windows issue where an untrusted repository could plant its own `git.exe` next to a dotenv file and have VibinGuard run it. Git is now resolved to an absolute path from `PATH`, runs with `core.fsmonitor` disabled, and never runs in untrusted workspaces (Restricted Mode support is now `limited`).

### Detection

- Detects provider credential formats (OpenAI and Anthropic, Stripe live, AWS, GitHub, GitLab, Slack, Supabase secret keys, PEM private keys), Supabase `service_role` keys, and database URLs with embedded passwords.
- Hardcoded-secret detection now matches names that contain the keyword, such as `OPENAI_API_KEY` and `stripeSecretKey`.
- Fewer false positives: placeholder values, labels without digits, environment variable names, URLs, prompts built from local data, and request bodies validated further down the handler are no longer flagged. Unvalidated `req.body` is reported once per file.

### Workflow

- Added **Paste anyway** for blocked clipboard content, and `vibinguard-ignore` / `vibinguard-ignore-next-line` comments with optional rule ids for file and project scans.
- Blocked clipboard findings now appear in the security review instead of marking unrelated editor lines.

### Fixes

- Project scans no longer return zero files when `node_modules` holds more files than the scan limit.
- Saving or scanning one file no longer clears the diagnostics and review entries of other files.
- After an insertion or fix, the whole document is rechecked so diagnostic positions stay correct.

## 0.2.1

- Fixed the Marketplace README icon and documentation links for the monorepo layout.
- Updated installation and testing documentation for the public Marketplace release.

## 0.2.0

- Added an optional second security review through a loopback-only Ollama instance.
- Added source minimization, secret redaction, strict structured-output validation, timeouts, and deterministic fallback for local AI reviews.
- Added semantic checks for authorization, tenant isolation, trust boundaries, business logic, and indirect data exposure.
- Added a friendly security review grouped by file, plain-language diagnostics, and copyable AI correction requests.
- Added local AI corrections with redacted input, corrected-code preview, accept/discard controls, and mandatory re-scanning before application.
- Added commands to configure and verify local AI without making it a runtime requirement.
- Kept local AI disabled by default and skipped it whenever a deterministic rule already blocks generated content.
- Standardized prompts, notifications, diagnostics, logs, and pilot documentation in English.
- Replaced per-secret dotenv findings with Git-aware exposure checks and excluded private dotenv files from local AI review.
- Added structured, color-coded VS Code log output with clearer spacing and severity levels.
- Added an English pilot guide and a reproducible ZIP bundle containing the VSIX and its SHA-256 checksum.

## 0.1.1

- Renamed the extension and its public identifiers to VibinGuard before the first Marketplace release.
- Fixed extension activation by publishing a CommonJS bundle.
- Added integration tests that run inside the VS Code Extension Host.
- Added Marketplace metadata, privacy documentation, and packaging validation.
- Removed the inactive AI provider setting from the MVP configuration.

## 0.1.0

- Added current file scan command.
- Added project scan command.
- Added generated clipboard guard before paste.
- Added VS Code diagnostics and VibinGuard output panel.
