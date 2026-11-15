import { randomBytes, timingSafeEqual } from "node:crypto";
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

export interface ServerOptions {
  /** Shared secret every POST request must send as "Authorization: Bearer <token>". */
  token: string;
  /** Extra Host header names to accept besides the loopback names. */
  allowedHosts?: string[];
}

const loopbackHosts = ["127.0.0.1", "localhost", "[::1]"];
const minimumTokenLength = 16;

export async function buildServer(
  options: ServerOptions,
): Promise<FastifyInstance> {
  if (options.token.length < minimumTokenLength) {
    throw new Error(
      `The API token must be at least ${minimumTokenLength} characters long.`,
    );
  }
  const allowedHosts = new Set(
    [...loopbackHosts, ...(options.allowedHosts ?? [])].map((host) =>
      host.toLowerCase(),
    ),
  );
  const expectedAuthorization = Buffer.from(`Bearer ${options.token}`);

  const app = Fastify({
    logger: process.env["NODE_ENV"] !== "test",
    disableRequestLogging: process.env["NODE_ENV"] === "test",
  });

  // Rejects DNS-rebinding requests whose Host is not this machine.
  app.addHook("onRequest", async (request, reply) => {
    if (!allowedHosts.has(hostName(request.headers.host))) {
      return reply
        .code(403)
        .send(apiError("FORBIDDEN_HOST", "Host header is not allowed"));
    }
    return undefined;
  });

  // Every scan reads files or content, so every POST needs the token.
  app.addHook("onRequest", async (request, reply) => {
    if (request.method !== "POST") {
      return undefined;
    }
    const provided = Buffer.from(request.headers.authorization ?? "");
    if (
      provided.length !== expectedAuthorization.length ||
      !timingSafeEqual(provided, expectedAuthorization)
    ) {
      return reply
        .code(401)
        .send(apiError("UNAUTHORIZED", "A valid API token is required"));
    }
    return undefined;
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
  const configuredToken = process.env["VIBINGUARD_API_TOKEN"];
  const token = configuredToken ?? randomBytes(32).toString("hex");
  const allowedHosts = (process.env["VIBINGUARD_ALLOWED_HOSTS"] ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);

  const app = await buildServer({ token, allowedHosts });
  await app.listen({ port, host });
  console.log(`VibinGuard backend listening on http://${host}:${port}`);
  if (configuredToken === undefined) {
    // Shown once so a local client can authenticate; set VIBINGUARD_API_TOKEN to choose it.
    console.log(`API token for this run: ${token}`);
  }
}

/** Returns the lower-cased host name from a Host header, without its port. */
function hostName(header: string | undefined): string {
  const value = (header ?? "").trim().toLowerCase();
  if (value.startsWith("[")) {
    const end = value.indexOf("]");
    return end === -1 ? value : value.slice(0, end + 1);
  }
  return value.split(":")[0] ?? "";
}
