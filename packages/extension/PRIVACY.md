# VibinGuard Privacy

VibinGuard 0.2.x performs deterministic security checks locally inside the VS Code extension host and can optionally use a local Ollama model as a second review layer.

## Data processed

- Clipboard text is read only when the user runs **VibinGuard: Guard Clipboard Before Paste**.
- Supported workspace files are read when the user starts a scan or when scan-on-save is enabled.
- For private dotenv files, VibinGuard asks the local Git executable whether the file is ignored, tracked, or untracked. Only the file path is passed to Git; dotenv values are not included in the command.
- Findings are shown through VS Code diagnostics and the VibinGuard output channel.
- When local AI is enabled, VibinGuard selects a limited amount of relevant source text and redacts common secret formats before analysis.
- Private dotenv files such as `.env` and `.env.local` are excluded from local AI requests.
- When the user requests a local AI fix, redacted source and finding metadata are sent to the same loopback Ollama process. The original secret value is not included in the request or corrected-code preview.

## Data transmission

The extension does not collect telemetry and does not send clipboard contents, source code, findings, or credentials to VibinGuard or to a remote AI provider.

The optional AI layer accepts only a loopback Ollama address (`localhost`, `127.0.0.1`, or `::1`). Reduced and redacted analysis context is sent to that user-controlled local process. If a deterministic rule already blocks generated content, VibinGuard skips the AI request so the blocking content is not shared with the model.

VibinGuard does not currently support cloud AI providers in the extension.

## Retention

VibinGuard does not maintain a remote service or database for extension data. Diagnostic and output content remains in the local VS Code session. Detected credential evidence is redacted before it is displayed. Ollama model behavior and retention are controlled by the user's local Ollama installation.

Generated fixes are held in memory, scanned again, and shown in an untitled local preview. They are applied only after the user confirms and are not automatically saved by VibinGuard.

## Reports

Never include a real credential in a bug report, screenshot, test fixture, or support request. Revoke and rotate any credential that may have been exposed outside VibinGuard.
