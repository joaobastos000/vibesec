import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createScanner } from "./index.js";

test("detects a hardcoded secret in a TypeScript file", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "vibinguard-"));
  const filePath = path.join(directory, "handler.ts");
  await writeFile(
    filePath,
    'const apiKey = "sk_test_1234567890abcdef";\n',
    "utf8",
  );

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
  assert.equal(
    result.findings[0]?.evidence.includes("1234567890abcdef"),
    false,
  );
});

test("blocks generated content with a hardcoded secret before it is written", async () => {
  const scanner = createScanner({
    ai: { provider: "disabled", enableRag: false },
    staticAnalysis: {
      enableBuiltInRules: true,
      enableNpmAudit: false,
      enableSemgrep: false,
    },
  });

  const result = await scanner.guardGeneratedContent({
    content: 'export const token = "ghp_1234567890abcdefghijklmnop";\n',
    filePath: "src/generated/github.ts",
    language: "typescript",
  });

  assert.equal(result.blocked, true);
  assert.equal(result.target, "src/generated/github.ts");
  assert.equal(result.findings[0]?.source, "generation-guard");
  assert.equal(result.findings[0]?.category, "secret");
  assert.equal(
    result.findings[0]?.evidence.includes("abcdefghijklmnop"),
    false,
  );
});

test("allows generated content without blocking findings", async () => {
  const scanner = createScanner({
    ai: { provider: "disabled", enableRag: false },
    staticAnalysis: {
      enableBuiltInRules: true,
      enableNpmAudit: false,
      enableSemgrep: false,
    },
  });

  const result = await scanner.guardGeneratedContent({
    content: 'export const getApiKey = () => process.env.API_KEY ?? "";\n',
    filePath: "src/generated/config.ts",
    language: "typescript",
  });

  assert.equal(result.blocked, false);
  assert.equal(result.summary.findings, 0);
  assert.equal(result.ai.enabled, false);
});

test("accepts expected secrets in a Git-ignored private dotenv file", async () => {
  const scanner = createScanner({ ai: { provider: "disabled" } });
  const result = await scanner.guardGeneratedContent({
    content: 'API_KEY="fake_test_1234567890abcdef"\n',
    filePath: ".env",
    language: "env",
    gitStatus: "ignored",
  });

  assert.equal(result.blocked, false);
  assert.equal(result.summary.findings, 0);
});

test("warns once when a private dotenv file is not ignored by Git", async () => {
  const scanner = createScanner({ ai: { provider: "disabled" } });
  const result = await scanner.guardGeneratedContent({
    content: 'API_KEY="fake_test_1234567890abcdef"\n',
    filePath: ".env.local",
    language: "env",
    gitStatus: "untracked",
  });

  assert.equal(result.blocked, false);
  assert.equal(result.summary.findings, 1);
  assert.equal(result.findings[0]?.severity, "medium");
  assert.match(result.findings[0]?.title ?? "", /not ignored by Git/i);
  assert.equal(
    result.findings[0]?.evidence.includes("1234567890abcdef"),
    false,
  );
});

test("blocks a private dotenv file that is already tracked by Git", async () => {
  const scanner = createScanner({ ai: { provider: "disabled" } });
  const result = await scanner.guardGeneratedContent({
    content: 'API_KEY="fake_test_1234567890abcdef"\n',
    filePath: ".env.production",
    language: "env",
    gitStatus: "tracked",
  });

  assert.equal(result.blocked, true);
  assert.equal(result.summary.findings, 1);
  assert.equal(result.findings[0]?.severity, "high");
  assert.match(result.findings[0]?.title ?? "", /tracked by Git/i);
});

test("continues checking committed dotenv templates for hardcoded secrets", async () => {
  const scanner = createScanner({ ai: { provider: "disabled" } });
  const result = await scanner.guardGeneratedContent({
    content: 'API_KEY="fake_test_1234567890abcdef"\n',
    filePath: ".env.example",
    language: "env",
    gitStatus: "untracked",
  });

  assert.equal(result.blocked, true);
  assert.equal(result.findings[0]?.severity, "critical");
  assert.match(result.findings[0]?.title ?? "", /hardcoded secret/i);
});

