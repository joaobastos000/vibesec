import * as vscode from "vscode";
import {
  applySuppressions,
  createScanner,
  detectGitFileStatus,
  mergeScanResults,
  scanConfigSchema,
  type AiAnalysisSummary,
  type Finding,
  type GeneratedContentGuardResult,
  type ScanConfigInput,
  type ScanFile,
  type ScanResult,
} from "@vibinguard/core";

const supportedLanguageIds = new Set([
  "typescript",
  "typescriptreact",
  "javascript",
  "javascriptreact",
  "json",
]);
const openReviewAction = "Open security review";
const copyFixAction = "Copy AI fix prompt";
const fixWithAiAction = "Fix with local AI";
const technicalDetailsAction = "Technical details";
const pasteAnywayAction = "Paste anyway";

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel("VibinGuard", { log: true });
  const diagnostics = vscode.languages.createDiagnosticCollection("vibinguard");
  const extension = new VibinGuardExtension(output, diagnostics);

  context.subscriptions.push(
    output,
    diagnostics,
    vscode.commands.registerCommand("vibinguard.scanCurrentFile", () =>
      extension.scanCurrentFile(),
    ),
    vscode.commands.registerCommand("vibinguard.scanProject", () =>
      extension.scanProject(),
    ),
    vscode.commands.registerCommand(
      "vibinguard.guardClipboardBeforePaste",
      () => extension.guardClipboardBeforePaste(),
    ),
    vscode.commands.registerCommand("vibinguard.showSecurityReview", () =>
      extension.showSecurityReview(),
    ),
    vscode.commands.registerCommand("vibinguard.configureLocalAi", () =>
      extension.configureLocalAi(),
    ),
    vscode.commands.registerCommand("vibinguard.checkLocalAi", () =>
      extension.checkLocalAi(),
    ),
    vscode.commands.registerCommand("vibinguard.showOutput", () =>
      output.show(true),
    ),
    vscode.workspace.onDidSaveTextDocument((document) =>
      extension.scanOnSave(document),
    ),
  );
}

export function deactivate(): void {
  // VS Code disposes subscriptions registered during activation.
}

class VibinGuardExtension {
  /** Findings per file, keyed by URI string; diagnostics mirror this map. */
  private readonly findingsByFile = new Map<string, Finding[]>();
  /** Findings for clipboard content that was blocked and never inserted. */
  private blockedClipboardFindings: Finding[] = [];
  private lastAiSummary: AiAnalysisSummary | undefined;
  private pendingFixTarget: FixTarget | undefined;

  constructor(
    private readonly output: vscode.LogOutputChannel,
    private readonly diagnostics: vscode.DiagnosticCollection,
  ) {}

  async scanCurrentFile(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (editor === undefined) {
      void vscode.window.showWarningMessage(
        "VibinGuard: open a file before starting a security review.",
      );
      return;
    }

    if (!isSupportedDocument(editor.document)) {
      void vscode.window.showWarningMessage(
        "VibinGuard: this file type is not supported yet.",
      );
      return;
    }

    await this.scanDocument(editor.document, {
      showOutput: true,
      showToast: true,
      allowAi: true,
    });
  }

