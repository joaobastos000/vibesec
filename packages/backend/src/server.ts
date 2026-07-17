import Fastify, { type FastifyInstance } from "fastify";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import { z } from "zod";
import {
  createScanner,
  generatedContentGuardRequestSchema,
  scanConfigSchema,
  type GeneratedContentGuardResult,
  type ScanResult,
} from "@vibinguard/core";

// ---------------------------------------------------------------------------
// Request schema
// ---------------------------------------------------------------------------

const scanBodySchema = z.object({
  target: z.string().min(1, "target must not be empty"),
  mode: z.enum(["file", "project"]).default("project"),
  config: scanConfigSchema.partial().optional(),
});

type ScanBody = z.infer<typeof scanBodySchema>;

const generatedGuardBodySchema = generatedContentGuardRequestSchema.extend({
  config: scanConfigSchema.partial().optional(),
});

type GeneratedGuardBody = z.infer<typeof generatedGuardBodySchema>;

// ---------------------------------------------------------------------------
// Structured error shape
// ---------------------------------------------------------------------------

interface ApiError {
  error: { code: string; message: string };
}

function apiError(code: string, message: string): ApiError {
  return { error: { code, message } };
}

// ---------------------------------------------------------------------------
// Build server (exported for tests)
// ---------------------------------------------------------------------------

export async function buildServer(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: process.env["NODE_ENV"] !== "test",
    disableRequestLogging: process.env["NODE_ENV"] === "test",
  });

  // Security headers
  await app.register(helmet, { global: true });

  // Rate limiting: 60 req / minute per IP (local-only MVP)
  await app.register(rateLimit, {
    max: 60,
    timeWindow: "1 minute",
    errorResponseBuilder: () =>
      apiError("RATE_LIMIT_EXCEEDED", "Too many requests"),
  });

  // ── GET /health ────────────────────────────────────────────────────────────
  app.get("/health", async () => ({
    status: "ok",
    version: "0.1.0",
    timestamp: new Date().toISOString(),
  }));

  // ── GET /version ───────────────────────────────────────────────────────────
  app.get("/version", async () => ({
    name: "@vibinguard/backend",
    version: "0.1.0",
    engine: ">=22.0.0",
  }));

  // ── POST /scan ─────────────────────────────────────────────────────────────
  app.post<{ Body: ScanBody }>("/scan", async (request, reply) => {
    const parsed = scanBodySchema.safeParse(request.body);

    if (!parsed.success) {
      const message = parsed.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ");
      return reply.code(400).send(apiError("INVALID_BODY", message));
    }

    const { target, mode } = parsed.data;
    // Strip undefined keys so exactOptionalPropertyTypes is satisfied
    const rawConfig = parsed.data.config ?? {};
    const cleanConfig = Object.fromEntries(
      Object.entries(rawConfig).filter(([, v]) => v !== undefined),
    );

    let result: ScanResult;
    try {
      const scanner = createScanner(cleanConfig);
      result = await scanner.scan({ target, mode });
    } catch (err: unknown) {
      const message =
        process.env["NODE_ENV"] === "production"
          ? "Scan failed"
          : err instanceof Error
            ? err.message
            : "Unknown error";

      return reply.code(500).send(apiError("SCAN_FAILED", message));
    }

    return reply.code(200).send(result);
  });

  app.post<{ Body: GeneratedGuardBody }>("/guard/generated", async (request, reply) => {
    const parsed = generatedGuardBodySchema.safeParse(request.body);

    if (!parsed.success) {
      const message = parsed.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ");
      return reply.code(400).send(apiError("INVALID_BODY", message));
    }

    const { content, filePath, language } = parsed.data;
    const rawConfig = parsed.data.config ?? {};
    const cleanConfig = Object.fromEntries(
      Object.entries(rawConfig).filter(([, v]) => v !== undefined),
    );

    let result: GeneratedContentGuardResult;
    try {
      const scanner = createScanner(cleanConfig);
      result = await scanner.guardGeneratedContent(
        filePath === undefined ? { content, language } : { content, filePath, language },
      );
    } catch (err: unknown) {
      const message =
        process.env["NODE_ENV"] === "production"
          ? "Generated content guard failed"
          : err instanceof Error
            ? err.message
            : "Unknown error";

      return reply.code(500).send(apiError("GUARD_FAILED", message));
    }

    return reply.code(200).send(result);
  });

  // ── 404 catch-all ──────────────────────────────────────────────────────────
  app.setNotFoundHandler((_request, reply) => {
    reply.code(404).send(apiError("NOT_FOUND", "Route not found"));
  });

  return app;
}

// ---------------------------------------------------------------------------
// Start server (called from index.ts)
// ---------------------------------------------------------------------------

export async function startServer(): Promise<void> {
  const port = parseInt(process.env["PORT"] ?? "4317", 10);
  const host = process.env["HOST"] ?? "127.0.0.1";

  const app = await buildServer();
  await app.listen({ port, host });
  console.log(`VibinGuard backend listening on http://${host}:${port}`);
}