test("uses a validated local AI finding as a second blocking layer", async () => {
  await withOllamaServer(
    (_requestBody, response) => {
      sendOllamaResponse(response, {
        findings: [
          {
            title: "Administrative route without authorization",
            description:
              "The route queries administrative data without checking the authenticated user's permission.",
            category: "auth",
            severity: "high",
            confidence: 0.93,
            filePath: "src/routes/admin.ts",
            startLine: 1,
            endLine: 1,
            recommendation:
              "Require a valid session and explicitly verify administrator permission before the query.",
          },
        ],
      });
    },
    async (baseUrl) => {
      const scanner = createScanner({
        ai: {
          provider: "local",
          baseUrl,
          model: "test-model",
          timeoutMs: 1000,
        },
        staticAnalysis: {
          enableBuiltInRules: true,
          enableNpmAudit: false,
          enableSemgrep: false,
        },
      });

      const result = await scanner.guardGeneratedContent({
        content: "export const getAdminUser = (id) => db.users.findById(id);\n",
        filePath: "src/routes/admin.ts",
        language: "typescript",
      });

      assert.equal(result.blocked, true);
      assert.equal(result.findings[0]?.source, "llm");
      assert.equal(result.findings[0]?.confidence, "high");
      assert.equal(result.ai.available, true);
      assert.equal(result.ai.findings, 1);
    },
  );
});

test("redacts source secrets before a full-file AI review", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "vibinguard-ai-"));
  const filePath = path.join(directory, "config.ts");
  const fakeSecret = "fake_test_1234567890abcdef";
  await writeFile(filePath, `const apiKey = "${fakeSecret}";\n`, "utf8");
  let requestBody = "";

  await withOllamaServer(
    (body, response) => {
      requestBody = body;
      sendOllamaResponse(response, { findings: [] });
    },
    async (baseUrl) => {
      const scanner = createScanner({
        ai: {
          provider: "local",
          baseUrl,
          model: "test-model",
          timeoutMs: 1000,
        },
        staticAnalysis: {
          enableBuiltInRules: true,
          enableNpmAudit: false,
          enableSemgrep: false,
        },
      });

      const result = await scanner.scan({ target: filePath, mode: "file" });

      assert.equal(result.ai.available, true);
      assert.equal(requestBody.includes(fakeSecret), false);
      assert.equal(requestBody.includes("[REDACTED_SECRET]"), true);
    },
  );
});

test("does not call local AI when a local rule already blocks generated content", async () => {
  const scanner = createScanner({
    ai: {
      provider: "local",
      baseUrl: "http://127.0.0.1:1",
      model: "test-model",
      timeoutMs: 100,
    },
    staticAnalysis: {
      enableBuiltInRules: true,
      enableNpmAudit: false,
      enableSemgrep: false,
    },
  });

  const result = await scanner.guardGeneratedContent({
    content: 'const apiKey = "fake_test_1234567890abcdef";\n',
    filePath: "src/config.ts",
    language: "typescript",
  });

  assert.equal(result.blocked, true);
  assert.equal(result.ai.enabled, true);
  assert.equal(result.ai.attempted, false);
  assert.match(result.ai.message, /did not receive/i);
});

test("keeps deterministic protection working when Ollama is unavailable", async () => {
  const scanner = createScanner({
    ai: {
      provider: "local",
      baseUrl: "http://127.0.0.1:1",
      model: "test-model",
      timeoutMs: 100,
    },
    staticAnalysis: {
      enableBuiltInRules: true,
      enableNpmAudit: false,
      enableSemgrep: false,
    },
  });

  const result = await scanner.guardGeneratedContent({
    content: "export const sum = (left, right) => left + right;\n",
    filePath: "src/sum.ts",
    language: "typescript",
  });

  assert.equal(result.blocked, false);
  assert.equal(result.ai.attempted, true);
  assert.equal(result.ai.available, false);
  assert.equal(result.summary.findings, 0);
});

test("discards an AI response that does not match the security schema", async () => {
  await withOllamaServer(
    (_requestBody, response) => {
      sendOllamaResponse(response, {
        findings: [
          {
            title: "Incomplete response",
            severity: "critical",
            confidence: "certain",
          },
        ],
      });
    },
    async (baseUrl) => {
      const scanner = createScanner({
        ai: {
          provider: "local",
          baseUrl,
          model: "test-model",
          timeoutMs: 1000,
        },
        staticAnalysis: {
          enableBuiltInRules: true,
          enableNpmAudit: false,
          enableSemgrep: false,
        },
      });

      const result = await scanner.guardGeneratedContent({
        content: "export const value = 42;\n",
        filePath: "src/value.ts",
        language: "typescript",
      });

      assert.equal(result.blocked, false);
      assert.equal(result.ai.available, false);
      assert.match(result.ai.message, /invalid format/i);
    },
  );
});

