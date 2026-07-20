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

export type FindingSource =
  | "vibinguard-static"
  | "generation-guard"
  | "semgrep"
  | "npm-audit"
  | "llm";

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

export interface AiAnalysisSummary {
  provider: "disabled" | "local" | "openai" | "anthropic";
  enabled: boolean;
  attempted: boolean;
  available?: boolean;
  model?: string;
  findings: number;
  filesAnalyzed: number;
  durationMs: number;
  message: string;
}

export interface ScanResult {
  target: string;
  generatedAt: string;
  score: SecurityScore;
  summary: ScanSummary;
  ai: AiAnalysisSummary;
  findings: Finding[];
}

export interface GeneratedContentGuardResult {
  target: string;
  generatedAt: string;
  blocked: boolean;
  reason: string;
  score: SecurityScore;
  summary: Omit<ScanSummary, "filesScanned">;
  ai: AiAnalysisSummary;
  findings: Finding[];
}

export interface GeneratedContentFixRequest {
  content: string;
  filePath?: string;
  language: ScanFile["language"];
  finding: Finding;
}

export type GeneratedContentFixResult =
  | {
      available: false;
      ai: AiAnalysisSummary;
    }
  | {
      available: true;
      replacement: string;
      explanation: string;
      review: GeneratedContentGuardResult;
      ai: AiAnalysisSummary;
    };
