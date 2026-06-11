export type Severity = "critical" | "high" | "medium" | "low" | "info";

export type FindingCategory =
  | "secret"
  | "auth"
  | "injection"
  | "xss"
  | "validation"
  | "dependency"
  | "prompt-injection"
  | "configuration"
  | "transport"
  | "other";

export type FindingSource = "vibeguard-static" | "semgrep" | "npm-audit" | "llm";

export interface FindingLocation {
  filePath: string;
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
}

export interface Fix {
  kind: "prompt" | "patch" | "advice";
  title: string;
  prompt?: string;
  patch?: string;
  description: string;
}

export interface Finding {
  id: string;
  title: string;
  description: string;
  category: FindingCategory;
  severity: Severity;
  confidence: "low" | "medium" | "high";
  source: FindingSource;
  location: FindingLocation;
  cwe?: string | undefined;
  owasp?: string | undefined;
  evidence: string;
  fix: Fix;
}

export interface ScanFile {
  path: string;
  content: string;
  language: "typescript" | "javascript" | "json" | "env" | "unknown";
}

export interface SecurityScore {
  value: number;
  label: "excellent" | "good" | "needs-work" | "risky" | "dangerous";
}

export interface ScanSummary {
  filesScanned: number;
  findings: number;
  bySeverity: Record<Severity, number>;
  durationMs: number;
}

export interface ScanResult {
  target: string;
  generatedAt: string;
  score: SecurityScore;
  summary: ScanSummary;
  findings: Finding[];
}
