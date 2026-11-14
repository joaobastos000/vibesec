import assert from "node:assert/strict";
import * as vscode from "vscode";
import { detectGitFileStatus } from "@vibinguard/core";
import { describeClipboardResult } from "../clipboard-messages.js";
import { ProposalDocuments } from "../proposal-documents.js";
import { formatPasteWarning } from "../paste-warning-message.js";
import {
  copyMarkerSelector,
  createCopyMarker,
  createPasteObserver,
  pasteSelector,
} from "../paste-observer.js";
import { startPasteReview } from "../paste-review.js";
import type { Finding } from "@vibinguard/core";

const extensionId = "vibinguard.vibin-guard";
const fakeSecret = 'const apiKey = "fake_test_1234567890abcdef";\n';
const safeSnippet = "const port = Number(process.env.PORT ?? 3000);\n";

interface TestContext {
  unsafeUri: vscode.Uri;
  clipboardUri: vscode.Uri;
  saveUri: vscode.Uri;
  dotenvUri: vscode.Uri;
}

interface IntegrationCase {
  name: string;
  execute: (context: TestContext) => Promise<void>;
}

export async function run(): Promise<void> {
  const context = await setup();
  const failures: string[] = [];

  const cases: IntegrationCase[] = [
    {
      name: "activates and registers every public command",
      execute: testActivation,
    },
    {
      name: "scans the active file and redacts secret evidence",
      execute: testCurrentFileScan,
    },
    {
      name: "blocks unsafe clipboard content before insertion",
      execute: testBlockedClipboard,
    },
    {
      name: "inserts clipboard content that has no blocking finding",
      execute: testSafeClipboard,
    },
    { name: "scans supported files after save", execute: testScanOnSave },
    {
      name: "keeps findings for other files when one file is saved",
      execute: testDiagnosticsSurviveOtherScans,
    },
    {
      name: "does not insert or claim insertion when insertSafeClipboard is off",
      execute: testClipboardWithoutInsertion,
    },
    {
      name: "describes clipboard results truthfully",
      execute: testClipboardMessages,
    },
    {
      name: "serves proposal content from memory",
      execute: testProposalDocuments,
    },
    {
      name: "formats paste warnings by severity",
      execute: testPasteWarningFormats,
    },
    {
      name: "warns after Ctrl+V without changing the pasted text",
      execute: testPasteWarnsWithoutChangingText,
    },
    {
      name: "places paste diagnostics where the code was pasted",
      execute: testPasteDiagnosticsLandOnPastedLines,
    },
    {
      name: "ignores code copied inside the editor",
      execute: testPasteIgnoresInternalCopies,
    },
    {
      name: "ignores pastes when scanOnPaste is off",
      execute: testPasteRespectsSetting,
    },
    {
      name: "ignores pastes into unsupported files",
      execute: testPasteIgnoresUnsupportedFiles,
    },
    {
      name: "skips pasted text above 256 KB",
      execute: testPasteSkipsLargeText,
    },
    {
      name: "defers the paste review so the paste is not delayed",
      execute: testPasteReviewIsDeferred,
    },
    {
      name: "marks copies from every document as internal",
      execute: testCopyMarkerCoversEveryDocument,
    },
    { name: "scans the open workspace", execute: testProjectScan },
    {
      name: "does not flag expected secrets in a Git-ignored dotenv file",
      execute: testIgnoredDotEnv,
    },
  ];

  try {
    console.log("\nVibinGuard extension integration tests");
    for (const integrationCase of cases) {
      try {
        await integrationCase.execute(context);
        console.log(`  PASS ${integrationCase.name}`);
      } catch (error) {
        failures.push(integrationCase.name);
        console.error(`  FAIL ${integrationCase.name}`, error);
      }
    }
  } finally {
    await vscode.commands.executeCommand("workbench.action.closeAllEditors");
    await Promise.all(pasteFiles.map((uri) => deleteIfPresent(uri)));
    await teardown(context);
  }

  if (failures.length > 0) {
    throw new Error(
      `${failures.length} integration test(s) failed: ${failures.join(", ")}`,
    );
  }

  console.log(`  ${cases.length} passing`);
}

