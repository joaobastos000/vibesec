# Paste Warning and 0.2.3 Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Warn automatically after every Ctrl+V with what is wrong in the pasted code, and fix five smaller defects that make VibinGuard report wrong or incomplete results.

**Architecture:** A paste provider observes pastes without changing them. It scans the pasted text with the deterministic rules, waits for the paste to land, rechecks the document, and shows a message. The core gains a balanced-argument parser for `jwt.sign`, `.gitignore`-aware discovery with a limit signal, and a helper that merges multi-folder results. The extension uses those, fixes clipboard messages, and shows AI fixes as a diff.

**Tech Stack:** TypeScript, VS Code API `^1.101` (`registerDocumentPasteEditProvider`, `registerTextDocumentContentProvider`, `vscode.diff`), `node:test` via `tsx` (core), `@vscode/test-electron` (extension), `ignore@5.3.2` (already a core dependency).

**Spec:** `docs/superpowers/specs/2026-11-13-paste-warning-design.md` (Task 6). Tasks 1–5 implement the defects agreed in conversation on 2026-11-14.

## Global Constraints

- The paste is never blocked, changed, or noticeably delayed. `provideDocumentPasteEdits` always returns `undefined` and never awaits the scan.
- Local AI is never called on paste. The paste scan uses `createExtensionScannerConfig({ allowAi: false })`.
- Copies made inside a VS Code editor are not checked; copies from other apps are.
- Paste warnings cover only supported documents: `scheme: "file"` with language `typescript`, `typescriptreact`, `javascript`, `javascriptreact`, `json`, or a file name starting with `.env`.
- Messages: critical/high → `showErrorMessage`; medium → `showWarningMessage`; low/info → diagnostics only.
- New setting `vibinguard.scanOnPaste`, boolean, default `true`.
- **Guard Clipboard Before Paste** keeps its blocking behavior.
- Git never runs when `vscode.workspace.isTrusted` is false (from 0.2.2).
- UI text stays in English. Secret values never appear in messages, diagnostics, or evidence.
- Version becomes `0.2.3`.

## Review Focus

1. **Paste in the middle of a non-empty file:** diagnostics land on the editor lines where the code was pasted, not on line 1. Test in Task 6.
2. **CRLF `.gitignore` on Windows:** entries still match. Test in Task 2.
3. **`jwt.sign` whose payload contains commas, nested braces, or strings with commas:** still parsed correctly. A call with options in a variable (`jwt.sign(p, s, opts)`) is not flagged, because its contents are unknown. Tests in Task 1.
4. **Paste into an unsupported file (`.py`) or with `scanOnPaste` off:** no diagnostics and no message. Tests in Task 6.
5. **Pasted text over `performance.maxFileSizeKb` (256 KB):** skipped silently, and the paste still happens. Test in Task 6.

---

### Task 1: `jwt.sign` detection with real argument parsing

**Files:**
- Create: `packages/core/src/analyzers/call-arguments.ts`
- Modify: `packages/core/src/analyzers/static-rules.ts` (rule `jwt-without-expiry`; `Rule.evidence` signature)
- Test: `packages/core/src/regressions.test.ts`

**Interfaces:**
- Produces: `splitCallArguments(content: string, openParenIndex: number): string[] | undefined`. `openParenIndex` is the index of the `(`. It returns the trimmed top-level arguments, or `undefined` if the call is not closed within 2000 characters. It respects `()`, `[]`, `{}`, `'`, `"`, and template literals (including `${…}`).
- Changes: `Rule.evidence?: (match: RegExpMatchArray, content: string) => string`.

- [ ] **Step 1: Write failing tests** in `regressions.test.ts`:
  - `flags jwt.sign with a multi-key payload and no options`: `jwt.sign({ id: user.id, role: user.role }, process.env.JWT_SECRET);` → one finding with title `JWT signed without explicit expiration`.
  - `flags jwt.sign with options that omit expiresIn`: `jwt.sign({ id }, secret, { algorithm: "HS256" })` → one finding.
  - `does not flag jwt.sign with expiresIn`: `jwt.sign({ id, role }, secret, { expiresIn: "15m" })` → no findings.
  - `does not flag jwt.sign with exp in the payload`: `jwt.sign({ id, exp: Math.floor(Date.now() / 1000) + 900 }, secret)` → no findings.
  - `does not flag jwt.sign with options in a variable`: `jwt.sign(payload, secret, signOptions)` → no findings.
  - `parses strings and nested braces in jwt.sign payloads`: `jwt.sign({ name: "a, b", meta: { tags: ["x", "y"] } }, secret)` → one finding.
