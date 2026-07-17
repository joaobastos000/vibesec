import * as vscode from "vscode";
import {
  createScanner,
  type Finding,
  type GeneratedContentGuardResult,
  type ScanConfig,
  type ScanFile,
  type ScanResult,
} from "@vibinguard/core";

const supportedLanguageIds = new Set(["typescript", "typescriptreact", "javascript", "javascriptreact", "json"]);

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel("VibinGuard");
  const diagnostics = vscode.languages.createDiagnosticCollection("vibinguard");
  const extension = new VibinGuardExtension(output, diagnostics);

  context.subscriptions.push(
    output,
    diagnostics,
    vscode.commands.registerCommand("vibinguard.scanCurrentFile", () => extension.scanCurrentFile()),
    vscode.commands.registerCommand("vibinguard.scanProject", () => extension.scanProject()),
    vscode.commands.registerCommand("vibinguard.guardClipboardBeforePaste", () =>
      extension.guardClipboardBeforePaste(),
    ),
    vscode.commands.registerCommand("vibinguard.showOutput", () => output.show(true)),
    vscode.workspace.onDidSaveTextDocument((document) => extension.scanOnSave(document)),
  );
}

export function deactivate(): void {
  // VS Code disposes subscriptions registered during activation.
}

class VibinGuardExtension {
  constructor(
    private readonly output: vscode.OutputChannel,
    private readonly diagnostics: vscode.DiagnosticCollection,
  ) {}

  async scanCurrentFile(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (editor === undefined) {
      void vscode.window.showWarningMessage("VibinGuard: open a file before scanning.");
      return;
    }

    if (!isSupportedDocument(editor.document)) {
      void vscode.window.showWarningMessage("VibinGuard: this file type is not supported yet.");
      return;
    }

    await this.scanDocument(editor.document, { showOutput: true, showToast: true });
  }

  async scanProject(): Promise<void> {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (folder === undefined) {
      void vscode.window.showWarningMessage("VibinGuard: open a workspace folder before scanning a project.");
      return;
    }

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "VibinGuard is scanning the project",
        cancellable: false,
      },
      async () => {
        const scanner = createScanner(createExtensionScannerConfig());
        const result = await scanner.scan({ target: folder.uri.fsPath, mode: "project" });
        this.applyDiagnostics(result.findings);
        this.writeScanResult("Project scan", result);
        this.output.show(true);
        void vscode.window.showInformationMessage(formatScanToast(result));
      },
    );
  }

  async guardClipboardBeforePaste(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (editor === undefined) {
      void vscode.window.showWarningMessage("VibinGuard: open a file before guarding clipboard content.");
      return;
    }

    const content = await vscode.env.clipboard.readText();
    if (content.trim().length === 0) {
      void vscode.window.showWarningMessage("VibinGuard: clipboard is empty.");
      return;
    }

    const scanner = createScanner(createExtensionScannerConfig());
    const filePath = editor.document.uri.scheme === "file" ? editor.document.uri.fsPath : editor.document.fileName;
    const result = await scanner.guardGeneratedContent({
      content,
      filePath,
      language: detectLanguage(editor.document),
    });

    this.writeGuardResult(result);

    if (result.blocked) {
      this.applyDiagnostics(result.findings);
      this.output.show(true);
      void vscode.window.showErrorMessage(
        `VibinGuard blocked clipboard content before paste: ${result.findings[0]?.title ?? result.reason}`,
      );
      return;
    }

    const shouldInsert = getBooleanSetting("insertSafeClipboard", true);
    if (shouldInsert) {
      await editor.edit((editBuilder) => {
        for (const selection of editor.selections) {
          if (selection.isEmpty) {
            editBuilder.insert(selection.active, content);
          } else {
            editBuilder.replace(selection, content);
          }
        }
      });
    }

    void vscode.window.showInformationMessage("VibinGuard: clipboard content passed and was inserted.");
  }

  async scanOnSave(document: vscode.TextDocument): Promise<void> {
    if (!getBooleanSetting("scanOnSave", true) || !isSupportedDocument(document)) {
      return;
    }

    await this.scanDocument(document, { showOutput: false, showToast: false });
  }

  private async scanDocument(
    document: vscode.TextDocument,
    options: { showOutput: boolean; showToast: boolean },
  ): Promise<void> {
    if (document.uri.scheme !== "file") {
      return;
    }

    const scanner = createScanner(createExtensionScannerConfig());
    const result = await scanner.scan({ target: document.uri.fsPath, mode: "file" });
    this.applyDiagnostics(result.findings);

    if (options.showOutput) {
      this.writeScanResult("Current file scan", result);
      this.output.show(true);
    }

    if (options.showToast) {
      void vscode.window.showInformationMessage(formatScanToast(result));
    }
  }

  private applyDiagnostics(findings: Finding[]): void {
    const byFile = new Map<string, vscode.Diagnostic[]>();

    for (const finding of findings) {
      const diagnostic = new vscode.Diagnostic(
        toRange(finding),
        formatDiagnosticMessage(finding),
        toDiagnosticSeverity(finding.severity),
      );
      diagnostic.code = finding.id;
      diagnostic.source = "VibinGuard";

      const existing = byFile.get(finding.location.filePath) ?? [];
      existing.push(diagnostic);
      byFile.set(finding.location.filePath, existing);
    }

    this.diagnostics.clear();
    for (const [filePath, fileDiagnostics] of byFile.entries()) {
      this.diagnostics.set(vscode.Uri.file(filePath), fileDiagnostics);
    }
  }

  private writeScanResult(title: string, result: ScanResult): void {
    this.output.appendLine("");
    this.output.appendLine(`## ${title}`);
    this.output.appendLine(`Target: ${result.target}`);
    this.output.appendLine(`Score: ${result.score.value} (${result.score.label})`);
    this.output.appendLine(
      `Findings: ${result.summary.findings} | critical ${result.summary.bySeverity.critical}, high ${result.summary.bySeverity.high}, medium ${result.summary.bySeverity.medium}, low ${result.summary.bySeverity.low}, info ${result.summary.bySeverity.info}`,
    );
    this.output.appendLine(`Duration: ${result.summary.durationMs}ms`);
    this.writeFindings(result.findings);
  }

  private writeGuardResult(result: GeneratedContentGuardResult): void {
    this.output.appendLine("");
    this.output.appendLine("## Generated content guard");
    this.output.appendLine(`Target: ${result.target}`);
    this.output.appendLine(`Blocked: ${result.blocked ? "yes" : "no"}`);
    this.output.appendLine(`Reason: ${result.reason}`);
    this.output.appendLine(`Findings: ${result.summary.findings}`);
    this.writeFindings(result.findings);
  }

  private writeFindings(findings: Finding[]): void {
    if (findings.length === 0) {
      this.output.appendLine("No findings.");
      return;
    }

    for (const finding of findings) {
      this.output.appendLine("");
      this.output.appendLine(`[${finding.severity.toUpperCase()}] ${finding.title}`);
      this.output.appendLine(`${finding.location.filePath}:${finding.location.startLine}:${finding.location.startColumn}`);
      this.output.appendLine(finding.description);
      this.output.appendLine(`Evidence: ${finding.evidence}`);
      this.output.appendLine(`Fix: ${finding.fix.description}`);
      if (finding.fix.prompt !== undefined) {
        this.output.appendLine("Fix prompt:");
        this.output.appendLine(finding.fix.prompt);
      }
    }
  }
}