async function setup(): Promise<TestContext> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  assert.ok(folder, "The integration-test workspace must be open");

  const context = {
    unsafeUri: vscode.Uri.joinPath(folder.uri, ".vibinguard-unsafe.ts"),
    clipboardUri: vscode.Uri.joinPath(folder.uri, ".vibinguard-clipboard.ts"),
    saveUri: vscode.Uri.joinPath(folder.uri, ".vibinguard-save.ts"),
    dotenvUri: vscode.Uri.joinPath(folder.uri, ".env.vibinguard-test"),
  };

  await vscode.workspace.fs.writeFile(
    context.unsafeUri,
    Buffer.from(fakeSecret),
  );
  await vscode.workspace.fs.writeFile(context.clipboardUri, Buffer.from(""));
  await vscode.workspace.fs.writeFile(context.saveUri, Buffer.from(""));
  await vscode.workspace.fs.writeFile(
    context.dotenvUri,
    Buffer.from('API_KEY="fake_test_1234567890abcdef"\n'),
  );

  const configuration = vscode.workspace.getConfiguration("vibinguard");
  await configuration.update(
    "scanOnSave",
    true,
    vscode.ConfigurationTarget.Global,
  );
  await configuration.update(
    "insertSafeClipboard",
    true,
    vscode.ConfigurationTarget.Global,
  );
  await configuration.update(
    "ai.enabled",
    false,
    vscode.ConfigurationTarget.Global,
  );

  return context;
}

async function teardown(context: TestContext): Promise<void> {
  await vscode.env.clipboard.writeText("");
  await Promise.all(
    [
      context.unsafeUri,
      context.clipboardUri,
      context.saveUri,
      context.dotenvUri,
    ].map((uri) => deleteIfPresent(uri)),
  );
}

async function testActivation(): Promise<void> {
  const extension = vscode.extensions.getExtension(extensionId);
  assert.ok(
    extension,
    `${extensionId} must be available in the Extension Host`,
  );

  await extension.activate();
  assert.equal(extension.isActive, true);

  const commands = await vscode.commands.getCommands(true);
  for (const command of [
    "vibinguard.scanCurrentFile",
    "vibinguard.scanProject",
    "vibinguard.guardClipboardBeforePaste",
    "vibinguard.showSecurityReview",
    "vibinguard.configureLocalAi",
    "vibinguard.checkLocalAi",
    "vibinguard.showOutput",
  ]) {
    assert.ok(commands.includes(command), `${command} must be registered`);
  }
}

async function testCurrentFileScan(context: TestContext): Promise<void> {
  await showDocument(context.unsafeUri);
  await vscode.commands.executeCommand("vibinguard.scanCurrentFile");

  const diagnostics = await waitForDiagnostics(context.unsafeUri);
  assert.ok(
    diagnostics.some((diagnostic) => diagnostic.source === "VibinGuard"),
  );
  assert.ok(
    diagnostics.some(
      (diagnostic) => diagnostic.severity === vscode.DiagnosticSeverity.Error,
    ),
  );
  assert.equal(
    diagnostics.some((diagnostic) =>
      diagnostic.message.includes("1234567890abcdef"),
    ),
    false,
  );
  assert.ok(
    diagnostics.some((diagnostic) =>
      diagnostic.message.includes("Why this matters"),
    ),
  );
  assert.equal(
    diagnostics.some((diagnostic) => diagnostic.message.trim().startsWith("{")),
    false,
  );
}

async function testBlockedClipboard(context: TestContext): Promise<void> {
  const editor = await showDocument(context.clipboardUri);
  await replaceDocument(editor, "");
  await vscode.env.clipboard.writeText(fakeSecret);

  await vscode.commands.executeCommand("vibinguard.guardClipboardBeforePaste");

  assert.equal(editor.document.getText(), "");
  // Blocked content was never inserted, so no editor line may be marked.
  assert.equal(vibinGuardDiagnostics(context.clipboardUri).length, 0);
}

async function testDiagnosticsSurviveOtherScans(
  context: TestContext,
): Promise<void> {
  await showDocument(context.unsafeUri);
  await vscode.commands.executeCommand("vibinguard.scanCurrentFile");
  await waitForDiagnostics(context.unsafeUri);

  const editor = await showDocument(context.saveUri);
  await replaceDocument(editor, safeSnippet);
  await editor.document.save();
  await new Promise((resolve) => setTimeout(resolve, 300));

  assert.ok(
    vibinGuardDiagnostics(context.unsafeUri).length > 0,
    "Saving another file must not clear this file's findings",
  );
}

async function testSafeClipboard(context: TestContext): Promise<void> {
  const editor = await showDocument(context.clipboardUri);
  await replaceDocument(editor, "");
  await vscode.env.clipboard.writeText(safeSnippet);

  await vscode.commands.executeCommand("vibinguard.guardClipboardBeforePaste");

  assert.equal(normalizeLineEndings(editor.document.getText()), safeSnippet);
}