  async scanProject(): Promise<void> {
    const folders = vscode.workspace.workspaceFolders ?? [];
    if (folders.length === 0) {
      void vscode.window.showWarningMessage(
        "VibinGuard: open a project folder before starting a security review.",
      );
      return;
    }

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: isLocalAiEnabled()
          ? "VibinGuard is running both review layers"
          : "VibinGuard is reviewing the project",
        cancellable: false,
      },
      async () => {
        const scanner = createScanner(
          createExtensionScannerConfig({ allowAi: true }),
        );
        // Every workspace folder is scanned, not only the first one.
        const results = [];
        for (const folder of folders) {
          results.push(
            await scanner.scan({ target: folder.uri.fsPath, mode: "project" }),
          );
        }
        const result = mergeScanResults(
          folders.length === 1
            ? (folders[0]?.uri.fsPath ?? "")
            : `${folders.length} workspace folders`,
          results,
        );
        this.replaceFindings(result.findings, "all", result.ai);
        this.writeScanResult("Project scan", result);
        this.output.show(true);
        this.showScanNotice(result);
      },
    );
  }

  async guardClipboardBeforePaste(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (editor === undefined) {
      void vscode.window.showWarningMessage(
        "VibinGuard: open a file before guarding clipboard content.",
      );
      return;
    }

    const content = await vscode.env.clipboard.readText();
    if (content.trim().length === 0) {
      void vscode.window.showWarningMessage(
        "VibinGuard: the clipboard is empty.",
      );
      return;
    }

    const scanner = createScanner(
      createExtensionScannerConfig({ allowAi: true }),
    );
    const filePath =
      editor.document.uri.scheme === "file"
        ? editor.document.uri.fsPath
        : editor.document.fileName;
    const language = detectLanguage(editor.document);
    // Git is an external program, so it never runs for untrusted folders.
    const gitStatus =
      language === "env" && vscode.workspace.isTrusted
        ? await detectGitFileStatus(filePath)
        : undefined;
    const review = () =>
      scanner.guardGeneratedContent({
        content,
        filePath,
        language,
        ...(gitStatus === undefined ? {} : { gitStatus }),
      });
    const result = isLocalAiEnabled()
      ? await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: "VibinGuard is reviewing this clipboard content locally",
            cancellable: false,
          },
          review,
        )
      : await review();

    this.writeGuardResult(result);
    const editorFindings = locateClipboardFindings(
      result.findings,
      editor.document,
      editor.selection.start,
    );

    if (result.blocked) {
      this.pendingFixTarget = {
        content,
        filePath,
        language,
        documentUri: editor.document.uri,
        documentVersion: editor.document.version,
        selections: [...editor.selections],
        replaceWholeDocument: false,
        findingIds: new Set(result.findings.map((finding) => finding.id)),
      };
      // The content was not inserted, so its findings stay out of the editor
      // diagnostics and keep clipboard-relative line numbers.
      this.blockedClipboardFindings = result.findings;
      this.lastAiSummary = result.ai;
      const firstFinding = result.findings[0];
      const message = `VibinGuard blocked this paste. ${friendlyFinding(firstFinding).title}.`;
      const correctionAction = isLocalAiEnabled()
        ? fixWithAiAction
        : copyFixAction;
      void vscode.window
        .showErrorMessage(
          message,
          openReviewAction,
          correctionAction,
          pasteAnywayAction,
        )
        .then((action) => this.handleFindingAction(action, firstFinding));
      return;
    }

    this.pendingFixTarget = undefined;
    this.blockedClipboardFindings = [];

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
      await this.refreshDocumentFindings(
        editor.document,
        editorFindings,
        result.ai,
      );
    }

    if (editorFindings.length > 0) {
      void vscode.window
        .showWarningMessage(
          `The code was inserted, but VibinGuard found ${formatCount(editorFindings.length, "issue", "issues")} to review.`,
          openReviewAction,
        )
        .then((action) =>
          action === openReviewAction ? this.showSecurityReview() : undefined,
        );
      return;
    }

    if (result.ai.enabled && result.ai.available === false) {
      void vscode.window
        .showWarningMessage(
          "The code passed deterministic checks and was inserted, but local AI did not respond.",
          "Check local AI",
        )
        .then((action) =>
          action === "Check local AI" ? this.checkLocalAi() : undefined,
        );
      return;
    }

    void vscode.window.showInformationMessage(
      result.ai.available === true
        ? "VibinGuard: both review layers approved the code and it was inserted."
        : "VibinGuard: the code passed security checks and was inserted.",
    );
  }

  async scanOnSave(document: vscode.TextDocument): Promise<void> {
    if (
      !getBooleanSetting("scanOnSave", true) ||
      !isSupportedDocument(document)
    ) {
      return;
    }

    await this.scanDocument(document, {
      showOutput: false,
      showToast: false,
      allowAi: getBooleanSetting("ai.runOnSave", false),
    });
  }

  async showSecurityReview(): Promise<void> {
    const fileFindings = [...this.findingsByFile.values()].flat();
    if (
      fileFindings.length === 0 &&
      this.blockedClipboardFindings.length === 0
    ) {
      const suffix =
        this.lastAiSummary?.available === false
          ? " Local AI did not respond during the last attempt."
          : "";
      void vscode.window.showInformationMessage(
        `VibinGuard: no findings are waiting for review.${suffix}`,
      );
      return;
    }

    const items: Array<ReviewItem | vscode.QuickPickItem> = [
      ...buildClipboardReviewItems(this.blockedClipboardFindings),
      ...buildReviewItems(fileFindings),
    ];
    const selected = await vscode.window.showQuickPick(items, {
      title: "VibinGuard security review",
      placeHolder:
        "Choose a finding to inspect the code and decide what to do next",
      matchOnDescription: true,
      matchOnDetail: true,
    });

    if (selected === undefined || !isReviewItem(selected)) {
      return;
    }

    if (selected.fromClipboard) {
      this.showFindingActions(selected.finding, true);
      return;
    }

    await this.openFinding(selected.finding);
    this.showFindingActions(selected.finding, false);
  }

  async configureLocalAi(): Promise<void> {
    const enabled = isLocalAiEnabled();
    const selected = await vscode.window.showQuickPick(
      [
        {
          label: "Enable the second local review",
          description: "Uses Ollama on this computer",
          enabled: true,
        },
        {
          label: "Use deterministic checks only",
          description: "Does not call an AI model",
          enabled: false,
        },
      ],
      {
        title: "Configure VibinGuard local AI",
        placeHolder: enabled
          ? "The second review is enabled"
          : "The second review is disabled",
      },
    );

    if (selected === undefined) {
      return;
    }

    const configuration = vscode.workspace.getConfiguration("vibinguard");
    if (!selected.enabled) {
      await configuration.update(
        "ai.enabled",
        false,
        vscode.ConfigurationTarget.Global,
      );
      void vscode.window.showInformationMessage(
        "VibinGuard: local AI review has been disabled.",
      );
      return;
    }

    const currentModel = configuration.get<string>(
      "ai.model",
      "qwen2.5-coder:3b-instruct",
    );
    const model = await vscode.window.showInputBox({
      title: "Local model used for the second review",
      value: currentModel,
      prompt: "Enter the name of a code model already available in Ollama",
      validateInput: (value) =>
        value.trim().length === 0 ? "Enter a model name." : undefined,
    });
    if (model === undefined) {
      return;
    }

    await configuration.update(
      "ai.model",
      model.trim(),
      vscode.ConfigurationTarget.Global,
    );
    await configuration.update(
      "ai.enabled",
      true,
      vscode.ConfigurationTarget.Global,
    );
    await this.checkLocalAi();
  }

  async checkLocalAi(): Promise<void> {
    if (!isLocalAiEnabled()) {
      void vscode.window
        .showInformationMessage(
          "The second local review is disabled.",
          "Configure now",
        )
        .then((action) =>
          action === "Configure now" ? this.configureLocalAi() : undefined,
        );
      return;
    }

    const result = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "VibinGuard is checking local AI",
        cancellable: false,
      },
      async () => {
        const scanner = createScanner(
          createExtensionScannerConfig({ allowAi: true }),
        );
        return scanner.guardGeneratedContent({
          content: "export const add = (left, right) => left + right;\n",
          filePath: "vibinguard-ai-check.ts",
          language: "typescript",
        });
      },
    );

    this.writeAiSummary(result.ai);
    if (result.ai.available === true) {
      void vscode.window.showInformationMessage(
        `VibinGuard: local AI is ready with model ${result.ai.model ?? "configured"}.`,
      );
      return;
    }

    void vscode.window
      .showWarningMessage(
        "Ollama did not respond on localhost. Deterministic checks remain active.",
        "Try again",
        "Open settings",
      )
      .then((action) => {
        if (action === "Try again") {
          return this.checkLocalAi();
        }
        if (action === "Open settings") {
          return vscode.commands.executeCommand(
            "workbench.action.openSettings",
            "@ext:vibinguard.vibin-guard VibinGuard AI",
          );
        }
        return undefined;
      });
  }

  private async scanDocument(
    document: vscode.TextDocument,
    options: { showOutput: boolean; showToast: boolean; allowAi: boolean },
  ): Promise<void> {
    if (document.uri.scheme !== "file") {
      return;
    }

    const scanner = createScanner(
      createExtensionScannerConfig({ allowAi: options.allowAi }),
    );
    const result = await scanner.scan({
      target: document.uri.fsPath,
      mode: "file",
    });
    this.replaceFindings(result.findings, [document.uri.fsPath], result.ai);

    if (options.showOutput) {
      this.writeScanResult("Current file scan", result);
      this.output.show(true);
    }

    if (options.showToast) {
      this.showScanNotice(result);
    }
  }

  /**
   * Replaces the findings for the scanned scope only, so saving one file no
   * longer erases the results of other files.
   */
  private replaceFindings(
    findings: Finding[],
    scope: "all" | string[],
    aiSummary: AiAnalysisSummary | undefined,
  ): void {
    if (scope === "all") {
      this.findingsByFile.clear();
    } else {
      for (const filePath of scope) {
        this.findingsByFile.delete(fileKey(filePath));
      }
    }

    for (const finding of findings) {
      const key = fileKey(finding.location.filePath);
      const existing = this.findingsByFile.get(key) ?? [];
      existing.push(finding);
      this.findingsByFile.set(key, existing);
    }

    this.lastAiSummary = aiSummary;
    this.syncDiagnostics();
  }

  /**
   * Rechecks the whole edited document after an insertion, so existing
   * findings keep correct positions. Local AI findings for the inserted
   * content are kept because the deterministic recheck cannot reproduce them.
   */
  private async refreshDocumentFindings(
    document: vscode.TextDocument,
    insertedFindings: Finding[],
    aiSummary: AiAnalysisSummary | undefined,
  ): Promise<void> {
    const filePath =
      document.uri.scheme === "file" ? document.uri.fsPath : document.fileName;
    const language = detectLanguage(document);
    const gitStatus =
      language === "env" && vscode.workspace.isTrusted
        ? await detectGitFileStatus(filePath)
        : undefined;
    const review = await createScanner(
      createExtensionScannerConfig({ allowAi: false }),
    ).guardGeneratedContent({
      content: document.getText(),
      filePath,
      language,
      ...(gitStatus === undefined ? {} : { gitStatus }),
    });

    // The document is the developer's own file, so inline directives apply.
    const findings = applySuppressions(
      [
        ...review.findings,
        ...insertedFindings.filter((finding) => finding.source === "llm"),
      ],
      [{ path: filePath, content: document.getText(), language }],
    );
    this.replaceFindings(findings, [filePath], aiSummary);
  }

  private syncDiagnostics(): void {
    this.diagnostics.clear();
    for (const findings of this.findingsByFile.values()) {
      const filePath = findings[0]?.location.filePath;
      if (filePath === undefined) {
        continue;
      }
      this.diagnostics.set(
        vscode.Uri.file(filePath),
        findings.map((finding) => {
          const diagnostic = new vscode.Diagnostic(
            toRange(finding),
            formatDiagnosticMessage(finding),
            toDiagnosticSeverity(finding.severity),
          );
          diagnostic.code = finding.id;
          diagnostic.source =
            finding.source === "llm" ? "VibinGuard Local AI" : "VibinGuard";
          return diagnostic;
        }),
      );
    }
  }

  private showScanNotice(result: ScanResult): void {
    const limitNotice =
      result.summary.limitReached === true
        ? ` Part of the project was not scanned because it has more than ${scanFileLimit()} supported files.`
        : "";

    if (result.summary.findings === 0) {
      const message =
        result.ai.available === true
          ? "VibinGuard: both review layers completed without findings."
          : result.ai.enabled && result.ai.available === false
            ? "No deterministic findings were found, but local AI did not respond."
            : "VibinGuard: no known vulnerabilities were found.";
      if (limitNotice.length > 0) {
        void vscode.window.showWarningMessage(`${message}${limitNotice}`);
      } else {
        void vscode.window.showInformationMessage(message);
      }
      return;
    }

    const urgent =
      result.summary.bySeverity.critical + result.summary.bySeverity.high;
    const message =
      urgent > 0
        ? `VibinGuard found ${formatCount(result.summary.findings, "issue", "issues")}; ${formatCount(urgent, "requires", "require")} a fix before sharing.`
        : `VibinGuard found ${formatCount(result.summary.findings, "issue", "issues")} that need attention.`;
    void vscode.window
      .showWarningMessage(`${message}${limitNotice}`, openReviewAction)
      .then((action) =>
        action === openReviewAction ? this.showSecurityReview() : undefined,
      );
  }

  private async openFinding(finding: Finding): Promise<void> {
    try {
      const document = await vscode.workspace.openTextDocument(
        vscode.Uri.file(finding.location.filePath),
      );
      const editor = await vscode.window.showTextDocument(document, {
        preview: false,
      });
      const range = toRange(finding);
      editor.selection = new vscode.Selection(range.start, range.end);
      editor.revealRange(
        range,
        vscode.TextEditorRevealType.InCenterIfOutsideViewport,
      );
    } catch {
      void vscode.window.showWarningMessage(
        "VibinGuard: the file for this finding is no longer available.",
      );
    }
  }

  private showFindingActions(finding: Finding, fromClipboard: boolean): void {
    const friendly = friendlyFinding(finding);
    const correctionAction = isLocalAiEnabled()
      ? fixWithAiAction
      : copyFixAction;
    const actions = fromClipboard
      ? [correctionAction, pasteAnywayAction, technicalDetailsAction]
      : [correctionAction, technicalDetailsAction];
    const location = fromClipboard
      ? ` (line ${finding.location.startLine} of the blocked clipboard content)`
      : "";
    void vscode.window
      .showInformationMessage(
        `${friendly.level}: ${friendly.title}${location}. ${friendly.explanation}`,
        ...actions,
      )
      .then((action) => this.handleFindingAction(action, finding));
  }

  private handleFindingAction(
    action: string | undefined,
    finding: Finding | undefined,
  ): Thenable<unknown> | undefined {
    if (finding === undefined) {
      return undefined;
    }
    if (action === openReviewAction) {
      return this.showSecurityReview();
    }
    if (action === copyFixAction) {
      return this.copyFixPrompt(finding);
    }
    if (action === fixWithAiAction) {
      return this.fixFindingWithLocalAi(finding);
    }
    if (action === technicalDetailsAction) {
      return this.showTechnicalDetails(finding);
    }
    if (action === pasteAnywayAction) {
      return this.pasteBlockedClipboardAnyway();
    }
    return undefined;
  }

  /** Lets the developer override a block they judge to be a false positive. */
  private async pasteBlockedClipboardAnyway(): Promise<void> {
    const target = this.pendingFixTarget;
    if (target === undefined || target.replaceWholeDocument) {
      void vscode.window.showWarningMessage(
        "VibinGuard: there is no blocked clipboard content to insert. Run Guard Clipboard Before Paste again.",
      );
      return;
    }

    const findings = this.blockedClipboardFindings;
    const applied = await this.applyFixTarget(target, target.content);
    if (!applied) {
      return;
    }

    this.pendingFixTarget = undefined;
    this.blockedClipboardFindings = [];
    this.output.warn(
      `Blocked clipboard content was inserted by the developer into ${target.filePath} (${formatCount(findings.length, "finding", "findings")} accepted).`,
    );

    const document = await vscode.workspace.openTextDocument(
      target.documentUri,
    );
    await this.refreshDocumentFindings(
      document,
      locateClipboardFindings(
        findings,
        document,
        target.selections[0]?.start ?? new vscode.Position(0, 0),
      ),
      this.lastAiSummary,
    );
    void vscode.window.showWarningMessage(
      "VibinGuard: the content was inserted. Its findings stay in the review until you fix them or add a vibinguard-ignore comment.",
    );
  }

  private async copyFixPrompt(finding: Finding): Promise<void> {
    const prompt = finding.fix.prompt ?? finding.fix.description;
    await vscode.env.clipboard.writeText(prompt);
    void vscode.window.showInformationMessage(
      "The secure fix prompt was copied for use with your coding assistant.",
    );
  }

  private async fixFindingWithLocalAi(finding: Finding): Promise<void> {
    const target = await this.resolveFixTarget(finding);
    if (target === undefined) {
      return;
    }

    const scanner = createScanner(
      createExtensionScannerConfig({ allowAi: true }),
    );
    const result = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "VibinGuard is preparing and checking the fix",
        cancellable: false,
      },
      () =>
        scanner.suggestGeneratedContentFix({
          content: target.content,
          filePath: target.filePath,
          language: target.language,
          finding,
        }),
    );

    if (!result.available) {
      void vscode.window
        .showWarningMessage(result.ai.message, copyFixAction, "Check local AI")
        .then((action) => {
          if (action === copyFixAction) {
            return this.copyFixPrompt(finding);
          }
          if (action === "Check local AI") {
            return this.checkLocalAi();
          }
          return undefined;
        });
      return;
    }

    if (result.review.blocked) {
      // Nothing is applied, so the editor diagnostics stay unchanged.
      this.lastAiSummary = result.review.ai;
      void vscode.window
        .showErrorMessage(
          "The AI proposal still contains a blocking risk and will not be applied.",
          openReviewAction,
          copyFixAction,
        )
        .then((action) => this.handleFindingAction(action, finding));
      return;
    }

    const preview = await vscode.workspace.openTextDocument({
      content: result.replacement,
      language: previewLanguage(target.language),
    });
    await vscode.window.showTextDocument(preview, {
      viewColumn: vscode.ViewColumn.Beside,
      preview: true,
      preserveFocus: false,
    });

    const remainingNotice =
      result.review.findings.length === 0
        ? "Both review layers found no new issues."
        : `${formatCount(result.review.findings.length, "non-blocking issue", "non-blocking issues")} still need review.`;
    const decision = await vscode.window.showInformationMessage(
      `${result.explanation}\n\n${remainingNotice}`,
      { modal: true },
      "Apply fix",
      "Discard",
    );

    await vscode.commands.executeCommand(
      "workbench.action.revertAndCloseActiveEditor",
    );
    if (decision !== "Apply fix") {
      void vscode.window.showInformationMessage(
        "VibinGuard: the proposal was discarded and no code was changed.",
      );
      return;
    }

    const applied = await this.applyFixTarget(target, result.replacement);
    if (!applied) {
      return;
    }

    const document = await vscode.workspace.openTextDocument(
      target.documentUri,
    );
    const reviewedFindings = target.replaceWholeDocument
      ? result.review.findings
      : locateClipboardFindings(
          result.review.findings,
          document,
          target.selections[0]?.start ?? new vscode.Position(0, 0),
        );
    await this.refreshDocumentFindings(
      document,
      reviewedFindings,
      result.review.ai,
    );
    if (this.pendingFixTarget?.findingIds.has(finding.id) === true) {
      this.pendingFixTarget = undefined;
      this.blockedClipboardFindings = [];
    }
    void vscode.window.showInformationMessage(
      reviewedFindings.length === 0
        ? "VibinGuard: the fix was applied and approved by both review layers."
        : "VibinGuard: the fix was applied, with non-blocking issues kept in the review.",
    );
  }

  private async resolveFixTarget(
    finding: Finding,
  ): Promise<FixTarget | undefined> {
    if (this.pendingFixTarget?.findingIds.has(finding.id) === true) {
      return this.pendingFixTarget;
    }

    try {
      const document = await vscode.workspace.openTextDocument(
        vscode.Uri.file(finding.location.filePath),
      );
      if (!isSupportedDocument(document)) {
        void vscode.window.showWarningMessage(
          "VibinGuard: this file cannot receive an automatic fix.",
        );
        return undefined;
      }

      return {
        content: document.getText(),
        filePath: document.uri.fsPath,
        language: detectLanguage(document),
        documentUri: document.uri,
        documentVersion: document.version,
        selections: [],
        replaceWholeDocument: true,
        findingIds: new Set([finding.id]),
      };
    } catch {
      void vscode.window.showWarningMessage(
        "VibinGuard: the file for this finding is no longer available.",
      );
      return undefined;
    }
  }

  private async applyFixTarget(
    target: FixTarget,
    replacement: string,
  ): Promise<boolean> {
    const document = await vscode.workspace.openTextDocument(
      target.documentUri,
    );
    if (document.version !== target.documentVersion) {
      void vscode.window.showWarningMessage(
        "The file changed while the fix was being prepared. Run the review again to avoid overwriting recent work.",
      );
      return false;
    }

    const editor = await vscode.window.showTextDocument(document, {
      preview: false,
    });
    const applied = await editor.edit((builder) => {
      if (target.replaceWholeDocument) {
        builder.replace(
          new vscode.Range(
            document.positionAt(0),
            document.positionAt(document.getText().length),
          ),
          replacement,
        );
        return;
      }

      for (const selection of target.selections) {
        if (selection.isEmpty) {
          builder.insert(selection.active, replacement);
        } else {
          builder.replace(selection, replacement);
        }
      }
    });

    if (!applied) {
      void vscode.window.showErrorMessage(
        "VibinGuard could not apply the fix. No code was changed.",
      );
    }
    return applied;
  }

  private showTechnicalDetails(finding: Finding): Thenable<string | undefined> {
    const standards = [finding.cwe, finding.owasp]
      .filter((value) => value !== undefined)
      .join(" | ");
    return vscode.window.showInformationMessage(
      [
        `Source: ${finding.source}`,
        `Category: ${finding.category}`,
        `Severity: ${finding.severity}`,
        `Confidence: ${finding.confidence}`,
        standards.length > 0 ? `References: ${standards}` : undefined,
      ]
        .filter((value) => value !== undefined)
        .join("\n"),
      { modal: true },
    );
  }

  private writeScanResult(title: string, result: ScanResult): void {
    const urgent =
      result.summary.bySeverity.critical + result.summary.bySeverity.high;
    const status =
      result.summary.findings === 0
        ? "PASSED"
        : urgent > 0
          ? "ACTION REQUIRED"
          : "REVIEW RECOMMENDED";
    this.writeLogHeader(`SCAN | ${title}`, status);
    this.output.info(`Target    : ${result.target}`);
    this.output.info(
      `Score     : ${result.score.value} (${result.score.label})`,
    );
    this.output.info(`Files     : ${result.summary.filesScanned}`);
    if (result.summary.limitReached === true) {
      this.output.warn(
        `Limit     : only the first ${scanFileLimit()} supported files per folder were scanned`,
      );
    }
    this.output.info(`Duration  : ${result.summary.durationMs} ms`);
    this.output.info(
      `Findings  : ${result.summary.findings} total | ${result.summary.bySeverity.critical} critical | ${result.summary.bySeverity.high} high | ${result.summary.bySeverity.medium} medium | ${result.summary.bySeverity.low} low | ${result.summary.bySeverity.info} info`,
    );
    this.writeAiSummary(result.ai);
    this.writeFindings(result.findings);
  }

  private writeGuardResult(result: GeneratedContentGuardResult): void {
    this.writeLogHeader(
      "GUARD | Clipboard content",
      result.blocked ? "BLOCKED" : "PASSED",
    );
    this.output.info(`Target    : ${result.target}`);
    this.output.info(`Duration  : ${result.summary.durationMs} ms`);
    this.output.info(`Findings  : ${result.summary.findings}`);
    if (result.blocked) {
      this.output.error(`Decision  : ${result.reason}`);
    } else {
      this.output.info(`Decision  : ${result.reason}`);
    }
    this.writeAiSummary(result.ai);
    this.writeFindings(result.findings);
  }

  private writeAiSummary(summary: AiAnalysisSummary): void {
    const state = summary.enabled
      ? summary.available === true
        ? "available"
        : summary.attempted
          ? "unavailable"
          : "skipped"
      : "disabled";
    const details = `Local AI  : ${state} | ${summary.message}`;
    if (summary.enabled && summary.available === false) {
      this.output.warn(details);
    } else if (!summary.enabled || !summary.attempted) {
      this.output.debug(details);
    } else {
      this.output.info(details);
    }
  }

  private writeFindings(findings: Finding[]): void {
    if (findings.length === 0) {
      this.output.info("");
      this.output.info("No security findings.");
      return;
    }

    this.output.info("");
    this.output.info("Findings");
    this.output.info(
      "------------------------------------------------------------",
    );
    for (const finding of findings) {
      const message = [
        `[${finding.severity.toUpperCase()}] ${finding.title}`,
        `  Location : ${finding.location.filePath}:${finding.location.startLine}:${finding.location.startColumn}`,
        `  Risk     : ${finding.description}`,
        `  Evidence : ${finding.evidence}`,
        `  Next step: ${finding.fix.description}`,
      ].join("\n");
      this.writeFindingLog(finding.severity, message);
      this.output.info("");
    }
  }

  private writeLogHeader(title: string, status: string): void {
    this.output.info("");
    this.output.info(
      "============================================================",
    );
    this.output.info(`${title.toUpperCase()} | ${status}`);
    this.output.info(
      "============================================================",
    );
  }

  private writeFindingLog(
    severity: Finding["severity"],
    message: string,
  ): void {
    if (severity === "critical" || severity === "high") {
      this.output.error(message);
      return;
    }
    if (severity === "medium") {
      this.output.warn(message);
      return;
    }
    this.output.info(message);
  }
}

