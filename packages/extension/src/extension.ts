import * as vscode from "vscode";
import {
  createScanner,
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
const openReviewAction = "Abrir revisão";
const copyFixAction = "Pedir correção à IA";
const fixWithAiAction = "Corrigir com IA local";
const technicalDetailsAction = "Detalhes técnicos";

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel("VibinGuard");
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
  private lastFindings: Finding[] = [];
  private lastAiSummary: AiAnalysisSummary | undefined;
  private pendingFixTarget: FixTarget | undefined;

  constructor(
    private readonly output: vscode.OutputChannel,
    private readonly diagnostics: vscode.DiagnosticCollection,
  ) {}

  async scanCurrentFile(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (editor === undefined) {
      void vscode.window.showWarningMessage(
        "VibinGuard: abra um arquivo antes de iniciar a revisão.",
      );
      return;
    }

    if (!isSupportedDocument(editor.document)) {
      void vscode.window.showWarningMessage(
        "VibinGuard: este tipo de arquivo ainda não é compatível.",
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
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (folder === undefined) {
      void vscode.window.showWarningMessage(
        "VibinGuard: abra uma pasta de projeto antes de iniciar a revisão.",
      );
      return;
    }

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: isLocalAiEnabled()
          ? "VibinGuard está fazendo duas camadas de revisão"
          : "VibinGuard está revisando o projeto",
        cancellable: false,
      },
      async () => {
        const scanner = createScanner(
          createExtensionScannerConfig({ allowAi: true }),
        );
        const result = await scanner.scan({
          target: folder.uri.fsPath,
          mode: "project",
        });
        this.rememberReview(result.findings, result.ai);
        this.applyDiagnostics(result.findings);
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
        "VibinGuard: abra um arquivo antes de proteger uma colagem.",
      );
      return;
    }

    const content = await vscode.env.clipboard.readText();
    if (content.trim().length === 0) {
      void vscode.window.showWarningMessage(
        "VibinGuard: a área de transferência está vazia.",
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
    const review = () =>
      scanner.guardGeneratedContent({
        content,
        filePath,
        language: detectLanguage(editor.document),
      });
    const result = isLocalAiEnabled()
      ? await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: "VibinGuard está revisando esta colagem localmente",
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
        language: detectLanguage(editor.document),
        documentUri: editor.document.uri,
        documentVersion: editor.document.version,
        selections: [...editor.selections],
        replaceWholeDocument: false,
        findingIds: new Set(editorFindings.map((finding) => finding.id)),
      };
      this.rememberReview(editorFindings, result.ai);
      this.applyDiagnostics(editorFindings);
      const firstFinding = editorFindings[0];
      const message = `VibinGuard segurou esta colagem. ${friendlyFinding(firstFinding).title}.`;
      const correctionAction = isLocalAiEnabled()
        ? fixWithAiAction
        : copyFixAction;
      void vscode.window
        .showErrorMessage(message, openReviewAction, correctionAction)
        .then((action) => this.handleFindingAction(action, firstFinding));
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

    this.pendingFixTarget = undefined;

    if (editorFindings.length > 0) {
      this.rememberReview(editorFindings, result.ai);
      this.applyDiagnostics(editorFindings);
      void vscode.window
        .showWarningMessage(
          `O código foi inserido, mas o VibinGuard encontrou ${formatCount(editorFindings.length, "ponto", "pontos")} para revisar.`,
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
          "O código passou pelas verificações essenciais e foi inserido, mas a IA local não respondeu.",
          "Verificar IA local",
        )
        .then((action) =>
          action === "Verificar IA local" ? this.checkLocalAi() : undefined,
        );
      return;
    }

    void vscode.window.showInformationMessage(
      result.ai.available === true
        ? "VibinGuard: as duas camadas aprovaram o código e ele foi inserido."
        : "VibinGuard: o código passou pelas verificações e foi inserido.",
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
    if (this.lastFindings.length === 0) {
      const suffix =
        this.lastAiSummary?.available === false
          ? " A IA local não respondeu na última tentativa."
          : "";
      void vscode.window.showInformationMessage(
        `VibinGuard: nenhum alerta está aguardando revisão.${suffix}`,
      );
      return;
    }

    const items = buildReviewItems(this.lastFindings);
    const selected = await vscode.window.showQuickPick(items, {
      title: "Revisão de segurança do VibinGuard",
      placeHolder:
        "Escolha um alerta para ver o trecho e decidir o próximo passo",
      matchOnDescription: true,
      matchOnDetail: true,
    });

    if (selected === undefined || !("finding" in selected)) {
      return;
    }

    await this.openFinding(selected.finding);
    this.showFindingActions(selected.finding);
  }

  async configureLocalAi(): Promise<void> {
    const enabled = isLocalAiEnabled();
    const selected = await vscode.window.showQuickPick(
      [
        {
          label: "Ativar a segunda revisão local",
          description: "Usa o Ollama no seu computador",
          enabled: true,
        },
        {
          label: "Manter apenas as verificações essenciais",
          description: "Não chama nenhum modelo de IA",
          enabled: false,
        },
      ],
      {
        title: "Configurar IA local do VibinGuard",
        placeHolder: enabled
          ? "A segunda revisão está ativa"
          : "A segunda revisão está desativada",
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
        "VibinGuard: a revisão local com IA foi desativada.",
      );
      return;
    }

    const currentModel = configuration.get<string>(
      "ai.model",
      "qwen2.5-coder:3b-instruct",
    );
    const model = await vscode.window.showInputBox({
      title: "Modelo local usado na segunda revisão",
      value: currentModel,
      prompt: "Informe o nome de um modelo de código já disponível no Ollama",
      validateInput: (value) =>
        value.trim().length === 0 ? "Informe o nome do modelo." : undefined,
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
          "A segunda revisão local está desativada.",
          "Configurar agora",
        )
        .then((action) =>
          action === "Configurar agora" ? this.configureLocalAi() : undefined,
        );
      return;
    }

    const result = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "VibinGuard está verificando a IA local",
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
        `VibinGuard: a IA local está pronta com o modelo ${result.ai.model ?? "configurado"}.`,
      );
      return;
    }

    void vscode.window
      .showWarningMessage(
        "O Ollama não respondeu em localhost. As verificações essenciais continuam funcionando.",
        "Tentar novamente",
        "Abrir configurações",
      )
      .then((action) => {
        if (action === "Tentar novamente") {
          return this.checkLocalAi();
        }
        if (action === "Abrir configurações") {
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
    this.rememberReview(result.findings, result.ai);
    this.applyDiagnostics(result.findings);

    if (options.showOutput) {
      this.writeScanResult("Current file scan", result);
      this.output.show(true);
    }

    if (options.showToast) {
      this.showScanNotice(result);
    }
  }

  private rememberReview(
    findings: Finding[],
    aiSummary: AiAnalysisSummary,
  ): void {
    this.lastFindings = findings;
    this.lastAiSummary = aiSummary;
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
      diagnostic.source =
        finding.source === "llm" ? "VibinGuard IA local" : "VibinGuard";

      const existing = byFile.get(finding.location.filePath) ?? [];
      existing.push(diagnostic);
      byFile.set(finding.location.filePath, existing);
    }

    this.diagnostics.clear();
    for (const [filePath, fileDiagnostics] of byFile.entries()) {
      this.diagnostics.set(vscode.Uri.file(filePath), fileDiagnostics);
    }
  }

  private showScanNotice(result: ScanResult): void {
    if (result.summary.findings === 0) {
      const message =
        result.ai.available === true
          ? "VibinGuard: as duas camadas concluíram a revisão sem alertas."
          : result.ai.enabled && result.ai.available === false
            ? "Nenhum alerta essencial foi encontrado, mas a IA local não respondeu."
            : "VibinGuard: nenhuma vulnerabilidade conhecida foi encontrada.";
      void vscode.window.showInformationMessage(message);
      return;
    }

    const urgent =
      result.summary.bySeverity.critical + result.summary.bySeverity.high;
    const message =
      urgent > 0
        ? `VibinGuard encontrou ${formatCount(result.summary.findings, "ponto", "pontos")}; ${formatCount(urgent, "precisa", "precisam")} de correção antes de compartilhar.`
        : `VibinGuard encontrou ${formatCount(result.summary.findings, "ponto", "pontos")} que merecem atenção.`;
    void vscode.window
      .showWarningMessage(message, openReviewAction)
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
        "VibinGuard: o arquivo deste alerta não está mais disponível.",
      );
    }
  }

  private showFindingActions(finding: Finding): void {
    const friendly = friendlyFinding(finding);
    const correctionAction = isLocalAiEnabled()
      ? fixWithAiAction
      : copyFixAction;
    void vscode.window
      .showInformationMessage(
        `${friendly.level}: ${friendly.title}. ${friendly.explanation}`,
        correctionAction,
        technicalDetailsAction,
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
    return undefined;
  }

  private async copyFixPrompt(finding: Finding): Promise<void> {
    const prompt = finding.fix.prompt ?? finding.fix.description;
    await vscode.env.clipboard.writeText(prompt);
    void vscode.window.showInformationMessage(
      "Pedido de correção copiado para usar no seu assistente de código.",
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
        title: "VibinGuard está preparando e reanalisando a correção",
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
        .showWarningMessage(
          result.ai.message,
          copyFixAction,
          "Verificar IA local",
        )
        .then((action) => {
          if (action === copyFixAction) {
            return this.copyFixPrompt(finding);
          }
          if (action === "Verificar IA local") {
            return this.checkLocalAi();
          }
          return undefined;
        });
      return;
    }

    const reviewedFindings = target.replaceWholeDocument
      ? result.review.findings
      : locateClipboardFindings(
          result.review.findings,
          await vscode.workspace.openTextDocument(target.documentUri),
          target.selections[0]?.start ?? new vscode.Position(0, 0),
        );

    if (result.review.blocked) {
      this.rememberReview(reviewedFindings, result.review.ai);
      this.applyDiagnostics(reviewedFindings);
      void vscode.window
        .showErrorMessage(
          "A proposta da IA ainda contém um risco bloqueante e não será aplicada.",
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
        ? "As duas camadas não encontraram novos alertas."
        : `Ainda há ${formatCount(result.review.findings.length, "ponto", "pontos")} não bloqueante(s) para revisar.`;
    const decision = await vscode.window.showInformationMessage(
      `${result.explanation}\n\n${remainingNotice}`,
      { modal: true },
      "Aplicar correção",
      "Descartar",
    );

    await vscode.commands.executeCommand(
      "workbench.action.revertAndCloseActiveEditor",
    );
    if (decision !== "Aplicar correção") {
      void vscode.window.showInformationMessage(
        "VibinGuard: a proposta foi descartada e nenhum código foi alterado.",
      );
      return;
    }

    const applied = await this.applyFixTarget(target, result.replacement);
    if (!applied) {
      return;
    }

    this.rememberReview(reviewedFindings, result.review.ai);
    this.applyDiagnostics(reviewedFindings);
    if (this.pendingFixTarget?.findingIds.has(finding.id) === true) {
      this.pendingFixTarget = undefined;
    }
    void vscode.window.showInformationMessage(
      reviewedFindings.length === 0
        ? "VibinGuard: a correção foi aplicada e aprovada pelas duas camadas."
        : "VibinGuard: a correção foi aplicada, com pontos não bloqueantes mantidos na revisão.",
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
          "VibinGuard: este arquivo não pode receber uma correção automática.",
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
        "VibinGuard: o arquivo deste alerta não está mais disponível.",
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
        "O arquivo mudou enquanto a correção era preparada. Execute a revisão novamente para evitar sobrescrever trabalho recente.",
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
        "VibinGuard não conseguiu aplicar a correção. Nenhum código foi alterado.",
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
        `Fonte: ${finding.source}`,
        `Categoria: ${finding.category}`,
        `Severidade: ${finding.severity}`,
        `Confiança: ${finding.confidence}`,
        standards.length > 0 ? `Referências: ${standards}` : undefined,
      ]
        .filter((value) => value !== undefined)
        .join("\n"),
      { modal: true },
    );
  }

  private writeScanResult(title: string, result: ScanResult): void {
    this.output.appendLine("");
    this.output.appendLine(`## ${title}`);
    this.output.appendLine(`Target: ${result.target}`);
    this.output.appendLine(
      `Score: ${result.score.value} (${result.score.label})`,
    );
    this.output.appendLine(
      `Findings: ${result.summary.findings} | critical ${result.summary.bySeverity.critical}, high ${result.summary.bySeverity.high}, medium ${result.summary.bySeverity.medium}, low ${result.summary.bySeverity.low}, info ${result.summary.bySeverity.info}`,
    );
    this.output.appendLine(`Duration: ${result.summary.durationMs}ms`);
    this.writeAiSummary(result.ai);
    this.writeFindings(result.findings);
  }

  private writeGuardResult(result: GeneratedContentGuardResult): void {
    this.output.appendLine("");
    this.output.appendLine("## Generated content guard");
    this.output.appendLine(`Target: ${result.target}`);
    this.output.appendLine(`Blocked: ${result.blocked ? "yes" : "no"}`);
    this.output.appendLine(`Reason: ${result.reason}`);
    this.output.appendLine(`Findings: ${result.summary.findings}`);
    this.writeAiSummary(result.ai);
    this.writeFindings(result.findings);
  }

  private writeAiSummary(summary: AiAnalysisSummary): void {
    this.output.appendLine(
      `Local AI: ${summary.enabled ? (summary.available === true ? "available" : summary.attempted ? "unavailable" : "skipped") : "disabled"}`,
    );
    this.output.appendLine(`Local AI detail: ${summary.message}`);
  }

  private writeFindings(findings: Finding[]): void {
    if (findings.length === 0) {
      this.output.appendLine("No findings.");
      return;
    }

    for (const finding of findings) {
      this.output.appendLine("");
      this.output.appendLine(
        `[${finding.severity.toUpperCase()}] ${finding.title}`,
      );
      this.output.appendLine(
        `${finding.location.filePath}:${finding.location.startLine}:${finding.location.startColumn}`,
      );
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

function createExtensionScannerConfig(options: {
  allowAi: boolean;
}): ScanConfigInput {
  const configuration = vscode.workspace.getConfiguration("vibinguard");
  const language = configuration.get<"pt-BR" | "en-US">("language", "pt-BR");
  const useAi =
    options.allowAi && configuration.get<boolean>("ai.enabled", false);

  return {
    language,
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
    staticAnalysis: {
      enableBuiltInRules: true,
      enableSemgrep: false,
      enableNpmAudit: false,
    },
  };
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
        description: `${friendly.level} | linha ${finding.location.startLine}`,
        detail: friendly.explanation,
        finding,
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
      level: "Colagem bloqueada",
      title: "um risco importante precisa ser corrigido",
      explanation:
        "O código não foi inserido para evitar exposição ou acesso indevido.",
    };
  }

  const level =
    finding.severity === "critical" || finding.severity === "high"
      ? "Precisa de correção"
      : finding.severity === "medium"
        ? "Precisa de atenção"
        : "Sugestão de melhoria";
  const byCategory: Record<
    Finding["category"],
    { title: string; explanation: string }
  > = {
    secret: {
      title: "Uma chave, senha ou token pode ficar exposto",
      explanation:
        "Esse dado pode vazar em commits, histórico, logs ou capturas de tela.",
    },
    auth: {
      title: "Alguém pode acessar o que não deveria",
      explanation:
        "A verificação de identidade ou permissão parece insuficiente neste caminho.",
    },
    injection: {
      title: "Uma entrada pode alterar um comando",
      explanation:
        "Dados externos podem mudar uma consulta ou instrução e executar algo inesperado.",
    },
    xss: {
      title: "Conteúdo externo pode executar no navegador",
      explanation:
        "Um invasor pode transformar dados exibidos em código dentro da página.",
    },
    validation: {
      title: "A entrada está sendo aceita sem verificação suficiente",
      explanation:
        "Valores inesperados podem chegar a partes sensíveis da aplicação.",
    },
    dependency: {
      title: "Uma biblioteca usada pelo projeto tem risco conhecido",
      explanation:
        "A versão instalada pode conter uma falha de segurança publicada.",
    },
    "prompt-injection": {
      title: "Um usuário pode influenciar instruções da IA",
      explanation:
        "Texto não confiável pode desviar o modelo ou expor contexto que deveria permanecer privado.",
    },
    configuration: {
      title: "Uma configuração está permissiva demais",
      explanation:
        "O sistema pode aceitar origens, acessos ou comportamentos além do necessário.",
    },
    transport: {
      title: "Dados podem trafegar sem proteção suficiente",
      explanation:
        "Informações sensíveis podem ser observadas ou alteradas durante o envio.",
    },
    other: {
      title:
        finding.source === "llm"
          ? finding.title
          : "Um comportamento inseguro precisa ser revisado",
      explanation:
        finding.source === "llm"
          ? finding.description
          : "Este trecho pode criar um risco fora dos casos comuns.",
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
  return `${friendly.title}\nPor que isso importa: ${friendly.explanation}\nPróximo passo: ${friendlyRecommendation(finding)}`;
}

function friendlyRecommendation(finding: Finding): string {
  if (finding.source === "llm") {
    return finding.fix.description;
  }

  const recommendations: Record<Finding["category"], string> = {
    secret:
      "Remova o valor do código, use uma variável de ambiente segura e troque a credencial se ela já foi usada.",
    auth: "Exija login e confira a permissão correta antes de ler ou alterar os dados.",
    injection:
      "Separe dados externos do comando usando parâmetros ou uma API segura.",
    xss: "Evite HTML bruto ou sanitize o conteúdo com uma lista de elementos permitidos.",
    validation:
      "Valide formato, tamanho e valores permitidos antes de usar a entrada.",
    dependency:
      "Atualize para uma versão corrigida e execute os testes do projeto.",
    "prompt-injection":
      "Separe instruções de dados externos e limite o contexto e as ferramentas disponíveis.",
    configuration:
      "Permita somente origens, acessos e opções realmente necessários.",
    transport:
      "Use um canal criptografado e valide corretamente o destino da conexão.",
    other: "Revise o fluxo e aplique a menor mudança que elimine o risco.",
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
