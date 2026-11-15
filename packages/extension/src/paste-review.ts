import * as vscode from "vscode";

/**
 * Starts watching for the paste right away, but runs the review on a later
 * task. VS Code waits for paste providers before applying the paste, so any
 * synchronous scanning here would delay the paste itself.
 */
export function startPasteReview(
  document: vscode.TextDocument,
  timeoutMs: number,
  review: (landed: Promise<boolean>) => Promise<void>,
): void {
  const landed = waitForDocumentChange(document, timeoutMs);
  setTimeout(() => void review(landed), 0);
}

/** Resolves true when the document changes, or false after timeoutMs. */
export function waitForDocumentChange(
  document: vscode.TextDocument,
  timeoutMs: number,
): Promise<boolean> {
  return new Promise((resolve) => {
    const subscription = vscode.workspace.onDidChangeTextDocument((event) => {
      if (event.document === document && event.contentChanges.length > 0) {
        clearTimeout(timer);
        subscription.dispose();
        resolve(true);
      }
    });
    const timer = setTimeout(() => {
      subscription.dispose();
      resolve(false);
    }, timeoutMs);
  });
}