function createExtensionScannerConfig(options: {
  allowAi: boolean;
}): ScanConfigInput {
  const configuration = vscode.workspace.getConfiguration("vibinguard");
  const useAi =
    options.allowAi && configuration.get<boolean>("ai.enabled", false);

  return {
    ai: useAi
      ? {
          provider: "local",
          model: configuration.get<string>(
            "ai.model",
            "qwen2.5-coder:3b-instruct",
          ),
          baseUrl: validUrlOrFallback(
            configuration.get<string>("ai.baseUrl", "http://127.0.0.1:11434"),
            "http://127.0.0.1:11434",
          ),
          timeoutMs: configuration.get<number>("ai.timeoutMs", 12000),
          maxInputChars: configuration.get<number>("ai.maxInputChars", 18000),
          enableRag: false,
        }
      : { provider: "disabled", enableRag: false },
    // Restricted Mode: never start Git for an untrusted folder.
    git: { enabled: vscode.workspace.isTrusted },
    staticAnalysis: {
      enableBuiltInRules: true,
      enableSemgrep: false,
      enableNpmAudit: false,
    },
  };
}

function scanFileLimit(): number {
  return scanConfigSchema.parse(
    createExtensionScannerConfig({ allowAi: false }),
  ).performance.maxFiles;
}

