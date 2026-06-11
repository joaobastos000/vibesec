import type { Finding, SecurityScore, Severity } from "./types.js";

const severityWeights: Record<Severity, number> = {
  critical: 30,
  high: 18,
  medium: 9,
  low: 4,
  info: 1,
};

export function calculateScore(findings: Finding[]): SecurityScore {
  const penalty = findings.reduce((total, finding) => total + severityWeights[finding.severity], 0);
  const value = Math.max(0, Math.min(100, 100 - penalty));

  if (value >= 90) {
    return { value, label: "excellent" };
  }

  if (value >= 75) {
    return { value, label: "good" };
  }

  if (value >= 55) {
    return { value, label: "needs-work" };
  }

  if (value >= 30) {
    return { value, label: "risky" };
  }

  return { value, label: "dangerous" };
}

export function emptySeverityCounts(): Record<Severity, number> {
  return {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    info: 0,
  };
}

