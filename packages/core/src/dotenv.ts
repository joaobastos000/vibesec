import { execFile } from "node:child_process";
import { resolveExecutable } from "./executables.js";
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

/** Resolves Git once to an absolute path (see resolveExecutable). */
export function resolveGitExecutable(): string | undefined {
  if (cachedGitExecutable === undefined) {
    cachedGitExecutable = resolveExecutable("git") ?? null;
  }
  return cachedGitExecutable ?? undefined;
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
