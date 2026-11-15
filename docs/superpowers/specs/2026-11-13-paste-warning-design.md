# Paste warning design

Date: 2026-11-13. Status: awaiting approval. Size: small change.

## Intent

Today VibinGuard only checks clipboard content when the developer remembers to run
**Guard Clipboard Before Paste**, and a normal Ctrl+V is never checked. The goal is to
check every paste automatically. The developer pastes as usual and then reads a
message that says what is wrong in the code they just pasted.

## Goals

- Every Ctrl+V (and Paste from the context or Edit menu) into a supported file is
  checked with the deterministic rules. No command is needed.
- The paste itself is never blocked, delayed noticeably, or changed.
- After the paste, a message names the problems found in the pasted code, and the
  affected lines are marked in the editor.

## Non-goals

- Blocking or rewriting pasted code. The existing **Guard Clipboard Before Paste**
  command stays as the blocking path.
- Agents that write files directly to disk (Codex, Claude Code). That is a separate
  feature.
- New languages. The paste warning covers the file types VibinGuard already supports.

## Anti-goals

- Warnings when developers move their own code around inside VS Code.
- Any change to what lands in the editor.

## Approaches considered

1. **Paste provider as an observer (chosen).** Register
   `vscode.languages.registerDocumentPasteEditProvider`, read `text/plain` from the
   data transfer, scan it, and return no edits, so VS Code's normal paste runs
   unchanged. It covers Ctrl+V and menu paste. It depends on
   `editor.pasteAs.enabled`, which is on by default.
2. **Heuristic on document changes.** Watch `onDidChangeTextDocument` and compare large
   insertions with the clipboard. Rejected: it reads the clipboard on every edit and
   cannot tell a paste from completions or formatting.
3. **Rebind Ctrl+V.** A command that scans and then runs the default paste. Rejected:
   it conflicts with Vim and other keymaps and misses menu paste.

## Design

- **Provider.** It is registered for supported documents with `scheme: "file"`
  (TypeScript, JavaScript, JSON, `.env*`), with
  `pasteMimeTypes: ["text/plain"]` and a `providedPasteEditKinds` entry of its own.
  `provideDocumentPasteEdits` always returns `undefined`.
- **Internal copies are skipped.** `prepareDocumentPaste` adds a VibinGuard marker
  MIME type to copies made in a VS Code editor. Pastes that carry the marker are not
  checked. Copies from a browser, a chat app, or another window are checked.
- **Scan.** `guardGeneratedContent` runs with deterministic rules only. Local AI is not
  used on paste, so the paste stays instant; the manual command still uses AI. Text
  above `performance.maxFileSizeKb` is skipped.
- **After the paste.** A one-shot `onDidChangeTextDocument` listener for that
  document (2 s timeout) waits for the paste to land and then reuses
  `refreshDocumentFindings` to recheck the whole document, so diagnostic positions
  are correct.
- **Message.** It is shown when the pasted code has at least one medium or higher
  finding. Critical and high findings use an error notification; medium findings use
  a warning notification. Low and info findings get diagnostics only.
  - One finding: `VibinGuard: the pasted code <friendly title> (line N of the paste). <next step>`
  - Several findings: `VibinGuard found N problems in the pasted code: <title 1>; <title 2>; …`
  - Actions: **Open security review**, plus **Fix with local AI** or
    **Copy AI fix prompt** for the first finding.
- **Setting.** `vibinguard.scanOnPaste` (boolean, default `true`).
- **Unchanged.** The **Guard Clipboard Before Paste** command keeps its blocking
  behavior.

## Left to the builder

- The exact `DocumentDropOrPasteEditKind` value.
- Message wording within the format above. UI text stays in English, like the rest
  of the extension.
- Tests: core needs no change. An integration test triggers
  `editor.action.clipboardPasteAction` with a fake secret in the clipboard and asserts
  that the pasted text is unchanged and that a VibinGuard diagnostic appears on the
  pasted line.
