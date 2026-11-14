import crypto from "node:crypto";
import type { ScanConfig } from "../config.js";
import { isPrivateDotEnvPath } from "../dotenv.js";
import { buildFixPrompt } from "../fix-prompts.js";
import { splitCallArguments } from "./call-arguments.js";
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
  /** Secrets are expected in private dotenv files, so secret rules skip them. */
  skipPrivateDotEnv?: boolean;
  /** Reports only the first match in a file for broad advisory rules. */
  oncePerFile?: boolean;
  /** Rejects matches that look like placeholders or otherwise safe values. */
  accept?: (match: RegExpMatchArray, content: string) => boolean;
  /** Builds redacted evidence when the default redaction cannot hide the value. */
  evidence?: (match: RegExpMatchArray, content: string) => string;
}

function jwtSignArguments(
  match: RegExpMatchArray,
  content: string,
): string[] | undefined {
  return splitCallArguments(content, (match.index ?? 0) + match[0].length - 1);
}

const placeholderPattern =
  /placeholder|example|changeme|change[_-]?me|replace[_-]?me|your[_-]|<[^>]*>|redacted|dummy|sample|insert[_-]|^(?:x+|\*+|\.+|0+)$/i;

const knownSecretFormats = [
  // OpenAI and Anthropic keys
  String.raw`sk-(?:proj-|svcacct-|admin-|ant-)?[A-Za-z0-9_-]{20,}`,
  // Stripe live secret and restricted keys
  String.raw`(?:sk|rk)_live_[A-Za-z0-9]{16,}`,
  // AWS access key IDs
  String.raw`(?:AKIA|ASIA)[0-9A-Z]{16}`,
  // GitHub tokens
  String.raw`gh[pousr]_[A-Za-z0-9]{30,}`,
  String.raw`github_pat_[A-Za-z0-9_]{22,}`,
  // GitLab, Slack, and Supabase secret keys
  String.raw`glpat-[A-Za-z0-9_-]{20,}`,
  String.raw`xox[baprs]-[A-Za-z0-9-]{10,}`,
  String.raw`sb_secret_[A-Za-z0-9_-]{20,}`,
  // PEM private keys
  String.raw`-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----`,
];