function validUrlOrFallback(value: string, fallback: string): string {
  try {
    return new URL(value).toString();
  } catch {
    return fallback;
  }
}

interface ReviewItem extends vscode.QuickPickItem {
  finding: Finding;
  fromClipboard: boolean;
}

function isReviewItem(
  item: ReviewItem | vscode.QuickPickItem,
): item is ReviewItem {
  return "finding" in item;
}

function fileKey(filePath: string): string {
  return vscode.Uri.file(filePath).toString();
}

function buildClipboardReviewItems(
  findings: Finding[],
): Array<ReviewItem | vscode.QuickPickItem> {
  if (findings.length === 0) {
    return [];
  }

  return [
    {
      label: "Blocked clipboard content (not inserted)",
      kind: vscode.QuickPickItemKind.Separator,
    },
    ...findings.map((finding) => {
      const friendly = friendlyFinding(finding);
      return {
        label: `${severityIcon(finding.severity)} ${friendly.title}`,
        description: `${friendly.level} | clipboard line ${finding.location.startLine}`,
        detail: friendly.explanation,
        finding,
        fromClipboard: true,
      };
    }),
  ];
}

interface FixTarget {
  content: string;
  filePath: string;
  language: ScanFile["language"];
  documentUri: vscode.Uri;
  documentVersion: number;
  selections: vscode.Selection[];
  replaceWholeDocument: boolean;
  findingIds: Set<string>;
}

