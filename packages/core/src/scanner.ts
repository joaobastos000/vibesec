import {
  generatedContentGuardRequestSchema,
  scanRequestSchema,
  resolveConfig,
  type GeneratedContentGuardRequest,
  type ScanConfig,
  type ScanConfigInput,
  type ScanRequest,
} from "./config.js";
import { runBuiltInRules } from "./analyzers/static-rules.js";
import { runNpmAudit } from "./analyzers/npm-audit.js";
import { runSemgrep } from "./analyzers/semgrep.js";
import { createLlmAnalyzer, createSkippedAiSummary } from "./analyzers/llm.js";
import { discoverFiles } from "./file-discovery.js";
import { calculateScore, emptySeverityCounts } from "./scoring.js";
import type {
  Finding,
  GeneratedContentFixRequest,
  GeneratedContentFixResult,
  GeneratedContentGuardResult,
  ScanResult,
} from "./types.js";

const blockingSeverities = new Set<Finding["severity"]>(["critical", "high"]);

export function createScanner(config: ScanConfigInput = {}): VibinGuardScanner {
  return new VibinGuardScanner(config);
}

export class VibinGuardScanner {
  readonly config: ScanConfig;

  constructor(config: ScanConfigInput = {}) {
    this.config = resolveConfig(config);
  }

  async scan(input: ScanRequest): Promise<ScanResult> {
    const startedAt = Date.now();
    const request = scanRequestSchema.parse(input);
    const files = await discoverFiles(request, this.config);
    const findings: Finding[] = [];

    if (this.config.staticAnalysis.enableBuiltInRules) {
      findings.push(...runBuiltInRules(files, this.config));
    }

    if (
      request.mode === "project" &&
      this.config.staticAnalysis.enableSemgrep
    ) {
      findings.push(...(await runSemgrep(request.target, this.config)));
    }

    if (
      request.mode === "project" &&
      this.config.staticAnalysis.enableNpmAudit
    ) {
      findings.push(...(await runNpmAudit(request.target, this.config)));
    }

    const aiAnalysis = await createLlmAnalyzer(this.config).analyze(
      files,
      findings,
    );
    findings.push(...aiAnalysis.findings);

    const dedupedFindings = dedupeFindings(findings);
    const bySeverity = emptySeverityCounts();
    for (const finding of dedupedFindings) {
      bySeverity[finding.severity] += 1;
    }

    return {
      target: request.target,
      generatedAt: new Date().toISOString(),
      score: calculateScore(dedupedFindings),
      summary: {
        filesScanned: files.length,
        findings: dedupedFindings.length,
        bySeverity,
        durationMs: Date.now() - startedAt,
      },
      ai: aiAnalysis.summary,
      findings: dedupedFindings.sort(compareFindings),
    };
  }

  async guardGeneratedContent(
    input: GeneratedContentGuardRequest,
  ): Promise<GeneratedContentGuardResult> {
    const startedAt = Date.now();
    const request = generatedContentGuardRequestSchema.parse(input);
    const target = request.filePath ?? "ai-generated://draft";
    const files = [
      {
        path: target,
        content: request.content,
        language: request.language,
      },
    ];

    const findings: Finding[] = this.config.staticAnalysis.enableBuiltInRules
      ? runBuiltInRules(files, this.config).map((finding) => ({
          ...finding,
          source: "generation-guard" as const,
        }))
      : [];

    const hasImmediateBlock = findings.some(shouldBlockGeneratedContent);
    const aiAnalysis =
      hasImmediateBlock && this.config.ai.provider !== "disabled"
        ? {
            findings: [],
            summary: createSkippedAiSummary(
              this.config,
              "A IA local nao recebeu este conteudo porque uma regra local ja encontrou um risco bloqueante.",
            ),
          }
        : await createLlmAnalyzer(this.config).analyze(files, findings);
    findings.push(...aiAnalysis.findings);

    const dedupedFindings = dedupeFindings(findings);
    const sortedFindings = dedupedFindings.sort(compareFindings);
    const bySeverity = emptySeverityCounts();
    for (const finding of sortedFindings) {
      bySeverity[finding.severity] += 1;
    }

    const blocked = sortedFindings.some(shouldBlockGeneratedContent);

    return {
      target,
      generatedAt: new Date().toISOString(),
      blocked,
      reason: blocked
        ? this.config.language === "pt-BR"
          ? "O conteudo gerado tem um risco bloqueante e precisa ser corrigido antes de ser inserido, salvo ou compartilhado."
          : "Generated content has a blocking security risk and must be fixed before it is inserted, saved, or shared."
        : this.config.language === "pt-BR"
          ? "Nenhum risco bloqueante foi encontrado no conteudo gerado."
          : "No blocking risk was found in the generated content.",
      score: calculateScore(sortedFindings),
      summary: {
        findings: sortedFindings.length,
        bySeverity,
        durationMs: Date.now() - startedAt,
      },
      ai: aiAnalysis.summary,
      findings: sortedFindings,
    };
  }

  async suggestGeneratedContentFix(
    input: GeneratedContentFixRequest,
  ): Promise<GeneratedContentFixResult> {
    if (input.content.trim().length === 0) {
      throw new Error("Generated content must not be empty.");
    }

    const target = input.filePath ?? input.finding.location.filePath;
    const suggestion = await createLlmAnalyzer(this.config).suggestFix(
      {
        path: target,
        content: input.content,
        language: input.language,
      },
      input.finding,
    );

    if (!suggestion.available) {
      return {
        available: false,
        ai: suggestion.summary,
      };
    }

    const review = await this.guardGeneratedContent({
      content: suggestion.replacement,
      filePath: target,
      language: input.language,
    });

    return {
      available: true,
      replacement: suggestion.replacement,
      explanation: suggestion.explanation,
      review,
      ai: suggestion.summary,
    };
  }
}

function shouldBlockGeneratedContent(finding: Finding): boolean {
  if (finding.source === "llm") {
    return (
      finding.confidence === "high" &&
      (finding.category === "secret" ||
        blockingSeverities.has(finding.severity))
    );
  }

  return (
    finding.category === "secret" || blockingSeverities.has(finding.severity)
  );
}

function dedupeFindings(findings: Finding[]): Finding[] {
  const byKey = new Map<string, Finding>();

  for (const finding of findings) {
    const key = [
      finding.source,
      finding.title,
      finding.location.filePath,
      finding.location.startLine,
      finding.location.startColumn,
    ].join(":");

    if (!byKey.has(key)) {
      byKey.set(key, finding);
    }
  }

  return [...byKey.values()];
}

const severityRank: Record<Finding["severity"], number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
};

function compareFindings(left: Finding, right: Finding): number {
  return (
    severityRank[left.severity] - severityRank[right.severity] ||
    left.location.filePath.localeCompare(right.location.filePath) ||
    left.location.startLine - right.location.startLine
  );
}