function createExtensionScannerConfig(): Partial<ScanConfig> {
  const language = vscode.workspace.getConfiguration("vibinguard").get<ScanConfig["language"]>("language", "pt-BR");

  return {
    language,
    ai: { provider: "disabled", enableRag: false },
    staticAnalysis: {
      enableBuiltInRules: true,
      enableSemgrep: false,
      enableNpmAudit: false,
    },
  };
}

function detectLanguage(document: vscode.TextDocument): ScanFile["language"] {
  if (document.fileName.split(/[\\/]/).at(-1)?.startsWith(".env")) {
    return "env";
  }

  switch (document.languageId) {
    case "typescript":
    case "typescriptreact":
      return "typescript";
    case "javascript":
    case "javascriptreact":
      return "javascript";
    case "json":
      return "json";
    default:
      return "unknown";
  }
}

function isSupportedDocument(document: vscode.TextDocument): boolean {
  return (
    document.uri.scheme === "file" &&
    (supportedLanguageIds.has(document.languageId) || document.fileName.split(/[\\/]/).at(-1)?.startsWith(".env") === true)
  );
}

function toRange(finding: Finding): vscode.Range {
  const startLine = Math.max(finding.location.startLine - 1, 0);
  const startColumn = Math.max(finding.location.startColumn - 1, 0);
  const endLine = Math.max(finding.location.endLine - 1, startLine);
  const endColumn = Math.max(finding.location.endColumn - 1, startColumn + 1);
  return new vscode.Range(startLine, startColumn, endLine, endColumn);
}

function toDiagnosticSeverity(severity: Finding["severity"]): vscode.DiagnosticSeverity {
  switch (severity) {
    case "critical":
    case "high":
      return vscode.DiagnosticSeverity.Error;
    case "medium":
      return vscode.DiagnosticSeverity.Warning;
    case "low":
      return vscode.DiagnosticSeverity.Information;
    case "info":
      return vscode.DiagnosticSeverity.Hint;
  }
}

function formatDiagnosticMessage(finding: Finding): string {
  return `${finding.title}: ${finding.description}\nEvidence: ${finding.evidence}\nFix: ${finding.fix.description}`;
}

function formatScanToast(result: ScanResult): string {
  return `VibinGuard: ${result.summary.findings} finding(s), score ${result.score.value} (${result.score.label}).`;
}

function getBooleanSetting(key: string, fallback: boolean): boolean {
  return vscode.workspace.getConfiguration("vibinguard").get<boolean>(key, fallback);
}