const rules: Rule[] = [
  {
    id: "known-secret-format",
    title: "Provider credential detected",
    description:
      "This value matches the format of a real provider credential. Anyone who sees the code, its history, or a screenshot can use it.",
    category: "secret",
    severity: "critical",
    cwe: "CWE-798",
    owasp: "A02:2021 Cryptographic Failures",
    pattern: new RegExp(
      knownSecretFormats
        .map((source) => String.raw`(?<![A-Za-z0-9_-])${source}`)
        .join("|"),
      "g",
    ),
    advice:
      "Remove the credential from source, load it from a server-side environment variable or secrets manager, and rotate it with the provider.",
    skipPrivateDotEnv: true,
    evidence: (match) => maskSecret(match[0]),
  },
  {
    id: "supabase-service-role-key",
    title: "Supabase service_role key in source",
    description:
      "The service_role key bypasses Row Level Security and gives full database access. It must never ship in application code.",
    category: "secret",
    severity: "critical",
    cwe: "CWE-798",
    owasp: "A01:2021 Broken Access Control",
    pattern:
      /(?<![A-Za-z0-9_-])eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
    advice:
      "Use the anon or publishable key in clients, keep service_role on the server only, and rotate the exposed key in the Supabase dashboard.",
    skipPrivateDotEnv: true,
    // Anon keys are public by design; only the service_role key is a secret.
    accept: (match) => decodeJwtRole(match[0]) === "service_role",
    evidence: (match) => maskSecret(match[0]),
  },
  {
    id: "database-url-password",
    title: "Database connection string with an embedded password",
    description:
      "A connection string with a real password gives direct database access to anyone who can read the code.",
    category: "secret",
    severity: "high",
    cwe: "CWE-798",
    owasp: "A02:2021 Cryptographic Failures",
    pattern:
      /\b(?:postgres(?:ql)?|mysql|mariadb|mongodb(?:\+srv)?|rediss?|amqps?|mssql):\/\/([^\s:@/"'`]+):([^\s@/"'`]+)@/gi,
    advice:
      "Load the full connection string from a server-side environment variable and rotate the database password.",
    skipPrivateDotEnv: true,
    accept: (match) => {
      const password = match[2] ?? "";
      return (
        password.length >= 3 &&
        !password.includes("${") &&
        !placeholderPattern.test(password) &&
        !/^(?:pass(?:word)?|postgres|root|admin|secret|user|mysql|redis|guest)$/i.test(
          password,
        )
      );
    },
    evidence: (match) =>
      `${match[0].split("://")[0]}://${match[1]}:[REDACTED]@`,
  },
  {
    id: "hardcoded-secret",
    title: "Hardcoded secret detected",
    description:
      "Secrets in source code can leak through git history, logs, screenshots, and AI prompts.",
    category: "secret",
    severity: "critical",
    cwe: "CWE-798",
    owasp: "A02:2021 Cryptographic Failures",
    // The keyword may appear anywhere in the name, so OPENAI_API_KEY and
    // stripeSecretKey match as well as apiKey.
    pattern:
      /(?<![A-Za-z0-9_$])["'`]?([A-Za-z0-9_$-]*?(?:api[_-]?key|secret|token|passw(?:or)?d|pwd|private[_-]?key|access[_-]?key|auth[_-]?key)[A-Za-z0-9_$-]*)["'`]?\s*[:=]\s*["'`]([^"'`\s]{8,})["'`]/gi,
    advice:
      "Move the value to a secrets manager or environment variable and rotate the exposed credential.",
    skipPrivateDotEnv: true,
    accept: (match) => looksLikeSecretValue(match[1] ?? "", match[2] ?? ""),
  },
  {
    id: "client-side-secret",
    title: "Potential client-side secret exposure",
    description:
      "Public frontend environment variables are bundled into client code and must not contain secrets.",
    category: "secret",
    severity: "high",
    cwe: "CWE-200",
    owasp: "A01:2021 Broken Access Control",
    pattern:
      /\b(?:NEXT_PUBLIC|VITE|PUBLIC)_[A-Z0-9_]*(?:SECRET|TOKEN|KEY|PASSWORD)[A-Z0-9_]*\b/gi,
    advice:
      "Keep secrets server-side and expose only short-lived, scoped public values when absolutely necessary.",
  },
  {
    id: "jwt-without-expiry",
    title: "JWT signed without explicit expiration",
    description:
      "Long-lived tokens are common in AI-generated auth code and increase account takeover blast radius.",
    category: "auth",
    severity: "high",
    cwe: "CWE-613",
    owasp: "A07:2021 Identification and Authentication Failures",
    pattern: /\bjwt\.sign\s*\(/g,
    advice:
      "Set a short expiresIn value, validate issuer/audience, and use refresh-token rotation if needed.",
    accept: (match, content) => {
      const args = jwtSignArguments(match, content);
      if (args === undefined || /\bexp\s*:/.test(args[0] ?? "")) {
        return false;
      }
      if (args.length === 2) {
        return true;
      }
      // Options held in a variable are unknown, so only literals are judged.
      const options = args[2] ?? "";
      return options.startsWith("{") && !/\bexpiresIn\b/.test(options);
    },
    // The signing secret is often a string literal, so every string argument
    // is redacted before it can reach logs or fix prompts.
    evidence: (match, content) =>
      compactEvidence(
        `jwt.sign(${(jwtSignArguments(match, content) ?? [])
          .map((argument) =>
            argument.replace(
              /(["'`])(?:\\.|(?!\1)[^\\])*\1/g,
              '"...[REDACTED]"',
            ),
          )
          .join(", ")})`,
      ),
  },
  {
    id: "sql-string-concat",
    title: "SQL query built with string interpolation",
    description:
      "String-built SQL can allow injection when user-controlled values reach the query.",
    category: "injection",
    severity: "critical",
    cwe: "CWE-89",
    owasp: "A03:2021 Injection",
    pattern:
      /\b(?:query|execute|raw)\s*\(\s*(?:`[^`]*\$\{[^}]+}[^`]*`|["'][^"']*["']\s*\+)/gi,
    advice:
      "Use parameterized queries or a query builder that binds values separately from SQL text.",
  },
  {
    id: "xss-dangerous-html",
    title: "Unsafe HTML injection sink",
    description:
      "Rendering raw HTML from generated code can introduce stored or reflected XSS.",
    category: "xss",
    severity: "high",
    cwe: "CWE-79",
    owasp: "A03:2021 Injection",
    pattern: /dangerouslySetInnerHTML\s*=\s*\{\s*\{\s*__html\s*:/gi,
    advice:
      "Avoid raw HTML. If required, sanitize with a trusted allowlist sanitizer before rendering.",
  },
  {
    id: "missing-zod-validation",
    title: "Request body used without nearby schema validation",
    description:
      "AI-generated handlers often trust req.body directly, leading to injection and authorization bugs.",
    category: "validation",
    severity: "medium",
    cwe: "CWE-20",
    owasp: "A04:2021 Insecure Design",
    pattern: /\b(?:req|request)\.body\b/gi,
    advice:
      "Validate request data with Zod or an equivalent schema before using it.",
    oncePerFile: true,
    accept: (match, content) => {
      const index = match.index ?? 0;
      const window = content.slice(Math.max(0, index - 600), index + 1500);
      return !/z\.object|safeParse|\.parse\s*\(|\bvalidat|\bjoi\b|\byup\b|\bajv\b|celebrate|zValidator|plainToInstance/i.test(
        window,
      );
    },
  },
  {
    id: "prompt-injection-unsafe-concat",
    title: "Untrusted input concatenated into an LLM prompt",
    description:
      "Direct prompt concatenation can let users override instructions or exfiltrate sensitive context.",
    category: "prompt-injection",
    severity: "medium",
    cwe: "CWE-1427",
    owasp: "LLM01:2025 Prompt Injection",
    // Flags prompts built from request or user input, not every template string.
    pattern:
      /\b(?:prompt|systemPrompt|userPrompt|instructions?)\b\s*(?:\+=|=)\s*[^;\n]*?(?:\$\{\s*(?:req|request|body|query|params|input|userInput|userMessage|message|searchParams|formData)\b|\+\s*(?:req|request|body|query|params|input|userInput|userMessage|message)\b)/gi,
    advice:
      "Separate instructions from data, delimit untrusted content, and validate tool/function outputs.",
  },
  {
    id: "insecure-cors",
    title: "Permissive CORS configuration",
    description:
      "Wildcard CORS with credentials or broad APIs can expose authenticated data cross-origin.",
    category: "configuration",
    severity: "medium",
    cwe: "CWE-942",
    owasp: "A05:2021 Security Misconfiguration",
    pattern:
      /\bcors\s*\(\s*\{[\s\S]{0,240}origin\s*:\s*["'`]\*["'`][\s\S]{0,240}\}\s*\)/gi,
    advice:
      "Restrict CORS origins by environment and avoid credentials with wildcard origins.",
  },
];

