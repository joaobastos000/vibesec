import assert from "node:assert/strict";
import * as vscode from "vscode";
import { detectGitFileStatus } from "@vibinguard/core";

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
  const diagnostics = await waitForDiagnostics(context.clipboardUri);
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
