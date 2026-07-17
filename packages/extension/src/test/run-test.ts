import fs from "node:fs/promises";
import path from "node:path";
import { downloadAndUnzipVSCode, runTests } from "@vscode/test-electron";

const testOutputDirectory = __dirname;
const extensionDevelopmentPath = path.resolve(testOutputDirectory, "../..");
const extensionTestsPath = path.join(testOutputDirectory, "suite.cjs");
const testWorkspacePath = path.join(extensionDevelopmentPath, "test-workspace");

async function main(): Promise<void> {
  const vscodeExecutablePath = await downloadAndUnzipVSCode({ version: "stable" });
  await disableHostInstallerMutex(vscodeExecutablePath);

  await runTests({
    vscodeExecutablePath,
    extensionDevelopmentPath,
    extensionTestsPath,
    launchArgs: [testWorkspacePath, "--disable-extensions", "--disable-workspace-trust"],
  });
}

async function disableHostInstallerMutex(vscodeExecutablePath: string): Promise<void> {
  if (process.platform !== "win32") {
    return;
  }

  const productPath = await findProductPath(path.dirname(vscodeExecutablePath));
  const product = JSON.parse(await fs.readFile(productPath, "utf8")) as Record<string, unknown>;

  // The downloaded archive is isolated and is never managed by the host VS Code installer.
  if (product.win32VersionedUpdate === true) {
    product.win32VersionedUpdate = false;
    await fs.writeFile(productPath, `${JSON.stringify(product, null, 2)}\n`, "utf8");
  }
}

async function findProductPath(installDirectory: string): Promise<string> {
  const directPath = path.join(installDirectory, "resources", "app", "product.json");

  try {
    await fs.access(directPath);
    return directPath;
  } catch {
    // VS Code 1.129+ keeps application resources in a versioned child directory on Windows.
  }

  const entries = await fs.readdir(installDirectory, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const versionedPath = path.join(installDirectory, entry.name, "resources", "app", "product.json");
    try {
      await fs.access(versionedPath);
      return versionedPath;
    } catch {
      // Continue until the active version directory is found.
    }
  }

  throw new Error(`Could not locate VS Code product.json under ${installDirectory}`);
}

main().catch((error: unknown) => {
  console.error("VibinGuard extension integration tests failed.", error);
  process.exitCode = 1;
});
