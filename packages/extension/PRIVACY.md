# VibinGuard Privacy

VibinGuard 0.1.x performs its MVP security checks locally inside the VS Code extension host.

## Data processed

- Clipboard text is read only when the user runs **VibinGuard: Guard Clipboard Before Paste**.
- Supported workspace files are read when the user starts a scan or when scan-on-save is enabled.
- Findings are shown through VS Code diagnostics and the VibinGuard output channel.

## Data transmission

The extension does not collect telemetry and does not send clipboard contents, source code, findings, or credentials to VibinGuard or to a remote AI provider.

## Retention

VibinGuard does not maintain a remote service or database for extension data. Diagnostic and output content remains in the local VS Code session. Detected credential evidence is redacted before it is displayed.

## Reports

Never include a real credential in a bug report, screenshot, test fixture, or support request. Revoke and rotate any credential that may have been exposed outside VibinGuard.
