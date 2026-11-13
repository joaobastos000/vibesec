import { execFile } from "node:child_process";
import { accessSync, constants, statSync } from "node:fs";
import path from "node:path";
import type { GitFileStatus } from "./types.js";

const dotenvTemplateNames = new Set([
  ".env.example",
  ".env.sample",
  ".env.template",
]);

export function isPrivateDotEnvPath(filePath: string): boolean {
  const name = path.basename(filePath).toLowerCase();
  return (
    (name === ".env" || name.startsWith(".env.")) &&
    !dotenvTemplateNames.has(name)
  );
}

export async function detectGitFileStatus(
  filePath: string,
  timeoutMs = 5000,
): Promise<GitFileStatus> {
  const gitExecutable = resolveGitExecutable();
  if (gitExecutable === undefined) {
    return "unavailable";
  }

  const absolutePath = path.resolve(filePath);
  const workingDirectory = path.dirname(absolutePath);
  const timeout = Math.min(Math.max(timeoutMs, 1000), 10000);
  const repository = await runGit(
    gitExecutable,
    ["rev-parse", "--show-toplevel"],
    workingDirectory,
    timeout,
  );

  if (!repository.ok || repository.stdout.trim().length === 0) {
    return "unavailable";
  }

  const repositoryRoot = repository.stdout.trim();
  const relativePath = path.relative(repositoryRoot, absolutePath);
  if (
    relativePath.length === 0 ||
    relativePath === ".." ||
    relativePath.startsWith(`..${path.sep}`)
  ) {
    return "unavailable";
  }

  const tracked = await runGit(
    gitExecutable,
    ["ls-files", "--error-unmatch", "--", relativePath],
    repositoryRoot,
    timeout,
  );
  if (tracked.ok) {
    return "tracked";
  }

  const ignored = await runGit(
    gitExecutable,
    ["check-ignore", "--quiet", "--", relativePath],
    repositoryRoot,
    timeout,
  );
  return ignored.ok ? "ignored" : "untracked";
}

let cachedGitExecutable: string | null | undefined;

/**
 * Resolves Git to an absolute path using only absolute PATH entries.
 *
 * Spawning a bare "git" on Windows searches the current directory before PATH,
 * so a repository could plant its own git.exe next to a dotenv file. Resolving
 * the executable ourselves keeps the scanned folder out of the search.
 */
export function resolveGitExecutable(): string | undefined {
  if (cachedGitExecutable !== undefined) {
    return cachedGitExecutable ?? undefined;
  }

  const executableName = process.platform === "win32" ? "git.exe" : "git";
  for (const entry of (process.env.PATH ?? "").split(path.delimiter)) {
    const directory = entry.trim().replace(/^"(.*)"$/, "$1");
    if (directory.length === 0 || !path.isAbsolute(directory)) {
      continue;
    }

    const candidate = path.join(directory, executableName);
    if (isExecutableFile(candidate)) {
      cachedGitExecutable = candidate;
      return candidate;
    }
  }

  cachedGitExecutable = null;
  return undefined;
}

function isExecutableFile(candidate: string): boolean {
  try {
    if (!statSync(candidate).isFile()) {
      return false;
    }
    if (process.platform !== "win32") {
      accessSync(candidate, constants.X_OK);
    }
    return true;
  } catch {
    return false;
  }
}

function runGit(
  gitExecutable: string,
  arguments_: string[],
  cwd: string,
  timeout: number,
): Promise<{ ok: boolean; stdout: string }> {
  return new Promise((resolve) => {
    execFile(
      gitExecutable,
      // Repository config must not be able to start helper programs.
      ["-c", "core.fsmonitor=false", "-C", cwd, ...arguments_],
      { cwd, timeout, windowsHide: true, encoding: "utf8" },
      (error, stdout) => {
        resolve({ ok: error === null, stdout: stdout ?? "" });
      },
    );
  });
}
