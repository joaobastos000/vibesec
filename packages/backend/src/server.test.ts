import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildServer } from "./server.js";
import type { FastifyInstance } from "fastify";

describe("VibeGuard Backend API", () => {
  let app: FastifyInstance;

  before(async () => {
    app = await buildServer();
    await app.ready();
  });

  after(async () => {
    await app.close();
  });

  // ── GET /health ─────────────────────────────────────────────────────────
  test("GET /health returns status ok with version and timestamp", async () => {
    const res = await app.inject({ method: "GET", url: "/health" });
    assert.equal(res.statusCode, 200);

    const body = res.json<{ status: string; version: string; timestamp: string }>();
    assert.equal(body.status, "ok");
    assert.equal(body.version, "0.1.0");
    assert.ok(typeof body.timestamp === "string", "timestamp should be a string");
    assert.doesNotThrow(() => new Date(body.timestamp), "timestamp should be valid ISO");
  });

  // ── GET /version ────────────────────────────────────────────────────────
  test("GET /version returns package metadata", async () => {
    const res = await app.inject({ method: "GET", url: "/version" });
    assert.equal(res.statusCode, 200);

    const body = res.json<{ name: string; version: string; engine: string }>();
    assert.equal(body.name, "@vibeguard/backend");
    assert.ok(typeof body.version === "string");
    assert.ok(body.engine.startsWith(">="));
  });

  // ── POST /scan ──────────────────────────────────────────────────────────
  test("POST /scan detects hardcoded secret in a temp file", async () => {
    // Create a temp directory with a file containing a hardcoded secret
    const dir = mkdtempSync(join(tmpdir(), "vibeguard-test-"));
    const filePath = join(dir, "secrets.ts");

    try {
      writeFileSync(
        filePath,
        `const API_KEY = "sk-hardcoded-secret-1234567890abcdef";\n`,
        "utf-8"
      );

      const res = await app.inject({
        method: "POST",
        url: "/scan",
        payload: {
          target: filePath,
          mode: "file",
          config: {
            language: "en-US",
            ai: { provider: "disabled" },
            staticAnalysis: {
              enableBuiltInRules: true,
              enableSemgrep: false,
              enableNpmAudit: false,
            },
          },
        },
      });

      assert.equal(res.statusCode, 200, `Expected 200 but got ${res.statusCode}: ${res.body}`);

      const result = res.json<{
        findings: Array<{ category: string; severity: string }>;
        summary: { findings: number };
      }>();

      assert.ok(result.summary.findings > 0, "Should have at least one finding");
      const secretFinding = result.findings.find((f) => f.category === "secret");
      assert.ok(secretFinding !== undefined, "Should detect a 'secret' category finding");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("POST /scan returns 400 for empty target", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/scan",
      payload: { target: "", mode: "project" },
    });

    assert.equal(res.statusCode, 400);
    const body = res.json<{ error: { code: string } }>();
    assert.equal(body.error.code, "INVALID_BODY");
  });

  test("POST /scan returns 400 for missing body", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/scan",
      payload: {},
    });

    assert.equal(res.statusCode, 400);
    const body = res.json<{ error: { code: string } }>();
    assert.equal(body.error.code, "INVALID_BODY");
  });

  test("POST /guard/generated blocks AI-generated content with a secret", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/guard/generated",
      payload: {
        content: 'const apiKey = "sk-live-1234567890abcdef";\n',
        filePath: "src/generated/payment.ts",
        language: "typescript",
        config: {
          language: "en-US",
          ai: { provider: "disabled" },
          staticAnalysis: {
            enableBuiltInRules: true,
            enableSemgrep: false,
            enableNpmAudit: false,
          },
        },
      },
    });

    assert.equal(res.statusCode, 200, `Expected 200 but got ${res.statusCode}: ${res.body}`);

    const result = res.json<{
      blocked: boolean;
      findings: Array<{ category: string; source: string }>;
      summary: { findings: number };
    }>();

    assert.equal(result.blocked, true);
    assert.ok(result.summary.findings > 0, "Should have at least one generated-content finding");
    assert.equal(result.findings[0]?.category, "secret");
    assert.equal(result.findings[0]?.source, "generation-guard");
  });

  test("POST /guard/generated returns 400 for empty generated content", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/guard/generated",
      payload: { content: "" },
    });

    assert.equal(res.statusCode, 400);
    const body = res.json<{ error: { code: string } }>();
    assert.equal(body.error.code, "INVALID_BODY");
  });

  // ── 404 ─────────────────────────────────────────────────────────────────
  test("GET /unknown returns 404 with structured error", async () => {
    const res = await app.inject({ method: "GET", url: "/unknown" });
    assert.equal(res.statusCode, 404);
    const body = res.json<{ error: { code: string } }>();
    assert.equal(body.error.code, "NOT_FOUND");
  });
});
