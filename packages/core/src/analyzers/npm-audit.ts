import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import type { ScanConfig } from "../config.js";
import { buildFixPrompt } from "../fix-prompts.js";
import type { Finding } from "../types.js";

const execFileAsync = promisify(execFile);

interface AuditJson {
  vulnerabilities?: Record<string, AuditVulnerability>;
}

interface AuditVulnerability {
  name: string;
  severity: Finding["severity"];
  title?: string;
  via?: Array<string | { title?: string; url?: string; severity?: Finding["severity"] }>;
  range?: string;
  fixAvailable?: boolean | object;
}

export async function runNpmAudit(target: string, config: ScanConfig): Promise<Finding[]> {
  try {
    const { stdout } = await execFileAsync("npm", ["audit", "--json", "--audit-level=low"], {
      cwd: path.resolve(target),
      timeout: config.performance.commandTimeoutMs,
      maxBuffer: 1024 * 1024 * 8,
    });
    return parseAudit(stdout, target, config);
  } catch (error) {
    const maybeStdout = typeof error === "object" && error !== null && "stdout" in error ? String(error.stdout) : "";
    return maybeStdout ? parseAudit(maybeStdout, target, config) : [];
  }
}

function parseAudit(stdout: string, target: string, config: ScanConfig): Finding[] {
  const parsed = JSON.parse(stdout) as AuditJson;

  return Object.values(parsed.vulnerabilities ?? {}).map((vulnerability) => {
    const title = vulnerability.title ?? `Vulnerable dependency: ${vulnerability.name}`;
    const findingBase = {
      id: `npm-audit-${vulnerability.name}`,
      title,
      description: `Dependency ${vulnerability.name} has a ${vulnerability.severity} vulnerability in range ${vulnerability.range ?? "unknown"}.`,
      category: "dependency" as const,
      severity: vulnerability.severity,
      confidence: "high" as const,
      source: "npm-audit" as const,
      location: {
        filePath: path.resolve(target, "package.json"),
        startLine: 1,
        startColumn: 1,
        endLine: 1,
        endColumn: 1,
      },
      evidence: summarizeVia(vulnerability.via),
    };

    return {
      ...findingBase,
      fix: {
        kind: "prompt" as const,
        title: "Generate safe dependency upgrade prompt",
        description: "Upgrade or replace the dependency while checking for breaking changes.",
        prompt: buildFixPrompt(findingBase, config.language),
      },
    };
  });
}

function summarizeVia(via: AuditVulnerability["via"]): string {
  if (!via?.length) {
    return "npm audit reported this package as vulnerable.";
  }

  return via
    .map((item) => (typeof item === "string" ? item : item.title ?? item.url ?? "advisory"))
    .join("; ")
    .slice(0, 240);
}