/** Rules that identify a credential more precisely than hardcoded-secret. */
const specificSecretRules = new Set([
  "known-secret-format",
  "supabase-service-role-key",
  "database-url-password",
]);

export function runBuiltInRules(
  files: ScanFile[],
  _config: ScanConfig,
): Finding[] {
  const findings: Finding[] = [];

  for (const file of files) {
    const privateDotEnv = isPrivateDotEnvPath(file.path);
    if (privateDotEnv) {
      const exposureFinding = createDotEnvExposureFinding(file);
      if (exposureFinding !== undefined) {
        findings.push(exposureFinding);
      }
    }

    const fileFindings: Finding[] = [];
    for (const rule of rules) {
      if (rule.skipPrivateDotEnv === true && privateDotEnv) {
        continue;
      }

      for (const match of file.content.matchAll(rule.pattern)) {
        if (rule.accept !== undefined && !rule.accept(match, file.content)) {
          continue;
        }

        const matchIndex = match.index ?? 0;
        const location = locate(
          file.content,
          matchIndex,
          match[0].length,
          file.path,
        );
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
          evidence:
            rule.evidence === undefined
              ? compactEvidence(match[0])
              : rule.evidence(match, file.content),
        };

        fileFindings.push({
          ...findingBase,
          fix: {
            kind: "prompt",
            title: "Generate secure refactor prompt",
            description: rule.advice,
            prompt: buildFixPrompt(findingBase),
          },
        });

        if (rule.oncePerFile === true) {
          break;
        }
      }
    }

    findings.push(...dropRedundantSecretFindings(fileFindings));
  }

  return findings;
}

