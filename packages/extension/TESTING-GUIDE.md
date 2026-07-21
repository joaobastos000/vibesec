# VibinGuard Testing Guide

Thank you for testing VibinGuard. The goal of this guide is to verify that the extension catches exposed secrets and risky AI-generated code with clear, useful guidance.

## Safety first

Use fake data only. Never place a real password, token, API key, private `.env` file, or private source code in a report, screenshot, or conversation.

## Requirements

- VS Code 1.101 or newer on desktop.
- VibinGuard installed from the Marketplace or from a local `vibin-guard.vsix` file.
- A small disposable test project.
- Ollama only if you want to test the optional local AI layer.

Node.js is not required to install or use the extension. It is required only for building VibinGuard from source.

## Testing scope and limitations

- The main scanner supports TypeScript, JavaScript, JSX, TSX, JSON, and dotenv files.
- C#, Python, Java, Go, and other languages do not yet receive full-file scanning.
- The clipboard guard can still detect generic secrets in unsupported language files.
- Files larger than 256 KB are skipped.
- Project discovery is limited to 800 files and skips generated directories such as `node_modules` and `dist`.
- The guarded path runs only through **VibinGuard: Guard Clipboard Before Paste**. Regular `Ctrl+V` is not intercepted.
- Scan on save runs after content reaches the editor.
- VibinGuard does not yet install a Git hook to block commits or pushes.
- The extension reduces risk but does not replace code review, tests, or a professional security assessment.
- Deterministic rules can produce false positives and false negatives.
- VSIX installations do not update automatically.
- Windows is covered by automated extension-host tests. macOS and Linux still need practical validation.
- VS Code-compatible editors such as Cursor and Windsurf may accept the VSIX but are not officially validated.

## Dotenv behavior

Secrets are expected in private dotenv files such as `.env` and `.env.local`. VibinGuard does not report every value in those files as a hardcoded secret.

Instead, it asks the local Git executable whether the file is:

- **Ignored:** no secret finding is shown.
- **Untracked and not ignored:** one warning asks you to protect the file with `.gitignore`.
- **Tracked:** one high-severity finding warns that the file may already be exposed through Git history.

Private dotenv contents are never sent to the local AI model. Templates that are normally committed, including `.env.example`, `.env.sample`, and `.env.template`, continue receiving normal hardcoded-secret checks.

If Git is unavailable or the file is outside a Git repository, VibinGuard cannot verify its exposure status and does not report individual dotenv values.

## Local AI limitations

- Ollama is not bundled with the VSIX.
- Only a local Ollama endpoint is supported. Cloud providers are not available in this build.
- The endpoint must use `localhost`, `127.0.0.1`, or `::1`.
- In SSH, WSL, or Dev Containers, localhost may refer to the remote environment.
- Model speed and quality depend on the tester's hardware and selected model.
- The semantic review selects at most eight relevant files and approximately 18,000 redacted characters per request.
- Model output can vary. No finding does not prove that code is secure.
- Generated fixes are scanned again, require confirmation, and are never saved automatically.

## 1. Install the extension

Install **VibinGuard** from the VS Code Marketplace or run:

```powershell
code --install-extension vibinguard.vibin-guard
```

For a manual VSIX installation:

1. Open VS Code.
2. Open the Extensions view.
3. Open the view menu (`...`).
4. Select **Install from VSIX...**.
5. Choose `vibin-guard.vsix`.
6. Run **Developer: Reload Window** if VS Code asks.

Manual VSIX command-line installation:

```powershell
code --install-extension vibin-guard.vsix --force
```

Open the Command Palette and search for `VibinGuard`. The public commands should be visible.

## 2. Test a safe guarded paste

Copy this snippet:

```ts
export const port = Number(process.env.PORT ?? 3000);
```

Open a TypeScript file and run **VibinGuard: Guard Clipboard Before Paste**.

Expected result:

- The code is inserted.
- VibinGuard reports that security checks passed.
- No security diagnostic is created.