async function testScanOnSave(context: TestContext): Promise<void> {
  const editor = await showDocument(context.saveUri);
  await replaceDocument(editor, fakeSecret);
  await editor.document.save();

  const diagnostics = await waitForDiagnostics(context.saveUri);
  assert.ok(
    diagnostics.some((diagnostic) => diagnostic.source === "VibinGuard"),
  );
}

async function testProjectScan(context: TestContext): Promise<void> {
  await vscode.commands.executeCommand("vibinguard.scanProject");

  const diagnostics = await waitForDiagnostics(context.unsafeUri);
  assert.ok(
    diagnostics.some((diagnostic) => diagnostic.source === "VibinGuard"),
  );
}

async function testIgnoredDotEnv(context: TestContext): Promise<void> {
  assert.equal(await detectGitFileStatus(context.dotenvUri.fsPath), "ignored");
  await showDocument(context.dotenvUri);
  await vscode.commands.executeCommand("vibinguard.scanCurrentFile");

  assert.equal(vscode.languages.getDiagnostics(context.dotenvUri).length, 0);
}

async function showDocument(uri: vscode.Uri): Promise<vscode.TextEditor> {
  const document = await vscode.workspace.openTextDocument(uri);
  return vscode.window.showTextDocument(document, { preview: false });
}

async function replaceDocument(
  editor: vscode.TextEditor,
  content: string,
): Promise<void> {
  const document = editor.document;
  const range = new vscode.Range(
    document.positionAt(0),
    document.positionAt(document.getText().length),
  );
  const applied = await editor.edit((builder) =>
    builder.replace(range, content),
  );
  assert.equal(applied, true, "The test document edit must be applied");
}

