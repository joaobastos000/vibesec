import { scanRequestSchema, resolveConfig, type ScanConfig, type ScanRequest } from "./config.js";
import { runBuiltInRules } from "./analyzers/static-rules.js";
import { runNpmAudit } from "./analyzers/npm-audit.js";
import { runSemgrep } from "./analyzers/semgrep.js";
import { createLlmAnalyzer } from "./analyzers/llm.js";
import { discoverFiles } from "./file-discovery.js";
import { calculateScore, emptySeverityCounts } from "./scoring.js";
import type { Finding, ScanResult } from "./types.js";

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

