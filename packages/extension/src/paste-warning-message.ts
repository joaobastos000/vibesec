import type { Finding } from "@vibinguard/core";
import { friendlyFinding, friendlyRecommendation } from "./friendly-findings.js";

export interface PasteWarning {
  level: "error" | "warning";
  message: string;
}

const listedTitles = 3;

/**
 * Builds the message shown after a paste. Findings must carry editor line
 * numbers. Low and info findings only get diagnostics, so they produce no
 * message on their own.
 */
export function formatPasteWarning(findings: Finding[]): PasteWarning | undefined {
  const relevant = findings.filter(
    (finding) => finding.severity !== "low" && finding.severity !== "info",
  );
  const first = relevant[0];
  if (first === undefined) {
    return undefined;
  }

  const level = relevant.some(
    (finding) => finding.severity === "critical" || finding.severity === "high",
  )
    ? "error"
    : "warning";

  if (relevant.length === 1) {
    return {
      level,
      message: `VibinGuard found a problem in the pasted code (line ${first.location.startLine}): ${friendlyFinding(first).title}. ${friendlyRecommendation(first)}`,
    };
  }

  const titles = relevant
    .slice(0, listedTitles)
    .map(
      (finding) =>
        `${friendlyFinding(finding).title} (line ${finding.location.startLine})`,
    )
    .join("; ");
  const remaining = relevant.length - listedTitles;
  return {
    level,
    message: `VibinGuard found ${relevant.length} problems in the pasted code: ${titles}${remaining > 0 ? ` and ${remaining} more` : ""}.`,
  };
}
