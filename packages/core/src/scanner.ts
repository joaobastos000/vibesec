import {
  generatedContentGuardRequestSchema,
  scanRequestSchema,
  resolveConfig,
  type GeneratedContentGuardRequest,
  type ScanConfig,
  type ScanRequest,
} from "./config.js";
import { runBuiltInRules } from "./analyzers/static-rules.js";
import { runNpmAudit } from "./analyzers/npm-audit.js";
import { runSemgrep } from "./analyzers/semgrep.js";
import { createLlmAnalyzer } from "./analyzers/llm.js";
import { discoverFiles } from "./file-discovery.js";
import { calculateScore, emptySeverityCounts } from "./scoring.js";
import type { Finding, GeneratedContentGuardResult, ScanResult } from "./types.js";

const blockingSeverities = new Set<Finding["severity"]>(["critical", "high"]);

export function createScanner(config: Partial<ScanConfig> = {}): VibeGuardScanner {
  return new VibeGuardScanner(config);
}

export class VibeGuardScanner {
  readonly config: ScanConfig;

  constructor(config: Partial<ScanConfig> = {}) {
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

    if (request.mode === "project" && this.config.staticAnalysis.enableSemgrep) {
      findings.push(...(await runSemgrep(request.target, this.config)));
    }

    if (request.mode === "project" && this.config.staticAnalysis.enableNpmAudit) {
      findings.push(...(await runNpmAudit(request.target, this.config)));
    }

    const llmAnalyzer = createLlmAnalyzer(this.config);
    findings.push(...(await llmAnalyzer.analyze(files, findings)));

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
      findings: dedupedFindings.sort(compareFindings),
    };
  }

  async guardGeneratedContent(input: GeneratedContentGuardRequest): Promise<GeneratedContentGuardResult> {
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

    const findings = this.config.staticAnalysis.enableBuiltInRules
      ? runBuiltInRules(files, this.config).map((finding) => ({
          ...finding,
          source: "generation-guard" as const,
        }))
      : [];

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
        ? "Generated content contains blocking security findings and must be fixed before it is written, committed, logged, or shared."
        : "No blocking generated-content findings were detected.",
      score: calculateScore(sortedFindings),
      summary: {
        findings: sortedFindings.length,
        bySeverity,
        durationMs: Date.now() - startedAt,
      },
      findings: sortedFindings,
    };
  }
}

function shouldBlockGeneratedContent(finding: Finding): boolean {
  return finding.category === "secret" || blockingSeverities.has(finding.severity);
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