## 3. Test a blocked fake secret

Copy this intentionally fake value:

```ts
const apiKey = "not-a-real-secret-1234567890";
```

Run **VibinGuard: Guard Clipboard Before Paste**.

Expected result:

- The paste is blocked before the content enters the file.
- A friendly finding explains the risk and next step.
- The full fake value does not appear in diagnostics or logs.
- **Open security review** and a fix action are available.

## 4. Test current-file scanning

Create a disposable TypeScript file:

```ts
export const findUser = (id: string) =>
  db.query(`SELECT * FROM users WHERE id = ${id}`);
```

Run **VibinGuard: Scan Current File**.

Expected result:

- The risky line receives a diagnostic.
- **VibinGuard: Show Security Review** displays the finding.
- Technical fields such as category, severity, CWE, and OWASP references remain available through **Technical details**.
- **VibinGuard: Show Output** displays a spaced scan summary with colored log levels.

## 5. Test scan on save

1. Confirm that **VibinGuard: Scan On Save** is enabled.
2. Save a supported file containing one of the unsafe examples.

Expected result:

- A diagnostic appears after save.
- The user does not see raw JSON.
- Saving is not cancelled.

## 6. Test project scanning

Open a small test folder and run **VibinGuard: Scan Project**.

Expected result:

- Supported files are scanned.
- Findings appear in Problems and the security review.
- Generated directories do not dominate the results.
- The output channel contains a structured summary with totals, severity counts, duration, and AI status.

## 7. Test protected dotenv files

1. Add `.env` to the test project's `.gitignore`.
2. Create `.env` with this fake value:

```dotenv
API_KEY=not-a-real-secret-1234567890
```

3. Run **VibinGuard: Scan Current File**.

Expected result: no hardcoded-secret finding is created.

Remove the `.env` ignore rule and scan again. Expected result: one warning explains that the private dotenv file is not protected by Git. VibinGuard should not list each variable as a separate finding.

Do not perform this test with real credentials.

## 8. Test optional local AI

Install Ollama separately and download the recommended model:

```powershell
ollama pull qwen2.5-coder:3b-instruct
```

Run these commands:

1. **VibinGuard: Configure Local AI**
2. **VibinGuard: Check Local AI**

Expected result:

- VibinGuard confirms that the model is available.
- If Ollama is stopped, deterministic checks continue working.
- Source is sent only to a loopback address.

## 9. Test a semantic finding

Use a disposable example with missing ownership validation:

```ts
app.get("/invoice/:id", async (request, reply) => {
  const invoice = await db.invoice.findUnique({
    where: { id: request.params.id },
  });
  return reply.send(invoice);
});
```

With local AI enabled, run **VibinGuard: Scan Current File**.

The model may identify missing authorization or tenant isolation. Model behavior varies, so record a miss as test feedback instead of adding real application data.

## 10. Test a local AI fix

1. Enable local AI.
2. Repeat the fake-secret test.
3. Choose **Fix with local AI**.

Expected result:

- The original fake value does not appear in the request or preview.
- The proposed replacement is scanned again.
- A proposal with a blocking issue is rejected.
- An approved proposal opens in a separate preview.
- **Apply fix** changes the target; **Discard** leaves it unchanged.
- The target file is not saved automatically.
- If the original file changes during generation, VibinGuard cancels the application.

## What to report

Please record:

- VS Code version and operating system.
- File type and language tested.
- Whether Ollama was enabled and which model was used.
- The command that was run.
- Expected and actual behavior.
- Whether the wording was clear to a non-security specialist.
- Any false positive, missed issue, slowdown, crash, repeated warning, or wrong line number.

Use a minimal disposable reproduction. Never attach a private project or real credential.

## Updating or removing the pilot

Install a newer pilot with `--force` or use **Install from VSIX...** again. To remove VibinGuard, open Extensions, select VibinGuard, and choose **Uninstall**.