test("rejects non-loopback AI endpoints before sending source", async () => {
  const scanner = createScanner({
    ai: {
      provider: "local",
      baseUrl: "https://example.com",
      model: "test-model",
    },
    staticAnalysis: {
      enableBuiltInRules: true,
      enableNpmAudit: false,
      enableSemgrep: false,
    },
  });

  const result = await scanner.guardGeneratedContent({
    content: "export const value = 42;\n",
    filePath: "src/value.ts",
    language: "typescript",
  });

  assert.equal(result.blocked, false);
  assert.equal(result.ai.attempted, false);
  assert.equal(result.ai.available, false);
  assert.match(result.ai.message, /loopback/i);
});

test("generates a redacted local fix and rechecks it before approval", async () => {
  const fakeSecret = "fake_test_1234567890abcdef";
  const content = `export const apiKey = "${fakeSecret}";\n`;
  const deterministicScanner = createScanner({
    ai: { provider: "disabled" },
    staticAnalysis: {
      enableBuiltInRules: true,
      enableNpmAudit: false,
      enableSemgrep: false,
    },
  });
  const initial = await deterministicScanner.guardGeneratedContent({
    content,
    filePath: "src/config.ts",
    language: "typescript",
  });
  const finding = initial.findings[0];
  assert.ok(finding);
  const requestBodies: string[] = [];
  let requestCount = 0;

  await withOllamaServer(
    (body, response) => {
      requestBodies.push(body);
      requestCount += 1;
      if (requestCount === 1) {
        sendOllamaResponse(response, {
          replacement:
            'export const apiKey = process.env.API_KEY ?? (() => { throw new Error("API_KEY is required"); })();',
          explanation:
            "The credential was removed from source and is now loaded from a required environment variable.",
        });
        return;
      }
      sendOllamaResponse(response, { findings: [] });
    },
    async (baseUrl) => {
      const scanner = createScanner({
        ai: {
          provider: "local",
          baseUrl,
          model: "test-model",
          timeoutMs: 1000,
        },
        staticAnalysis: {
          enableBuiltInRules: true,
          enableNpmAudit: false,
          enableSemgrep: false,
        },
      });

      const result = await scanner.suggestGeneratedContentFix({
        content,
        filePath: "src/config.ts",
        language: "typescript",
        finding,
      });

      assert.equal(result.available, true);
      if (result.available) {
        assert.equal(result.review.blocked, false);
        assert.match(result.replacement, /process\.env\.API_KEY/);
      }
      assert.equal(requestCount, 2);
      assert.equal(requestBodies[0]?.includes(fakeSecret), false);
      assert.equal(requestBodies[0]?.includes("[REDACTED_SECRET]"), true);
    },
  );
});

test("marks an unsafe AI fix as blocked instead of approving it", async () => {
  const content =
    "export const getUser = () => db.query(`SELECT * FROM users WHERE id = ${userId}`);\n";
  const deterministicScanner = createScanner({ ai: { provider: "disabled" } });
  const initial = await deterministicScanner.guardGeneratedContent({
    content,
    filePath: "src/users.ts",
    language: "typescript",
  });
  const finding = initial.findings[0];
  assert.ok(finding);

  await withOllamaServer(
    (_body, response) => {
      sendOllamaResponse(response, {
        replacement:
          "export const query = () => db.query(`SELECT * FROM users WHERE id = ${userId}`);",
        explanation: "The query was reorganized.",
      });
    },
    async (baseUrl) => {
      const scanner = createScanner({
        ai: { provider: "local", baseUrl, model: "test-model" },
        staticAnalysis: {
          enableBuiltInRules: true,
          enableNpmAudit: false,
          enableSemgrep: false,
        },
      });

      const result = await scanner.suggestGeneratedContentFix({
        content,
        filePath: "src/users.ts",
        language: "typescript",
        finding,
      });

      assert.equal(result.available, true);
      if (result.available) {
        assert.equal(result.review.blocked, true);
        assert.equal(result.review.findings[0]?.category, "injection");
      }
    },
  );
});

async function withOllamaServer(
  handle: (requestBody: string, response: ServerResponse) => void,
  run: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const server = createServer(async (request, response) => {
    const body = await readRequestBody(request);
    handle(body, response);
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address() as AddressInfo;
  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) =>
        error === undefined ? resolve() : reject(error),
      );
    });
  }
}

async function readRequestBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

function sendOllamaResponse(response: ServerResponse, content: unknown): void {
  response.writeHead(200, { "content-type": "application/json" });
  response.end(
    JSON.stringify({ message: { content: JSON.stringify(content) } }),
  );
}
