# VibinGuard

<img src="assets/icon.png" alt="VibinGuard icon" width="128">

VibinGuard is a local security guard for AI-generated code. It catches secrets and common security mistakes before they reach a commit, and it can guard clipboard content before it is inserted into the editor.

## What it does

- Guards clipboard content in memory before paste.
- Blocks hardcoded secrets and high-risk generated code.
- Scans the current file, the workspace, and supported files on save.
- Shows findings as native VS Code diagnostics.
- Presents findings in a friendly security review grouped by file, with technical details kept secondary.
- Provides safe refactoring requests that can be copied to a coding assistant.
- Optionally runs a second semantic review through a local Ollama model.
- Can generate a local secure refactor, show only the corrected-code preview, and apply it after both layers approve it.
- Runs without telemetry or remote AI calls.

## Detected patterns

- Hardcoded credentials and tokens.
- Private `.env` files that are tracked by Git or are not protected by `.gitignore`.
- Client-side secret exposure.
- JWTs without explicit expiration.
- SQL built with string interpolation or concatenation.
- Unsafe raw HTML rendering.
- Request bodies used without nearby schema validation.
- Untrusted input concatenated into LLM prompts.
- Permissive CORS configurations.
- Semantic authorization, tenant-isolation, trust-boundary, business-logic, and data-exposure risks when local AI is enabled.

## Optional local AI review

The deterministic security rules are always the first layer. The optional second layer uses Ollama on the same computer and is disabled by default.

1. Install [Ollama](https://ollama.com/).
2. Download the recommended small code model:

```powershell
ollama pull qwen2.5-coder:3b-instruct
```

3. Run **VibinGuard: Configure Local AI** and keep the recommended model name.
4. Run **VibinGuard: Check Local AI**.

Before a local AI request, VibinGuard selects a limited amount of relevant code and redacts common credentials, private keys, JWTs, and authorization tokens. Only loopback addresses such as `127.0.0.1` and `localhost` are accepted. If Ollama is unavailable, the deterministic checks continue normally.

Private dotenv files such as `.env` and `.env.local` are never sent to the AI model. Because secrets are expected there, VibinGuard does not report each value as a hardcoded secret. Instead, it checks Git status and reports one clear exposure warning only when the file is tracked or is not protected by an ignore rule. Committed templates such as `.env.example`, `.env.sample`, and `.env.template` continue receiving normal secret checks.

If Git is unavailable or the file is outside a Git repository, VibinGuard cannot verify dotenv exposure and does not treat individual dotenv values as findings.

When a local rule already blocks generated content, especially a secret, VibinGuard skips the AI call entirely. AI findings must match a strict internal schema and cannot reduce or dismiss a deterministic finding.

For **Fix with Local AI**, VibinGuard redacts the original content before requesting a complete replacement. The proposed replacement is scanned again by deterministic rules and local AI. A proposal with a blocking finding is rejected; an approved proposal is shown in an untitled preview and changes the target only after explicit confirmation. VibinGuard does not automatically save the edited file.

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
- `VibinGuard: Show Security Review`
- `VibinGuard: Configure Local AI`
- `VibinGuard: Check Local AI`
- `VibinGuard: Show Output`

## Settings

- `vibinguard.scanOnSave`: scans supported files after save. Enabled by default.
- `vibinguard.insertSafeClipboard`: inserts clipboard content when no blocking issue is found. Enabled by default.
- `vibinguard.ai.enabled`: enables the optional Ollama review. Disabled by default.
- `vibinguard.ai.runOnSave`: also uses local AI on save. Disabled by default.
- `vibinguard.ai.model`: local Ollama model name.
- `vibinguard.ai.baseUrl`: loopback-only Ollama address.
- `vibinguard.ai.timeoutMs`: local model timeout.
- `vibinguard.ai.maxInputChars`: maximum redacted source characters included in one review.

## Supported files

TypeScript, JavaScript, JSX, TSX, JSON, and dotenv files are supported by the MVP.

## Safe test

For a complete pilot checklist, see [TESTING-GUIDE.md](TESTING-GUIDE.md).

Use only fake values when testing secret detection:

```ts
const apiKey = "fake_test_1234567890abcdef";
```

Copy the snippet, open a TypeScript file, and run **VibinGuard: Guard Clipboard Before Paste**. The content should be blocked and the full fake value should not appear in diagnostics or logs.

## Privacy

VibinGuard does not collect telemetry or send source code to a VibinGuard service. If local AI is enabled, reduced and redacted context is sent only to the loopback Ollama address configured by the user. See [PRIVACY.md](PRIVACY.md).

## Current limitation

VibinGuard cannot intercept arbitrary edits made directly by third-party AI extensions. The clipboard guard protects the pre-insertion path; scan-on-save and project scans cover code after it reaches the editor but before commit.

AI review is an additional signal, not proof that code is secure. High-confidence AI findings can block guarded paste, while lower-confidence findings are presented for review.

## Support

See [SUPPORT.md](SUPPORT.md) for troubleshooting and reporting guidance. Never include a real credential in a report.
