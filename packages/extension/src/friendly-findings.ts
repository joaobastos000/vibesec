import type { Finding } from "@vibinguard/core";

export function friendlyFinding(finding: Finding | undefined): {
  level: string;
  title: string;
  explanation: string;
} {
  if (finding === undefined) {
    return {
      level: "Paste blocked",
      title: "an important security risk must be fixed",
      explanation:
        "The code was not inserted to prevent exposure or unauthorized access.",
    };
  }

  if (finding.id.startsWith("dotenv-exposure-")) {
    return {
      level: finding.severity === "high" ? "Fix required" : "Needs attention",
      title: finding.title,
      explanation: finding.description,
    };
  }

  const level =
    finding.severity === "critical" || finding.severity === "high"
      ? "Fix required"
      : finding.severity === "medium"
        ? "Needs attention"
        : "Improvement suggestion";
  const byCategory: Record<
    Finding["category"],
    { title: string; explanation: string }
  > = {
    secret: {
      title: "A key, password, or token may be exposed",
      explanation:
        "This data can leak through commits, history, logs, or screenshots.",
    },
    auth: {
      title: "Someone may access data they should not",
      explanation:
        "Identity or permission checks appear insufficient in this path.",
    },
    injection: {
      title: "Input may alter a command",
      explanation:
        "External data may change a query or instruction and execute unexpected behavior.",
    },
    xss: {
      title: "External content may execute in the browser",
      explanation:
        "An attacker may turn displayed data into executable code on the page.",
    },
    validation: {
      title: "Input is accepted without enough validation",
      explanation:
        "Unexpected values may reach sensitive parts of the application.",
    },
    dependency: {
      title: "A project dependency has a known risk",
      explanation:
        "The installed version may contain a published security vulnerability.",
    },
    "prompt-injection": {
      title: "A user may influence AI instructions",
      explanation:
        "Untrusted text may redirect the model or expose context that should remain private.",
    },
    configuration: {
      title: "A configuration is too permissive",
      explanation:
        "The system may allow more origins, access, or behavior than necessary.",
    },
    transport: {
      title: "Data may travel without enough protection",
      explanation:
        "Sensitive information may be observed or changed while in transit.",
    },
    other: {
      title:
        finding.source === "llm"
          ? finding.title
          : "Potentially unsafe behavior needs review",
      explanation:
        finding.source === "llm"
          ? finding.description
          : "This code may create a security risk outside common rule patterns.",
    },
  };

  const friendly = byCategory[finding.category];
  return {
    level,
    title:
      finding.source === "llm" && finding.category !== "other"
        ? `${friendly.title}: ${finding.title}`
        : friendly.title,
    explanation:
      finding.source === "llm" ? finding.description : friendly.explanation,
  };
}

export function friendlyRecommendation(finding: Finding): string {
  if (finding.source === "llm" || finding.id.startsWith("dotenv-exposure-")) {
    return finding.fix.description;
  }

  const recommendations: Record<Finding["category"], string> = {
    secret:
      "Remove the value from source code, use a protected environment variable, and rotate the credential if it was already used.",
    auth: "Require authentication and verify the correct permission before reading or changing data.",
    injection:
      "Keep external data separate from commands by using parameters or a safe API.",
    xss: "Avoid raw HTML or sanitize content with an allowlist-based sanitizer.",
    validation:
      "Validate format, size, and allowed values before using the input.",
    dependency: "Upgrade to a fixed version and run the project test suite.",
    "prompt-injection":
      "Separate instructions from external data and limit the available context and tools.",
    configuration:
      "Allow only the origins, access, and options that are actually required.",
    transport:
      "Use an encrypted channel and validate the connection destination correctly.",
    other:
      "Review the flow and apply the smallest change that removes the risk.",
  };
  return recommendations[finding.category];
}

export function formatCount(value: number, singular: string, plural: string): string {
  return `${value} ${value === 1 ? singular : plural}`;
}