async function waitForDiagnostics(
  uri: vscode.Uri,
): Promise<readonly vscode.Diagnostic[]> {
  const deadline = Date.now() + 5000;

  while (Date.now() < deadline) {
    const diagnostics = vscode.languages
      .getDiagnostics(uri)
      .filter((diagnostic) => diagnostic.source?.startsWith("VibinGuard"));
    if (diagnostics.length > 0) {
      return diagnostics;
    }

    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  assert.fail(`Timed out waiting for VibinGuard diagnostics for ${uri.fsPath}`);
}

async function testClipboardWithoutInsertion(
  context: TestContext,
): Promise<void> {
  const configuration = vscode.workspace.getConfiguration("vibinguard");
  await configuration.update(
    "insertSafeClipboard",
    false,
    vscode.ConfigurationTarget.Global,
  );
  try {
    const editor = await showDocument(context.clipboardUri);
    await replaceDocument(editor, "");
    await vscode.env.clipboard.writeText(safeSnippet);

    await vscode.commands.executeCommand(
      "vibinguard.guardClipboardBeforePaste",
    );

    assert.equal(editor.document.getText(), "");
    assert.equal(vibinGuardDiagnostics(context.clipboardUri).length, 0);
  } finally {
    await configuration.update(
      "insertSafeClipboard",
      true,
      vscode.ConfigurationTarget.Global,
    );
  }
}

async function testClipboardMessages(): Promise<void> {
  const notInsertedClean = describeClipboardResult({
    inserted: false,
    findingCount: 0,
    aiEnabled: false,
    aiAvailable: undefined,
  });
  assert.doesNotMatch(notInsertedClean.message, /was inserted/i);
  assert.match(notInsertedClean.message, /insertSafeClipboard/);

  const notInsertedWithFindings = describeClipboardResult({
    inserted: false,
    findingCount: 2,
    aiEnabled: false,
    aiAvailable: undefined,
  });
  assert.equal(notInsertedWithFindings.level, "warning");
  assert.match(notInsertedWithFindings.message, /2 issues/);
  assert.match(notInsertedWithFindings.message, /not inserted/);

  const insertedWithFinding = describeClipboardResult({
    inserted: true,
    findingCount: 1,
    aiEnabled: false,
    aiAvailable: undefined,
  });
  assert.match(insertedWithFinding.message, /was inserted/);
  assert.match(insertedWithFinding.message, /1 issue\b/);

  const insertedAiDown = describeClipboardResult({
    inserted: true,
    findingCount: 0,
    aiEnabled: true,
    aiAvailable: false,
  });
  assert.equal(insertedAiDown.level, "warning");
  assert.match(insertedAiDown.message, /local AI did not respond/);
}

function vibinGuardDiagnostics(uri: vscode.Uri): readonly vscode.Diagnostic[] {
  return vscode.languages
    .getDiagnostics(uri)
    .filter((diagnostic) => diagnostic.source?.startsWith("VibinGuard"));
}

async function deleteIfPresent(uri: vscode.Uri): Promise<void> {
  try {
    await vscode.workspace.fs.delete(uri);
  } catch (error) {
    if (
      !(
        error instanceof vscode.FileSystemError && error.code === "FileNotFound"
      )
    ) {
      throw error;
    }
  }
}

function normalizeLineEndings(value: string): string {
  return value.replace(/\r\n/g, "\n");
}

async function testProposalDocuments(): Promise<void> {
  const documents = new ProposalDocuments();
  const first = documents.put("proposed", "a.ts", "x");
  const second = documents.put("proposed", "a.ts", "y");

  assert.equal(first.scheme, ProposalDocuments.scheme);
  assert.notEqual(first.toString(), second.toString());
  assert.match(first.path, /a\.ts$/);
  assert.equal(documents.provideTextDocumentContent(first), "x");
  assert.equal(documents.provideTextDocumentContent(second), "y");

  documents.delete(first);
  assert.equal(documents.provideTextDocumentContent(first), "");
  assert.equal(documents.provideTextDocumentContent(second), "y");
}

function makeFinding(overrides: Partial<Finding>): Finding {
  return {
    id: "hardcoded-secret-0123456789",
    title: "Hardcoded secret detected",
    description: "Secrets in source code can leak.",
    category: "secret",
    severity: "critical",
    confidence: "high",
    source: "generation-guard",
    location: {
      filePath: "paste.ts",
      startLine: 3,
      startColumn: 1,
      endLine: 3,
      endColumn: 10,
    },
    evidence: 'apiKey = "fake...[REDACTED]"',
    fix: { kind: "prompt", title: "Fix", description: "Move it to env." },
    ...overrides,
  };
}

async function testPasteWarningFormats(): Promise<void> {
  const single = formatPasteWarning([makeFinding({})]);
  assert.equal(single?.level, "error");
  assert.match(single?.message ?? "", /\(line 3\)/);
  assert.doesNotMatch(single?.message ?? "", /1234567890abcdef/);

  const medium = formatPasteWarning([
    makeFinding({
      id: "insecure-cors-0123456789",
      category: "configuration",
      severity: "medium",
      title: "Permissive CORS configuration",
    }),
  ]);
  assert.equal(medium?.level, "warning");

  assert.equal(
    formatPasteWarning([makeFinding({ severity: "low", category: "other" })]),
    undefined,
  );

  const many = formatPasteWarning(
    Array.from({ length: 5 }, (_, index) =>
      makeFinding({
        id: `insecure-cors-${index}000000000`,
        category: "configuration",
        severity: "medium",
        location: {
          filePath: "paste.ts",
          startLine: index + 1,
          startColumn: 1,
          endLine: index + 1,
          endColumn: 2,
        },
      }),
    ),
  );
  assert.match(many?.message ?? "", /5 problems/);
  assert.match(many?.message ?? "", / and 2 more/);
}

const pasteFiles: vscode.Uri[] = [];

async function pasteTarget(name: string, content: string): Promise<vscode.TextEditor> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  assert.ok(folder);
  const uri = vscode.Uri.joinPath(folder.uri, name);
  await vscode.workspace.fs.writeFile(uri, Buffer.from(content));
  pasteFiles.push(uri);
  return showDocument(uri);
}

// The paste command resolves before VS Code applies the paste, because the
// paste first waits for paste providers. Wait until the document changes.
async function paste(): Promise<void> {
  const document = vscode.window.activeTextEditor?.document;
  assert.ok(document, "A paste target must be active");
  const version = document.version;
  await vscode.commands.executeCommand("editor.action.clipboardPasteAction");

  const deadline = Date.now() + 5000;
  while (document.version === version && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.notEqual(document.version, version, "The paste must be applied");
}

async function expectNoVibinGuardDiagnostics(uri: vscode.Uri): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 500));
  assert.equal(vibinGuardDiagnostics(uri).length, 0);
}

async function testPasteWarnsWithoutChangingText(): Promise<void> {
  const editor = await pasteTarget(".vibinguard-paste-a.ts", "");
  await vscode.env.clipboard.writeText(fakeSecret);

  await paste();

  assert.equal(normalizeLineEndings(editor.document.getText()), fakeSecret);
  const diagnostics = await waitForDiagnostics(editor.document.uri);
  assert.ok(
    diagnostics.some(
      (diagnostic) =>
        diagnostic.severity === vscode.DiagnosticSeverity.Error &&
        diagnostic.range.start.line === 0,
    ),
  );
}

