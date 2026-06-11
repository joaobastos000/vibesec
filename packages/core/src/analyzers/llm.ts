import type { ScanConfig } from "../config.js";
import type { Finding, ScanFile } from "../types.js";

export interface LlmAnalyzer {
  analyze(files: ScanFile[], findings: Finding[]): Promise<Finding[]>;
}

export function createLlmAnalyzer(config: ScanConfig): LlmAnalyzer {
  if (config.ai.provider === "disabled") {
    return new DisabledLlmAnalyzer();
  }

  return new LocalPlaceholderAnalyzer();
}

class DisabledLlmAnalyzer implements LlmAnalyzer {
  async analyze(): Promise<Finding[]> {
    return [];
  }
}

class LocalPlaceholderAnalyzer implements LlmAnalyzer {
  async analyze(_files: ScanFile[], _findings: Finding[]): Promise<Finding[]> {
    // The provider boundary is ready for LangChain.js/Ollama/OpenAI in the backend milestone.
    return [];
  }
}

