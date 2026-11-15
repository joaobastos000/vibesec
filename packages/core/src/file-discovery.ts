import { readFile } from "node:fs/promises";
import path from "node:path";
import fg from "fast-glob";
// "ignore" is CommonJS; under NodeNext its factory is reached through .default.
import ignoreModule, { type Ignore } from "ignore";
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
): Promise<{ files: ScanFile[]; limitReached: boolean }> {
  const targetPath = path.resolve(request.target);
  const entries =
    request.mode === "file"
      ? [targetPath]
      : await fg(["**/*.{ts,tsx,js,jsx,mjs,cjs,json}", "**/.env*"], {
          absolute: true,
          cwd: targetPath,
          dot: true,
          onlyFiles: true,
          // Excluding these during traversal keeps node_modules from filling
          // the maxFiles budget before any project source is reached.
          ignore: [...defaultIgnoredSegments].flatMap((segment) => [
            `**/${segment}/**`,
            `**/${segment}`,
          ]),
        });

  const gitignore =
    request.mode === "project" ? await loadGitignore(targetPath) : undefined;
  const candidates = entries.filter((entry) => {
    const relativePath = path.relative(
      request.mode === "file" ? path.dirname(targetPath) : targetPath,
      entry,
    );
    return (
      !isIgnored(relativePath) &&
      // A private .env stays in scope even when ignored: one that was
      // committed before being ignored must still produce its Git finding.
      (isPrivateDotEnvPath(entry) ||
        gitignore?.ignores(relativePath.split(path.sep).join("/")) !== true) &&
      (supportedExtensions.has(path.extname(entry)) ||
        path.basename(entry).startsWith(".env"))
    );
  });

  const files: ScanFile[] = [];
  for (const entry of candidates.slice(0, config.performance.maxFiles)) {
    const content = await readFile(entry, "utf8");
    const sizeKb = Buffer.byteLength(content, "utf8") / 1024;
    if (sizeKb > config.performance.maxFileSizeKb) {
      continue;
    }

    const gitStatus =
      config.git.enabled && isPrivateDotEnvPath(entry)
      ? await detectGitFileStatus(entry, config.performance.commandTimeoutMs)
      : undefined;

    files.push({
      path: entry,
      content,
      language: detectLanguage(entry),
      ...(gitStatus === undefined ? {} : { gitStatus }),
    });
  }

  return {
    files,
    limitReached: candidates.length > config.performance.maxFiles,
  };
}

/** Reads the project's root .gitignore; nested .gitignore files are not read. */
async function loadGitignore(targetPath: string): Promise<Ignore | undefined> {
  try {
    const text = await readFile(path.join(targetPath, ".gitignore"), "utf8");
    return ignoreModule.default().add(text.replace(/\r\n/g, "\n"));
  } catch {
    return undefined;
  }
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
