import * as vscode from "vscode";

/**
 * Serves read-only documents for the fix diff from memory. Unlike untitled
 * documents, these are never written to VS Code's hot-exit backups.
 */
export class ProposalDocuments implements vscode.TextDocumentContentProvider {
  static readonly scheme = "vibinguard-proposal";

  private readonly contents = new Map<string, string>();
  private nextId = 0;

  put(
    side: "original" | "proposed",
    fileName: string,
    content: string,
  ): vscode.Uri {
    this.nextId += 1;
    const uri = vscode.Uri.from({
      scheme: ProposalDocuments.scheme,
      path: `/${side}/${this.nextId}/${fileName}`,
    });
    this.contents.set(uri.toString(), content);
    return uri;
  }

  delete(uri: vscode.Uri): void {
    this.contents.delete(uri.toString());
  }

  provideTextDocumentContent(uri: vscode.Uri): string {
    return this.contents.get(uri.toString()) ?? "";
  }
}
