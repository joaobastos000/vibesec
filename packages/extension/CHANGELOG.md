# Changelog

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
