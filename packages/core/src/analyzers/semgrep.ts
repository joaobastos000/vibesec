import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import type { ScanConfig } from "../config.js";
import { buildFixPrompt } from "../fix-prompts.js";
import type { Finding } from "../types.js";

const execFileAsync = promisify(execFile);

interface SemgrepJson {
  results?: Array<{
    check_id: string;
    path: string;
    start: { line: number; col: number };
    end: { line: number; col: number };
    extra?: {
      message?: string;
      severity?: string;
      metadata?: {
        cwe?: string | string[];
        owasp?: string | string[];
      };
      lines?: string;
    };
  }>;
}

export async function runSemgrep(target: string, config: ScanConfig): Promise<Finding[]> {
  try {
    const { stdout } = await execFileAsync(
      "semgrep",
      ["--config", "p/owasp-top-ten", "--json", "--quiet", path.resolve(target)],
      { timeout: config.performance.commandTimeoutMs, maxBuffer: 1024 * 1024 * 8 },
    );
    const parsed = JSON.parse(stdout) as SemgrepJson;

    return (parsed.results ?? []).map((result) => {
      const severity = normalizeSeverity(result.extra?.severity);
      const findingBase = {
        id: `semgrep-${result.check_id}-${result.path}-${result.start.line}-${result.start.col}`,
        title: result.check_id,
        description: result.extra?.message ?? "Semgrep detected a possible security issue.",
        category: "other" as const,
        severity,
        confidence: "medium" as const,
        source: "semgrep" as const,
        location: {
          filePath: path.resolve(result.path),
          startLine: result.start.line,
          startColumn: result.start.col,
          endLine: result.end.line,
          endColumn: result.end.col,
        },
        cwe: flattenMetadata(result.extra?.metadata?.cwe),
        owasp: flattenMetadata(result.extra?.metadata?.owasp),
        evidence: result.extra?.lines?.trim() ?? result.check_id,
      };

      return {
        ...findingBase,
        fix: {
          kind: "prompt" as const,
          title: "Generate secure Semgrep fix prompt",
          description: "Use the Semgrep finding as context and ask the coding agent for a minimal secure patch.",
          prompt: buildFixPrompt(findingBase),
        },
      };
    });
  } catch {
    return [];
  }
}

function normalizeSeverity(input: string | undefined): Finding["severity"] {
  switch (input?.toUpperCase()) {
    case "ERROR":
      return "high";
    case "WARNING":
      return "medium";
    case "INFO":
      return "low";
    default:
      return "medium";
  }
}

function flattenMetadata(input: string | string[] | undefined): string | undefined {
  if (Array.isArray(input)) {
    return input.join(", ");
  }

  return input;
}