/** Keeps one finding per credential when a precise rule already covers the line. */
function dropRedundantSecretFindings(findings: Finding[]): Finding[] {
  const specificLines = new Set(
    findings
      .filter((finding) => specificSecretRules.has(ruleIdOf(finding)))
      .map((finding) => finding.location.startLine),
  );
  return findings.filter(
    (finding) =>
      ruleIdOf(finding) !== "hardcoded-secret" ||
      !specificLines.has(finding.location.startLine),
  );
}

export function ruleIdOf(finding: Pick<Finding, "id">): string {
  return finding.id.replace(/-[0-9a-f]{10}$/, "");
}

function looksLikeSecretValue(name: string, value: string): boolean {
  if (
    value.includes("${") ||
    placeholderPattern.test(value) ||
    /^(?:https?:)?\/\//i.test(value) ||
    /^\.{0,2}\//.test(value) ||
    // An environment variable name, not its value.
    /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+$/.test(value)
  ) {
    return false;
  }

  if (/passw(?:or)?d|pwd/i.test(name)) {
    return value.length >= 8;
  }

  // Real keys and tokens mix letters and digits; labels such as
  // "Authorization_Header_Name" do not.
  return value.length >= 12 && /[0-9]/.test(value) && /[A-Za-z]/.test(value);
}

function maskSecret(value: string): string {
  if (value.startsWith("-----BEGIN")) {
    return `${value} [REDACTED]`;
  }
  return `${value.slice(0, Math.min(6, Math.floor(value.length / 4)))}...[REDACTED]`;
}

function decodeJwtRole(token: string): string | undefined {
  try {
    const payload = token.split(".")[1] ?? "";
    const decoded = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    ) as { role?: unknown };
    return typeof decoded.role === "string" ? decoded.role : undefined;
  } catch {
    return undefined;
  }
}

function stableId(
  ruleId: string,
  filePath: string,
  line: number,
  evidence: string,
): string {
  const hash = crypto
    .createHash("sha256")
    .update(`${ruleId}:${filePath}:${line}:${evidence}`)
    .digest("hex")
    .slice(0, 10);
  return `${ruleId}-${hash}`;
}

function locate(
  content: string,
  index: number,
  length: number,
  filePath: string,
) {
  const before = content.slice(0, index);
  const startLine = before.split("\n").length;
  const lastLineBreak = before.lastIndexOf("\n");
  const startColumn = index - lastLineBreak;
  const snippet = content.slice(index, index + length);
  const endLine = startLine + snippet.split("\n").length - 1;
  const endColumn =
    endLine === startLine
      ? startColumn + length
      : (snippet.split("\n").at(-1)?.length ?? 1);

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
  return compacted.replace(
    /([:=]\s*["'`])([^"'`]{4})[^"'`]*?(["'`])/g,
    "$1$2...[REDACTED]$3",
  );
}

function createDotEnvExposureFinding(file: ScanFile): Finding | undefined {
  if (file.gitStatus !== "tracked" && file.gitStatus !== "untracked") {
    return undefined;
  }

  const tracked = file.gitStatus === "tracked";
  const findingBase = {
    id: stableId("dotenv-exposure", file.path, 1, file.gitStatus),
    title: tracked
      ? "Private dotenv file is tracked by Git"
      : "Private dotenv file is not ignored by Git",
    description: tracked
      ? "Secrets are expected in this file, but Git is already tracking it and may expose its contents through commits and history."
      : "Secrets are expected in this file, but it can be added to Git accidentally because no ignore rule protects it.",
    category: "secret" as const,
    severity: tracked ? ("high" as const) : ("medium" as const),
    confidence: "high" as const,
    source: "vibinguard-static" as const,
    location: {
      filePath: file.path,
      startLine: 1,
      startColumn: 1,
      endLine: 1,
      endColumn: 2,
    },
    cwe: "CWE-200",
    owasp: "A02:2021 Cryptographic Failures",
    evidence: `Git status: ${file.gitStatus}; dotenv contents omitted`,
  };
  const advice = tracked
    ? "Remove the file from Git tracking, add it to .gitignore, purge exposed values from history when necessary, and rotate any real credentials."
    : "Add this dotenv file to .gitignore before storing real credentials.";

  return {
    ...findingBase,
    fix: {
      kind: "advice",
      title: tracked
        ? "Stop tracking this dotenv file"
        : "Ignore this dotenv file",
      description: advice,
      prompt: buildFixPrompt(findingBase),
    },
  };
}