async function testPasteDiagnosticsLandOnPastedLines(): Promise<void> {
  const editor = await pasteTarget(".vibinguard-paste-b.ts", "// a\n// b\n");
  editor.selection = new vscode.Selection(2, 0, 2, 0);
  await vscode.env.clipboard.writeText(fakeSecret);

  await paste();

  const diagnostics = await waitForDiagnostics(editor.document.uri);
  assert.ok(
    diagnostics.some(
      (diagnostic) =>
        diagnostic.severity === vscode.DiagnosticSeverity.Error &&
        diagnostic.range.start.line === 2,
    ),
  );
}

// The test host window has no OS focus, so VS Code never fires the editor copy
// event there. This drives the provider's copy and paste hooks directly.
async function testPasteIgnoresInternalCopies(): Promise<void> {
  const target = await pasteTarget(".vibinguard-paste-c.ts", "");
  const pasted: string[] = [];
  const observer = createPasteObserver((event) => pasted.push(event.text));
  const ranges = [new vscode.Range(0, 0, 0, 0)];
  const token = new vscode.CancellationTokenSource().token;
  const context = {
    only: undefined,
    triggerKind: vscode.DocumentPasteTriggerKind.Automatic,
  };

  const copiedInEditor = new vscode.DataTransfer();
  copiedInEditor.set("text/plain", new vscode.DataTransferItem(fakeSecret));
  await createCopyMarker().prepareDocumentPaste?.(
    target.document,
    ranges,
    copiedInEditor,
    token,
  );
  const internalEdits = await observer.provideDocumentPasteEdits?.(
    target.document,
    ranges,
    copiedInEditor,
    context,
    token,
  );

  const copiedElsewhere = new vscode.DataTransfer();
  copiedElsewhere.set("text/plain", new vscode.DataTransferItem(fakeSecret));
  const externalEdits = await observer.provideDocumentPasteEdits?.(
    target.document,
    ranges,
    copiedElsewhere,
    context,
    token,
  );

  assert.equal(internalEdits, undefined);
  assert.equal(externalEdits, undefined);
  assert.deepEqual(pasted, [fakeSecret]);
}

async function testPasteRespectsSetting(): Promise<void> {
  const configuration = vscode.workspace.getConfiguration("vibinguard");
  await configuration.update("scanOnPaste", false, vscode.ConfigurationTarget.Global);
  try {
    const editor = await pasteTarget(".vibinguard-paste-d.ts", "");
    await vscode.env.clipboard.writeText(fakeSecret);

    await paste();

    await expectNoVibinGuardDiagnostics(editor.document.uri);
  } finally {
    await configuration.update("scanOnPaste", true, vscode.ConfigurationTarget.Global);
  }
}

async function testPasteIgnoresUnsupportedFiles(): Promise<void> {
  const editor = await pasteTarget(".vibinguard-paste.py", "");
  await vscode.env.clipboard.writeText(fakeSecret);

  await paste();

  await expectNoVibinGuardDiagnostics(editor.document.uri);
}

async function testPasteSkipsLargeText(): Promise<void> {
  const editor = await pasteTarget(".vibinguard-paste-e.ts", "");
  const large = `${fakeSecret}${"// filler line for size\n".repeat(13000)}`;
  await vscode.env.clipboard.writeText(large);

  await paste();

  assert.equal(normalizeLineEndings(editor.document.getText()), large);
  await expectNoVibinGuardDiagnostics(editor.document.uri);
}

async function testPasteReviewIsDeferred(context: TestContext): Promise<void> {
  const document = await vscode.workspace.openTextDocument(context.saveUri);
  let reviewed = false;

  startPasteReview(document, 50, async () => {
    reviewed = true;
  });

  // The paste waits for the provider, so nothing may run synchronously.
  assert.equal(reviewed, false);
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(reviewed, true);
}

async function testCopyMarkerCoversEveryDocument(): Promise<void> {
  const python = await pasteTarget(".vibinguard-copy.py", "print(1)\n");
  const markdown = await vscode.workspace.openTextDocument({
    content: "# notes",
    language: "markdown",
  });

  assert.equal(vscode.languages.match(pasteSelector, python.document), 0);
  assert.ok(vscode.languages.match(copyMarkerSelector, python.document) > 0);
  assert.ok(vscode.languages.match(copyMarkerSelector, markdown) > 0);
}