- [ ] **Step 2:** Run `npm test --workspace @vibinguard/core`. Expected: the first, second, and last new tests FAIL.
- [ ] **Step 3: Implement `splitCallArguments`**, then change the rule:
  - Set `pattern: /\bjwt\.sign\s*\(/g`.
  - `accept(match, content)`: parse with `splitCallArguments`. Return `true` when the payload is not `/\bexp\s*:/` and either there are exactly 2 arguments, or the third argument starts with `{` and lacks `/\bexpiresIn\b/`. Otherwise return `false`.
  - `evidence(match, content)`: `compactEvidence` applied to `jwt.sign(<args joined by ", ">)`.
  - Update the call site in `runBuiltInRules` to pass `file.content`.
- [ ] **Step 4:** Run `npm test --workspace @vibinguard/core`. Expected: all pass, including the 41 existing tests.
- [ ] **Step 5:** Commit: `fix(core): detect jwt.sign without expiry for real payloads`.

### Task 2: `.gitignore`-aware discovery, limit signal, and merged results

**Files:**
- Modify: `packages/core/src/file-discovery.ts`, `packages/core/src/scanner.ts`, `packages/core/src/types.ts`, `packages/core/src/index.ts`
- Test: `packages/core/src/regressions.test.ts`

**Interfaces:**
- Changes: `discoverFiles(request, config): Promise<{ files: ScanFile[]; limitReached: boolean }>`.
- Produces: `ScanSummary.limitReached?: boolean`, set by `scan()`; `true` when supported candidates exceed `performance.maxFiles`.
- Produces: `mergeScanResults(target: string, results: ScanResult[]): ScanResult`, exported from `@vibinguard/core`. It concatenates findings and sorts them with the existing `compareFindings`. It sums `filesScanned` and `durationMs`, recomputes `bySeverity`, `findings`, and `score`, and sets `limitReached` if any result has it. `ai` is the first result whose `ai.attempted` is true, else `results[0].ai`. It throws on an empty array.

- [ ] **Step 1: Write failing tests:**
  - `skips files listed in the project .gitignore`: a project with `.gitignore` containing `generated/`, plus `generated/a.ts` and `src/b.ts`, each holding a fake secret → `filesScanned === 1` and the finding is in `src/b.ts`.
  - `reads a CRLF .gitignore`: the same with `"generated/\r\n"` → `filesScanned === 1`.
  - `reports when the file limit is reached`: 6 source files with `maxFiles: 5` → `summary.limitReached === true` and `filesScanned === 5`. With 5 files → `limitReached === false`.
  - `merges results from several folders`: two temp projects with one secret each → merged `findings.length === 2`, `summary.filesScanned === 2`, `summary.bySeverity.critical === 2`, `score.value === 40`.
- [ ] **Step 2:** Run the core tests. Expected: the new tests FAIL.
- [ ] **Step 3: Implement.** In project mode, read `<target>/.gitignore` if it exists (root file only; nested `.gitignore` files are out of scope), build `ignore().add(text)`, and filter candidates by their POSIX relative path. Compute `limitReached = candidates.length > maxFiles` before slicing. Add `mergeScanResults` in `scanner.ts`.
- [ ] **Step 4:** Run the core tests. Expected: all pass.
- [ ] **Step 5:** Commit: `fix(core): respect .gitignore, report the file limit, merge folder results`.

### Task 3: Project scan covers every workspace folder

**Files:**
- Modify: `packages/extension/src/extension.ts` (`scanProject`, `writeScanResult`, `showScanNotice`)

**Interfaces:**
- Consumes: `mergeScanResults`, `ScanSummary.limitReached` (Task 2).

- [ ] **Step 1: Implement.** `scanProject` scans each folder in `vscode.workspace.workspaceFolders`.
  - Merge with `mergeScanResults(target, results)`. `target` is the folder path for one folder, or `"<n> workspace folders"` for several.
  - Then `replaceFindings(merged.findings, "all", merged.ai)`.
  - When `limitReached`, `writeScanResult` adds `Limit     : only the first 800 supported files per folder were scanned`, and `showScanNotice` appends ` Part of the project was not scanned because it has more than 800 supported files.` The number comes from the resolved config's `performance.maxFiles`.
- [ ] **Step 2:** Run `npm run typecheck`. Expected: no errors. The existing integration test `scans the open workspace` covers the single-folder path in Task 7. Multi-folder merging is covered by Task 2's test.
- [ ] **Step 3:** Commit: `fix(extension): scan every workspace folder and report the file limit`.

### Task 4: Truthful clipboard messages when automatic insertion is off

