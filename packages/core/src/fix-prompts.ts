import type { Finding } from "./types.js";

export function buildFixPrompt(finding: Omit<Finding, "fix">): string {
  return [
    "You are a senior application security engineer.",
    "Refactor the vulnerable code below with a minimal, production-ready security fix.",
    `Issue: ${finding.title}`,
    `Risk: ${finding.description}`,
    `Location: ${finding.location.filePath}:${finding.location.startLine}`,
    `Evidence: ${finding.evidence}`,
    "Requirements:",
    "- Preserve existing behavior and public APIs unless security requires a change.",
    "- Add strict validation, safe defaults, and tests when relevant.",
    "- Explain the security reasoning briefly after the patch.",
  ].join("\n");
}
