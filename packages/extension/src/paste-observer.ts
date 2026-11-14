import * as vscode from "vscode";

/** Marks copies made in a VS Code editor so their pastes are not checked. */
export const internalCopyMimeType = "application/vnd.vibinguard.editor-copy";

export const pasteSelector: vscode.DocumentSelector = [
  ...["typescript", "typescriptreact", "javascript", "javascriptreact", "json"].map(
    (language) => ({ scheme: "file", language }),
  ),
  { scheme: "file", pattern: "**/.env*" },
];

export const pasteObserverMetadata: vscode.DocumentPasteProviderMetadata = {
  providedPasteEditKinds: [vscode.DocumentDropOrPasteEditKind.Empty.append("vibinguard")],
  pasteMimeTypes: ["text/plain"],
  copyMimeTypes: [internalCopyMimeType],
};

export interface PasteEvent {
  document: vscode.TextDocument;
  ranges: readonly vscode.Range[];
  text: string;
}

/**
 * Observes pastes without changing them: it returns no edits, so VS Code's
 * normal paste runs unchanged, and hands the pasted text to onPaste.
 */
export function createPasteObserver(
  onPaste: (event: PasteEvent) => void,
): vscode.DocumentPasteEditProvider {
  return {
    prepareDocumentPaste(_document, _ranges, dataTransfer) {
      dataTransfer.set(internalCopyMimeType, new vscode.DataTransferItem("1"));
    },

    async provideDocumentPasteEdits(document, ranges, dataTransfer) {
      if (dataTransfer.get(internalCopyMimeType) !== undefined) {
        return undefined;
      }

      const text = await dataTransfer.get("text/plain")?.asString();
      if (text !== undefined && text.trim().length > 0) {
        // onPaste must not be awaited: the paste waits for this method.
        onPaste({ document, ranges, text });
      }
      return undefined;
    },
  };
}