**Files:**
- Modify: `packages/extension/src/extension.ts` (`guardClipboardBeforePaste`, `buildClipboardReviewItems` label)
- Test: `packages/extension/src/test/suite.ts`

- [ ] **Step 1: Write a failing integration test**, `does not insert or claim insertion when insertSafeClipboard is off`. Set `insertSafeClipboard` to `false`, put `safeSnippet` in the clipboard, and run the guard command. Then assert that the document text is `""` and that there are no VibinGuard diagnostics. Restore the setting to `true` in a `finally` block.
- [ ] **Step 2:** Run `npm test --workspace vibin-guard`. Expected: the new test passes or fails. The message bug itself is not observable from tests, so Step 3 is verified by reading the code.
- [ ] **Step 3: Implement.** When not inserting:
  - With findings: store them in `blockedClipboardFindings` and show the warning `VibinGuard checked the clipboard and found N issue(s). It was not inserted because vibinguard.insertSafeClipboard is off.` with **Open security review**.
  - Without findings: show the info message `VibinGuard: the clipboard passed security checks. Automatic insertion is off (vibinguard.insertSafeClipboard), so paste it yourself.`
  - In both cases, never show a message containing "inserted" as if it happened.
  - Rename the review separator to `Clipboard content (not inserted)`.
- [ ] **Step 4:** Run the extension tests. Expected: all pass.
- [ ] **Step 5:** Commit: `fix(extension): stop claiming clipboard insertion when it is disabled`.

### Task 5: Show local AI fixes as a diff

**Files:**
- Create: `packages/extension/src/proposal-documents.ts`
- Modify: `packages/extension/src/extension.ts` (`activate`, `fixFindingWithLocalAi`; remove `previewLanguage` if unused)
- Test: `packages/extension/src/test/suite.ts`

**Interfaces:**
- Produces: `class ProposalDocuments implements vscode.TextDocumentContentProvider`, with:
  - `static readonly scheme = "vibinguard-proposal"`
  - `put(side: "original" | "proposed", fileName: string, content: string): vscode.Uri`, which returns a unique URI per call
  - `delete(uri: vscode.Uri): void`
  - `provideTextDocumentContent(uri: vscode.Uri): string`
- The content is kept in memory only, so no untitled-document backups are written.

- [ ] **Step 1: Write a failing integration test**, `serves proposal content from memory`. `put("proposed", "a.ts", "x")`, then `openTextDocument(uri)` → `getText() === "x"`. After `delete(uri)`, the provider returns `""`.
- [ ] **Step 2:** Run the extension tests. Expected: FAIL (module missing).
- [ ] **Step 3: Implement.** Register the provider in `activate`. In `fixFindingWithLocalAi`:
  - Replace the untitled preview with `vscode.diff`. The left side is the document URI for whole-file targets, or `put("original", …, target.content)` for clipboard targets. The right side is `put("proposed", …, result.replacement)`.
  - Use the title `VibinGuard fix: <file name> (current ↔ proposed)` and open with `{ preview: true, viewColumn: vscode.ViewColumn.Beside }`.
  - After the modal decision, close the diff with `workbench.action.closeActiveEditor` and delete both proposal URIs.
- [ ] **Step 4:** Run the extension tests. Expected: all pass.
- [ ] **Step 5:** Commit: `feat(extension): review local AI fixes in a diff`.

### Task 6: Automatic warning after paste

**Files:**
- Create: `packages/extension/src/friendly-findings.ts` (move `friendlyFinding`, `friendlyRecommendation`, `formatCount` out of `extension.ts` and export them; no behavior change)
- Create: `packages/extension/src/paste-observer.ts`
- Create: `packages/extension/src/paste-warning-message.ts`
- Modify: `packages/extension/src/extension.ts` (`activate`, new `handlePaste`), `packages/extension/package.json` (setting), `packages/extension/README.md`, `packages/extension/PRIVACY.md`
- Test: `packages/extension/src/test/suite.ts`

**Interfaces:**
- Produces in `paste-observer.ts`:
  - `const internalCopyMimeType = "application/vnd.vibinguard.editor-copy"`
  - `const pasteSelector: vscode.DocumentSelector`, built from the languages and the `.env*` pattern in Global Constraints
  - `interface PasteEvent { document: vscode.TextDocument; ranges: readonly vscode.Range[]; text: string }`
  - `createPasteObserver(onPaste: (event: PasteEvent) => void): vscode.DocumentPasteEditProvider`, registered with metadata `{ providedPasteEditKinds: [vscode.DocumentDropOrPasteEditKind.Empty.append("vibinguard")], pasteMimeTypes: ["text/plain"], copyMimeTypes: [internalCopyMimeType] }`