function buildReviewItems(
  findings: Finding[],
): Array<ReviewItem | vscode.QuickPickItem> {
  const grouped = new Map<string, Finding[]>();
  for (const finding of findings) {
    const entries = grouped.get(finding.location.filePath) ?? [];
    entries.push(finding);
    grouped.set(finding.location.filePath, entries);
  }

  const items: Array<ReviewItem | vscode.QuickPickItem> = [];
  for (const [filePath, fileFindings] of grouped) {
    items.push({
      label: vscode.workspace.asRelativePath(filePath, false),
      kind: vscode.QuickPickItemKind.Separator,
    });
    for (const finding of fileFindings) {
      const friendly = friendlyFinding(finding);
      items.push({
        label: `${severityIcon(finding.severity)} ${friendly.title}`,
        description: `${friendly.level} | line ${finding.location.startLine}`,
        detail: friendly.explanation,
        finding,
        fromClipboard: false,
      });
    }
  }
  return items;
}

function friendlyFinding(finding: Finding | undefined): {
  level: string;
  title: string;
  explanation: string;
} {
  if (finding === undefined) {
    return {
      level: "Paste blocked",
      title: "an important security risk must be fixed",
      explanation:
        "The code was not inserted to prevent exposure or unauthorized access.",
    };
  }

  if (finding.id.startsWith("dotenv-exposure-")) {
    return {
      level: finding.severity === "high" ? "Fix required" : "Needs attention",
      title: finding.title,
      explanation: finding.description,
    };
  }

  const level =
    finding.severity === "critical" || finding.severity === "high"
      ? "Fix required"
      : finding.severity === "medium"
        ? "Needs attention"
        : "Improvement suggestion";
  const byCategory: Record<
    Finding["category"],
    { title: string; explanation: string }
  > = {
    secret: {
      title: "A key, password, or token may be exposed",
      explanation:
        "This data can leak through commits, history, logs, or screenshots.",
    },
    auth: {
      title: "Someone may access data they should not",
      explanation:
        "Identity or permission checks appear insufficient in this path.",
    },
    injection: {
      title: "Input may alter a command",
      explanation:
        "External data may change a query or instruction and execute unexpected behavior.",
    },
    xss: {
      title: "External content may execute in the browser",
      explanation:
        "An attacker may turn displayed data into executable code on the page.",
    },
    validation: {
      title: "Input is accepted without enough validation",
      explanation:
        "Unexpected values may reach sensitive parts of the application.",
    },
    dependency: {
      title: "A project dependency has a known risk",
      explanation:
        "The installed version may contain a published security vulnerability.",
    },
    "prompt-injection": {
      title: "A user may influence AI instructions",
      explanation:
        "Untrusted text may redirect the model or expose context that should remain private.",
    },
    configuration: {
      title: "A configuration is too permissive",
      explanation:
        "The system may allow more origins, access, or behavior than necessary.",
    },
    transport: {
      title: "Data may travel without enough protection",
      explanation:
        "Sensitive information may be observed or changed while in transit.",
    },
    other: {
      title:
        finding.source === "llm"
          ? finding.title
          : "Potentially unsafe behavior needs review",
      explanation:
        finding.source === "llm"
          ? finding.description
          : "This code may create a security risk outside common rule patterns.",
    },
  };

  const friendly = byCategory[finding.category];
  return {
    level,
    title:
      finding.source === "llm" && finding.category !== "other"
        ? `${friendly.title}: ${finding.title}`
        : friendly.title,
    explanation:
      finding.source === "llm" ? finding.description : friendly.explanation,
  };
}

