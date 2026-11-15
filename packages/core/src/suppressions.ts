import { ruleIdOf } from "./analyzers/static-rules.js";
import type { Finding, ScanFile } from "./types.js";

// Matches "// vibinguard-ignore", "# vibinguard-ignore-next-line hardcoded-secret",
// or "/* vibinguard-ignore rule-a, rule-b */".
const directivePattern =
  /(?:\/\/|#|\/\*|<!--)\s*vibinguard-ignore(-next-line)?(?:[ \t]+([a-z0-9-]+(?:[ \t]*,[ \t]*[a-z0-9-]+)*))?/i;

/**
 * Removes findings the developer explicitly accepted with an inline comment.
 *
 * A directive on the same line or on the line above (with -next-line) applies
 * to every rule, or only to the comma-separated rule ids that follow it.
 * Only file and project scans honor directives: generated content cannot
 * silence the guard by including its own comment.
 */
export function applySuppressions(
  findings: Finding[],
  files: ScanFile[],
): Finding[] {
  const linesByPath = new Map<string, string[]>();
  for (const file of files) {
    linesByPath.set(normalizePath(file.path), file.content.split(/\r?\n/));
  }

  return findings.filter((finding) => {
    const lines = linesByPath.get(normalizePath(finding.location.filePath));
    if (lines === undefined) {
      return true;
    }

    const line = finding.location.startLine;
    return !(
      suppresses(lines[line - 1], false, finding) ||
      suppresses(lines[line - 2], true, finding)
    );
  });
}

function suppresses(
  line: string | undefined,
  previousLine: boolean,
  finding: Finding,
): boolean {
  if (line === undefined) {
    return false;
  }

  const directive = directivePattern.exec(line);
  if (directive === null || (directive[1] !== undefined) !== previousLine) {
    return false;
  }

  const ruleIds = directive[2];
  if (ruleIds === undefined) {
    return true;
  }

  const findingRule = ruleIdOf(finding);
  return ruleIds
    .split(",")
    .map((ruleId) => ruleId.trim().toLowerCase())
    .includes(findingRule);
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, "/").toLowerCase();
}
