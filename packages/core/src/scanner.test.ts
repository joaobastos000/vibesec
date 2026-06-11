import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createScanner } from "./index.js";

test("detects a hardcoded secret in a TypeScript file", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "vibeguard-"));
  const filePath = path.join(directory, "handler.ts");
  await writeFile(filePath, 'const apiKey = "sk_test_1234567890abcdef";\n', "utf8");

  const scanner = createScanner({
    ai: { provider: "disabled", enableRag: false },
    staticAnalysis: {
      enableBuiltInRules: true,
      enableNpmAudit: false,
      enableSemgrep: false,
    },
  });

  const result = await scanner.scan({ target: filePath, mode: "file" });

  assert.equal(result.summary.filesScanned, 1);
  assert.equal(result.findings[0]?.category, "secret");
  assert.equal(result.findings[0]?.severity, "critical");
});

