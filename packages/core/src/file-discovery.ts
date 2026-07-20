import { readFile } from "node:fs/promises";
import path from "node:path";
import fg from "fast-glob";
import type { ScanConfig, ScanRequest } from "./config.js";
import { detectGitFileStatus, isPrivateDotEnvPath } from "./dotenv.js";
import type { ScanFile } from "./types.js";

const supportedExtensions = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".json",
  ".env",
]);

const defaultIgnoredSegments = new Set([
  "node_modules",
  "dist",
  "build",
  "coverage",
  ".next",
  ".turbo",
  ".git",
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
]);

export async function discoverFiles(
  request: ScanRequest,
  config: ScanConfig,
): Promise<ScanFile[]> {
  const targetPath = path.resolve(request.target);
  const entries =
    request.mode === "file"
      ? [targetPath]
      : await fg(["**/*.{ts,tsx,js,jsx,mjs,cjs,json}", "**/.env*"], {
          absolute: true,
          cwd: targetPath,
          dot: true,
          onlyFiles: true,
        });

  const files: ScanFile[] = [];
  for (const entry of entries.slice(0, config.performance.maxFiles)) {
    const relativePath = path.relative(
      request.mode === "file" ? path.dirname(targetPath) : targetPath,
      entry,
    );

    if (isIgnored(relativePath)) {
      continue;
    }

    if (
      !supportedExtensions.has(path.extname(entry)) &&
      !path.basename(entry).startsWith(".env")
    ) {
      continue;
    }

    const content = await readFile(entry, "utf8");
    const sizeKb = Buffer.byteLength(content, "utf8") / 1024;
    if (sizeKb > config.performance.maxFileSizeKb) {
      continue;
    }

    const gitStatus = isPrivateDotEnvPath(entry)
      ? await detectGitFileStatus(entry, config.performance.commandTimeoutMs)
      : undefined;

    files.push({
      path: entry,
      content,
      language: detectLanguage(entry),
      ...(gitStatus === undefined ? {} : { gitStatus }),
    });
  }

  return files;
}

function isIgnored(relativePath: string): boolean {
  return relativePath
    .split(path.sep)
    .some((segment) => defaultIgnoredSegments.has(segment));
}

function detectLanguage(filePath: string): ScanFile["language"] {
  const extension = path.extname(filePath);
  if (extension === ".ts" || extension === ".tsx") {
    return "typescript";
  }

  if ([".js", ".jsx", ".mjs", ".cjs"].includes(extension)) {
    return "javascript";
  }

  if (extension === ".json") {
    return "json";
  }

  if (path.basename(filePath).startsWith(".env")) {
    return "env";
  }

  return "unknown";
}
