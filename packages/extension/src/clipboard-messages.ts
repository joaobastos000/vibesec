export interface ClipboardResultInput {
  inserted: boolean;
  findingCount: number;
  aiEnabled: boolean;
  aiAvailable: boolean | undefined;
}

export interface ClipboardResultMessage {
  level: "info" | "warning";
  message: string;
}

/**
 * Describes a non-blocked Guard Clipboard Before Paste result. It never says
 * the code was inserted unless it actually was.
 */
export function describeClipboardResult(
  input: ClipboardResultInput,
): ClipboardResultMessage {
  const issues = `${input.findingCount} ${input.findingCount === 1 ? "issue" : "issues"}`;

  if (!input.inserted) {
    return input.findingCount > 0
      ? {
          level: "warning",
          message: `VibinGuard checked the clipboard and found ${issues}. It was not inserted because vibinguard.insertSafeClipboard is off.`,
        }
      : {
          level: "info",
          message:
            "VibinGuard: the clipboard passed security checks. Automatic insertion is off (vibinguard.insertSafeClipboard), so paste it yourself.",
        };
  }

  if (input.findingCount > 0) {
    return {
      level: "warning",
      message: `The code was inserted, but VibinGuard found ${issues} to review.`,
    };
  }

  if (input.aiEnabled && input.aiAvailable === false) {
    return {
      level: "warning",
      message:
        "The code passed deterministic checks and was inserted, but local AI did not respond.",
    };
  }

  return {
    level: "info",
    message:
      input.aiAvailable === true
        ? "VibinGuard: both review layers approved the code and it was inserted."
        : "VibinGuard: the code passed security checks and was inserted.",
  };
}
