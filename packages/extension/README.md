# VibinGuard

<img src="assets/icon.png" alt="VibinGuard icon" width="128">

VibinGuard is a local security guard for AI-generated code. It catches secrets and common security mistakes before they reach a commit, and it can guard clipboard content before it is inserted into the editor.

## What it does

- Guards clipboard content in memory before paste.
- Blocks hardcoded secrets and high-risk generated code.
- Scans the current file, the workspace, and supported files on save.
- Shows findings as native VS Code diagnostics.
- Provides explanations and secure refactoring prompts in the VibinGuard output channel.
- Runs deterministic MVP checks locally without telemetry or remote AI calls.

## Detected patterns

- Hardcoded credentials and tokens.
- Client-side secret exposure.
- JWTs without explicit expiration.
- SQL built with string interpolation or concatenation.
- Unsafe raw HTML rendering.
- Request bodies used without nearby schema validation.
- Untrusted input concatenated into LLM prompts.
- Permissive CORS configurations.

## Install a VSIX

1. Open the Extensions view in VS Code.
2. Open the view menu and select **Install from VSIX...**.
3. Choose `vibin-guard.vsix`.
4. Run **Developer: Reload Window**.

Command-line installation:

```powershell
code --install-extension vibin-guard.vsix --force
```

## Commands

- `VibinGuard: Guard Clipboard Before Paste`
- `VibinGuard: Scan Current File`
- `VibinGuard: Scan Project`
- `VibinGuard: Show Output`

## Settings

- `vibinguard.language`: language used in generated security guidance (`pt-BR` or `en-US`).
- `vibinguard.scanOnSave`: scans supported files after save. Enabled by default.
- `vibinguard.insertSafeClipboard`: inserts clipboard content when no blocking issue is found. Enabled by default.

## Supported files

TypeScript, JavaScript, JSX, TSX, JSON, and `.env` files are supported by the MVP.

## Safe test

Use only fake values when testing secret detection:

```ts
const apiKey = "fake_test_1234567890abcdef";
```

Copy the snippet, open a TypeScript file, and run **VibinGuard: Guard Clipboard Before Paste**. The content should be blocked and the full fake value should not appear in diagnostics or logs.

## Privacy

The MVP processes clipboard content and project files locally. It does not collect telemetry or send source code to a remote service. See [PRIVACY.md](PRIVACY.md).

## Current limitation

VibinGuard cannot intercept arbitrary edits made directly by third-party AI extensions. The clipboard guard protects the pre-insertion path; scan-on-save and project scans cover code after it reaches the editor but before commit.

## Support

See [SUPPORT.md](SUPPORT.md) for troubleshooting and reporting guidance. Never include a real credential in a report.