function locateClipboardFindings(
  findings: Finding[],
  document: vscode.TextDocument,
  insertion: vscode.Position,
): Finding[] {
  return findings.map((finding) => {
    const startsOnFirstLine = finding.location.startLine === 1;
    const endsOnFirstLine = finding.location.endLine === 1;
    return {
      ...finding,
      location: {
        ...finding.location,
        filePath:
          document.uri.scheme === "file"
            ? document.uri.fsPath
            : document.fileName,
        startLine: insertion.line + finding.location.startLine,
        startColumn: startsOnFirstLine
          ? insertion.character + finding.location.startColumn
          : finding.location.startColumn,
        endLine: insertion.line + finding.location.endLine,
        endColumn: endsOnFirstLine
          ? insertion.character + finding.location.endColumn
          : finding.location.endColumn,
      },
    };
  });
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

function previewLanguage(language: ScanFile["language"]): string {
  return language === "env" || language === "unknown" ? "plaintext" : language;
}

function isSupportedDocument(document: vscode.TextDocument): boolean {
  return (
    document.uri.scheme === "file" &&
    (supportedLanguageIds.has(document.languageId) ||
      document.fileName.split(/[\\/]/).at(-1)?.startsWith(".env") === true)
  );
}

function toRange(finding: Finding): vscode.Range {
  const startLine = Math.max(finding.location.startLine - 1, 0);
  const startColumn = Math.max(finding.location.startColumn - 1, 0);
  const endLine = Math.max(finding.location.endLine - 1, startLine);
  const endColumn = Math.max(finding.location.endColumn - 1, startColumn + 1);
  return new vscode.Range(startLine, startColumn, endLine, endColumn);
}

function toDiagnosticSeverity(
  severity: Finding["severity"],
): vscode.DiagnosticSeverity {
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
  const friendly = friendlyFinding(finding);
  return `${friendly.title}\nWhy this matters: ${friendly.explanation}\nNext step: ${friendlyRecommendation(finding)}`;
}

function friendlyRecommendation(finding: Finding): string {
  if (finding.source === "llm" || finding.id.startsWith("dotenv-exposure-")) {
    return finding.fix.description;
  }

  const recommendations: Record<Finding["category"], string> = {
    secret:
      "Remove the value from source code, use a protected environment variable, and rotate the credential if it was already used.",
    auth: "Require authentication and verify the correct permission before reading or changing data.",
    injection:
      "Keep external data separate from commands by using parameters or a safe API.",
    xss: "Avoid raw HTML or sanitize content with an allowlist-based sanitizer.",
    validation:
      "Validate format, size, and allowed values before using the input.",
    dependency: "Upgrade to a fixed version and run the project test suite.",
    "prompt-injection":
      "Separate instructions from external data and limit the available context and tools.",
    configuration:
      "Allow only the origins, access, and options that are actually required.",
    transport:
      "Use an encrypted channel and validate the connection destination correctly.",
    other:
      "Review the flow and apply the smallest change that removes the risk.",
  };
  return recommendations[finding.category];
}

function severityIcon(severity: Finding["severity"]): string {
  switch (severity) {
    case "critical":
    case "high":
      return "$(error)";
    case "medium":
      return "$(warning)";
    case "low":
    case "info":
      return "$(info)";
  }
}

function formatCount(value: number, singular: string, plural: string): string {
  return `${value} ${value === 1 ? singular : plural}`;
}

function isLocalAiEnabled(): boolean {
  return getBooleanSetting("ai.enabled", false);
}

function getBooleanSetting(key: string, fallback: boolean): boolean {
  return vscode.workspace
    .getConfiguration("vibinguard")
    .get<boolean>(key, fallback);
}