- Produces in `paste-warning-message.ts`: `formatPasteWarning(findings: Finding[]): { level: "error" | "warning"; message: string } | undefined`. Findings have editor line numbers.
  - Exactly one medium+ finding: `VibinGuard found a problem in the pasted code (line L): <friendly title>. <friendly recommendation>`
  - Several: `VibinGuard found N problems in the pasted code: <title> (line L); <title> (line L); <title> (line L) and K more.` Titles are listed for at most 3 findings, and the ` and K more` suffix appears only when K > 0.
  - Low/info only, or none: `undefined`.
- Produces in `extension.ts`: `handlePaste(event: PasteEvent): void`.
  - It registers a one-shot `onDidChangeTextDocument` listener for `event.document` synchronously, with a 2000 ms timeout, then continues asynchronously.
  - It skips text over 256 KB.
  - It scans with `guardGeneratedContent` using `allowAi: false` and the 0.2.2 trust rule for `gitStatus`.
  - It locates findings with `locateClipboardFindings(findings, document, event.ranges[0].start)`.
  - After the change arrives, it calls `refreshDocumentFindings(document, [], undefined)`, then shows `formatPasteWarning(located)` with actions **Open security review** and the correction action for the first located finding (via `handleFindingAction`).

- [ ] **Step 1: Write failing integration tests:**
  - `formats a single high paste warning as an error`: one `hardcoded-secret` finding at line 3 → `level === "error"`, and the message includes `(line 3)` but not the secret.
  - `formats a medium paste warning as a warning`: one `insecure-cors` finding → `level === "warning"`.
  - `skips paste warnings for low findings`: one `low` finding → `undefined`.
  - `summarizes many paste findings`: 5 medium findings → message includes `5 problems` and ` and 2 more`.
  - `warns after Ctrl+V without changing the pasted text`: clipboard `fakeSecret`, empty supported file, run `editor.action.clipboardPasteAction` → document text equals `fakeSecret`, and `waitForDiagnostics` finds an Error on line index 0.
  - `places paste diagnostics where the code was pasted`: document `"// a\n// b\n"` with the cursor at line 2 (0-based), then paste `fakeSecret` → a VibinGuard Error diagnostic starts at line 2.
  - `ignores code copied inside the editor`: a document containing `fakeSecret`; select all, run `editor.action.clipboardCopyAction`, then paste into an empty supported file → no VibinGuard diagnostics on the target after 500 ms.
  - `ignores pastes when scanOnPaste is off`: setting `false`, paste → no VibinGuard diagnostics after 500 ms. Restore the setting in `finally`.
  - `ignores pastes into unsupported files`: paste into `.vibinguard-paste.py` → no VibinGuard diagnostics after 500 ms.
  - `skips pasted text above 256 KB`: a clipboard with a fake secret followed by 300 KB of `//` lines → text pasted unchanged, and no VibinGuard diagnostics after 500 ms.
- [ ] **Step 2:** Run the extension tests. Expected: the new tests FAIL. If the Ctrl+V tests fail because the test host does not invoke paste providers for `editor.action.clipboardPasteAction`, stop and report this to the user before changing the approach.
- [ ] **Step 3: Implement** the three modules, `handlePaste`, the registration in `activate` behind `scanOnPaste`, and the `vibinguard.scanOnPaste` setting. Then update the docs:
  - `README.md`: add a "Paste warnings" section.
  - `PRIVACY.md`: pasted text is read from the paste data on every paste into supported files and checked locally with deterministic rules only.
- [ ] **Step 4:** Run the extension tests. Expected: all pass.
- [ ] **Step 5:** Commit: `feat(extension): warn about problems in pasted code`.

### Task 7: Release check

**Files:**
- Modify: `packages/extension/package.json` (version `0.2.3`), `packages/extension/CHANGELOG.md` (0.2.3 entry listing Tasks 1–6), `README.md` (pilot kit name), `package-lock.json`

- [ ] **Step 1:** Bump the version and write the changelog entry.
- [ ] **Step 2:** Run `npm run release:check`. Expected: exit 0, all core, backend, and extension tests pass, and `Packaged: dist/vibin-guard.vsix`.
- [ ] **Step 3:** Run `unzip -p packages/extension/dist/vibin-guard.vsix extension/package.json`. Expected: `"version": "0.2.3"` and `vibinguard.scanOnPaste` present.
- [ ] **Step 4:** Commit: `chore(extension): prepare 0.2.3`.
