import crypto from "node:crypto";
import type { ScanConfig } from "../config.js";
import { buildFixPrompt } from "../fix-prompts.js";
import type { Finding, FindingCategory, ScanFile, Severity } from "../types.js";

interface Rule {
  id: string;
  title: string;
  description: string;
  category: FindingCategory;
  severity: Severity;
  cwe?: string;
  owasp?: string;
  pattern: RegExp;
  advice: string;
}

const rules: Rule[] = [
  {
    id: "hardcoded-secret",
    title: "Hardcoded secret detected",
    description: "Secrets in source code can leak through git history, logs, screenshots, and AI prompts.",
    category: "secret",
    severity: "critical",
    cwe: "CWE-798",
    owasp: "A02:2021 Cryptographic Failures",
    pattern:
      /\b(?:api[_-]?key|secret|token|password|private[_-]?key)\b\s*[:=]\s*["'`](?!process\.env|import\.meta\.env)[A-Za-z0-9_./+=-]{12,}["'`]/gi,
    advice: "Move the value to a secrets manager or environment variable and rotate the exposed credential.",
  },
  {
    id: "client-side-secret",
    title: "Potential client-side secret exposure",
    description: "Public frontend environment variables are bundled into client code and must not contain secrets.",
    category: "secret",
    severity: "high",
    cwe: "CWE-200",
    owasp: "A01:2021 Broken Access Control",
    pattern: /\b(?:NEXT_PUBLIC|VITE|PUBLIC)_[A-Z0-9_]*(?:SECRET|TOKEN|KEY|PASSWORD)[A-Z0-9_]*\b/gi,
    advice: "Keep secrets server-side and expose only short-lived, scoped public values when absolutely necessary.",
  },
  {
    id: "jwt-without-expiry",
    title: "JWT signed without explicit expiration",
    description: "Long-lived tokens are common in AI-generated auth code and increase account takeover blast radius.",
    category: "auth",
    severity: "high",
    cwe: "CWE-613",
    owasp: "A07:2021 Identification and Authentication Failures",
    pattern: /jwt\.sign\s*\(\s*[^,]+,\s*[^,]+(?:,\s*\{\s*\})?\s*\)/gi,
    advice: "Set a short expiresIn value, validate issuer/audience, and use refresh-token rotation if needed.",
  },
  {
    id: "sql-string-concat",
    title: "SQL query built with string interpolation",
    description: "String-built SQL can allow injection when user-controlled values reach the query.",
    category: "injection",
    severity: "critical",
    cwe: "CWE-89",
    owasp: "A03:2021 Injection",
    pattern: /\b(?:query|execute|raw)\s*\(\s*(?:`[^`]*\$\{[^}]+}[^`]*`|["'][^"']*["']\s*\+)/gi,
    advice: "Use parameterized queries or a query builder that binds values separately from SQL text.",
  },
  {
    id: "xss-dangerous-html",
    title: "Unsafe HTML injection sink",
    description: "Rendering raw HTML from generated code can introduce stored or reflected XSS.",
    category: "xss",
    severity: "high",
    cwe: "CWE-79",
    owasp: "A03:2021 Injection",
    pattern: /dangerouslySetInnerHTML\s*=\s*\{\s*\{\s*__html\s*:/gi,
    advice: "Avoid raw HTML. If required, sanitize with a trusted allowlist sanitizer before rendering.",
  },
  {
    id: "missing-zod-validation",
    title: "Request body used without nearby schema validation",
    description: "AI-generated handlers often trust req.body directly, leading to injection and authorization bugs.",
    category: "validation",
    severity: "medium",
    cwe: "CWE-20",
    owasp: "A04:2021 Insecure Design",
    pattern: /\b(?:req|request)\.body\b(?![\s\S]{0,240}\b(?:z\.object|safeParse|parse)\b)/gi,
    advice: "Validate request data with Zod or an equivalent schema before using it.",
  },
  {
    id: "prompt-injection-unsafe-concat",
    title: "Untrusted input concatenated into an LLM prompt",
    description: "Direct prompt concatenation can let users override instructions or exfiltrate sensitive context.",
    category: "prompt-injection",
    severity: "medium",
    cwe: "CWE-1427",
    owasp: "LLM01:2025 Prompt Injection",
    pattern: /\b(?:prompt|messages|systemPrompt|userPrompt)\b\s*(?:\+=|=\s*[^;\n]*(?:\+|`[^`]*\$\{))/gi,
    advice: "Separate instructions from data, delimit untrusted content, and validate tool/function outputs.",
  },
  {
    id: "insecure-cors",
    title: "Permissive CORS configuration",
    description: "Wildcard CORS with credentials or broad APIs can expose authenticated data cross-origin.",
    category: "configuration",
    severity: "medium",
    cwe: "CWE-942",
    owasp: "A05:2021 Security Misconfiguration",
    pattern: /\bcors\s*\(\s*\{[\s\S]{0,240}origin\s*:\s*["'`]\*["'`][\s\S]{0,240}\}\s*\)/gi,
    advice: "Restrict CORS origins by environment and avoid credentials with wildcard origins.",
  },
];

export function runBuiltInRules(files: ScanFile[], config: ScanConfig): Finding[] {
  const findings: Finding[] = [];

  for (const file of files) {
    for (const rule of rules) {
      for (const match of file.content.matchAll(rule.pattern)) {
        const matchIndex = match.index ?? 0;
        const location = locate(file.content, matchIndex, match[0].length, file.path);
        const findingBase = {
          id: stableId(rule.id, file.path, location.startLine, match[0]),
          title: rule.title,
          description: rule.description,
          category: rule.category,
          severity: rule.severity,
          confidence: "high" as const,
          source: "vibinguard-static" as const,
          location,
          cwe: rule.cwe,
          owasp: rule.owasp,
          evidence: compactEvidence(match[0]),
        };

        findings.push({
          ...findingBase,
          fix: {
            kind: "prompt",
            title: "Generate secure refactor prompt",
            description: rule.advice,
            prompt: buildFixPrompt(findingBase, config.language),
          },
        });
      }
    }
  }

  return findings;
}

function stableId(ruleId: string, filePath: string, line: number, evidence: string): string {
  const hash = crypto.createHash("sha256").update(`${ruleId}:${filePath}:${line}:${evidence}`).digest("hex").slice(0, 10);
  return `${ruleId}-${hash}`;
}

function locate(content: string, index: number, length: number, filePath: string) {
  const before = content.slice(0, index);
  const startLine = before.split("\n").length;
  const lastLineBreak = before.lastIndexOf("\n");
  const startColumn = index - lastLineBreak;
  const snippet = content.slice(index, index + length);
  const endLine = startLine + snippet.split("\n").length - 1;
  const endColumn = endLine === startLine ? startColumn + length : snippet.split("\n").at(-1)?.length ?? 1;

  return {
    filePath,
    startLine,
    startColumn,
    endLine,
    endColumn,
  };
}

function compactEvidence(value: string): string {
  const compacted = value.replace(/\s+/g, " ").slice(0, 180);
  return compacted.replace(/([:=]\s*["'`])([^"'`]{4})[^"'`]*?(["'`])/g, "$1$2...[REDACTED]$3");
}

