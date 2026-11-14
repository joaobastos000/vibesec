import { accessSync, constants, statSync } from "node:fs";
import path from "node:path";

/**
 * Resolves a program to an absolute path using only absolute PATH entries.
 *
 * Spawning a bare command name on Windows searches the current directory
 * before PATH, so a scanned project could plant its own git.exe or npm.exe.
 * Resolving the executable here keeps the scanned folder out of the search.
 */
export function resolveExecutable(
  name: string,
  pathValue: string = process.env.PATH ?? "",
): string | undefined {
  const fileName = process.platform === "win32" ? `${name}.exe` : name;
  for (const directory of absolutePathEntries(pathValue)) {
    const candidate = path.join(directory, fileName);
    if (isExecutableFile(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

export interface CommandInvocation {
  command: string;
  args: string[];
}

/**
 * Resolves how to run npm without a shell. On Windows npm is a .cmd script,
 * which execFile cannot run, so its JavaScript entry point is run with node.
 */
export function resolveNpmInvocation(
  pathValue: string = process.env.PATH ?? "",
): CommandInvocation | undefined {
  if (process.platform !== "win32") {
    const npm = resolveExecutable("npm", pathValue);
    return npm === undefined ? undefined : { command: npm, args: [] };
  }

  const node = resolveExecutable("node", pathValue);
  if (node === undefined) {
    return undefined;
  }
  for (const directory of absolutePathEntries(pathValue)) {
    const npmCli = path.join(directory, "node_modules", "npm", "bin", "npm-cli.js");
    if (isFile(path.join(directory, "npm.cmd")) && isFile(npmCli)) {
      return { command: node, args: [npmCli] };
    }
  }
  return undefined;
}

function absolutePathEntries(pathValue: string): string[] {
  return pathValue
    .split(path.delimiter)
    .map((entry) => entry.trim().replace(/^"(.*)"$/, "$1"))
    .filter((entry) => entry.length > 0 && path.isAbsolute(entry));
}

function isFile(candidate: string): boolean {
  try {
    return statSync(candidate).isFile();
  } catch {
    return false;
  }
}

function isExecutableFile(candidate: string): boolean {
  if (!isFile(candidate)) {
    return false;
  }
  if (process.platform === "win32") {
    return true;
  }
  try {
    accessSync(candidate, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}
