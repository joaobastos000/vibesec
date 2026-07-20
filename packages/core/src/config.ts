import { z } from "zod";
import type { GitFileStatus } from "./types.js";

const gitFileStatuses = [
  "ignored",
  "tracked",
  "untracked",
  "unavailable",
] as const satisfies readonly GitFileStatus[];

export const aiProviderSchema = z.enum([
  "disabled",
  "local",
  "openai",
  "anthropic",
]);
export type AiProvider = z.infer<typeof aiProviderSchema>;

export const scanConfigSchema = z.object({
  ai: z
    .object({
      provider: aiProviderSchema.default("disabled"),
      model: z.string().min(1).optional(),
      baseUrl: z.string().url().optional(),
      enableRag: z.boolean().default(false),
      timeoutMs: z.number().int().positive().max(60000).default(12000),
      maxInputChars: z.number().int().positive().max(60000).default(18000),
    })
    .default({
      provider: "disabled",
      enableRag: false,
      timeoutMs: 12000,
      maxInputChars: 18000,
    }),
  staticAnalysis: z
    .object({
      enableBuiltInRules: z.boolean().default(true),
      enableSemgrep: z.boolean().default(true),
      enableNpmAudit: z.boolean().default(true),
    })
    .default({
      enableBuiltInRules: true,
      enableSemgrep: true,
      enableNpmAudit: true,
    }),
  performance: z
    .object({
      maxFileSizeKb: z.number().int().positive().max(1024).default(256),
      maxFiles: z.number().int().positive().max(5000).default(800),
      commandTimeoutMs: z.number().int().positive().max(120000).default(30000),
    })
    .default({
      maxFileSizeKb: 256,
      maxFiles: 800,
      commandTimeoutMs: 30000,
    }),
});

export type ScanConfig = z.infer<typeof scanConfigSchema>;
export type ScanConfigInput = z.input<typeof scanConfigSchema>;

export const scanRequestSchema = z.object({
  target: z.string().min(1),
  mode: z.enum(["file", "project"]).default("project"),
});

export type ScanRequest = z.infer<typeof scanRequestSchema>;

export const generatedContentGuardRequestSchema = z.object({
  content: z.string().min(1),
  filePath: z.string().min(1).optional(),
  language: z
    .enum(["typescript", "javascript", "json", "env", "unknown"])
    .default("unknown"),
  gitStatus: z.enum(gitFileStatuses).optional(),
});

export type GeneratedContentGuardRequest = z.infer<
  typeof generatedContentGuardRequestSchema
>;

export function resolveConfig(input: ScanConfigInput = {}): ScanConfig {
  return scanConfigSchema.parse(input);
}
