import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createScanner, resolveGitExecutable } from "./index.js";
import type { ScanFile } from "./types.js";

// Every credential below is fake. Values are split so this file never contains
// a string that a real secret scanner would flag.
const fake = {
  openai: "sk-proj-" + "A1b2C3d4E5f6G7h8I9j0K1l2M3n4",
  stripe: "sk_live_" + "51H8xYzAbCdEfGhIjKlMnOpQr",
  aws: "AKIA" + "IOSFODNN7ABCDEFG",
  github: "ghp_" + "abcdefghijklmnopqrstuvwxyz0123456789",
  supabaseServiceRole: jwt({ role: "service_role" }),
  supabaseAnon: jwt({ role: "anon" }),
};

function jwt(payload: object): string {
  const encode = (value: object) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "HS256", typ: "JWT" })}.${encode(payload)}.c2lnbmF0dXJlLWZha2U`;
}

const deterministic = () =>
  createScanner({
    ai: { provider: "disabled", enableRag: false },
    staticAnalysis: {
      enableBuiltInRules: true,
      enableNpmAudit: false,
      enableSemgrep: false,
    },
  });

const secretCases: Array<{
  name: string;
  content: string;
  language: ScanFile["language"];
  filePath: string;
  secret: string;
}> = [
  {
    name: "an OpenAI key in an upper-case constant",
    content: `const OPENAI_API_KEY = "${fake.openai}";`,
    language: "typescript",
    filePath: "src/ai.ts",
    secret: fake.openai,
  },
  {
    name: "a Stripe live key passed to a constructor",
    content: `const stripe = new Stripe("${fake.stripe}");`,
    language: "typescript",
    filePath: "src/billing.ts",
    secret: fake.stripe,
  },
  {
    name: "a Stripe key in a camelCase variable",
    content: `const stripeSecretKey = "${fake.stripe}";`,
    language: "typescript",
    filePath: "src/billing.ts",
    secret: fake.stripe,
  },
  {
    name: "an AWS access key ID",
    content: `const s3 = new S3({ accessKeyId: "${fake.aws}" });`,
    language: "javascript",
    filePath: "src/storage.js",
    secret: fake.aws,
  },
  {
    name: "a GitHub token in an Authorization header",
    content: `fetch(url, { headers: { Authorization: "Bearer ${fake.github}" } });`,
    language: "typescript",
    filePath: "src/github.ts",
    secret: fake.github,
  },
  {
    name: "a Supabase service_role key in a client",
    content: `export const supabase = createClient("https://x.supabase.co", "${fake.supabaseServiceRole}");`,
    language: "typescript",
    filePath: "src/supabase.ts",
    secret: fake.supabaseServiceRole,
  },
  {
    name: "a key in JSON config",
    content: `{ "openaiKey": "${fake.openai}" }`,
    language: "json",
    filePath: "config.json",
    secret: fake.openai,
  },
  {
    name: "a real key committed to a dotenv template",
    content: `OPENAI_API_KEY=${fake.openai}`,
    language: "env",
    filePath: ".env.example",
    secret: fake.openai,
  },
  {
    name: "a database URL with a password",
    content: `const db = postgres("postgres://admin:Sup3rS3cretPass@db.example.com:5432/app");`,
    language: "typescript",
    filePath: "src/db.ts",
    secret: "Sup3rS3cretPass",
  },
];

for (const secretCase of secretCases) {
  test(`blocks ${secretCase.name} and redacts it`, async () => {
    const result = await deterministic().guardGeneratedContent({
      content: secretCase.content,
      filePath: secretCase.filePath,
      language: secretCase.language,
    });

    assert.equal(result.blocked, true);
    assert.equal(result.findings[0]?.category, "secret");
    // One finding per credential, even when several rules match the line.
    assert.equal(result.findings.length, 1);
    for (const finding of result.findings) {
      assert.equal(
        finding.evidence.includes(secretCase.secret),
        false,
        `evidence must not reveal the secret: ${finding.evidence}`,
      );
      assert.equal(
        finding.fix.prompt?.includes(secretCase.secret) ?? false,
        false,
      );
    }
  });
}

const benignCases: Array<{ name: string; content: string }> = [
  {
    name: "an environment variable lookup",
    content: "const apiKey = process.env.OPENAI_API_KEY;",
  },
  {
    name: "a template prompt built from local data",
    content: "const prompt = `Summarize this article: ${article.title}`;",
  },
  { name: "a messages counter", content: "let messages = unread + 1;" },
  {
    name: "a placeholder password",
    content: 'const password = "placeholder-text-here";',
  },
  {
    name: "a header name stored in a token variable",
    content: 'const token = "Authorization_Header_Name";',
  },
  {
    name: "an environment variable name stored as a value",
    content: 'const secretName = "OPENAI_API_KEY";',
  },
  {
    name: "a token endpoint URL",
    content: 'const tokenUrl = "https://auth.example.com/oauth2/token";',
  },
  {
    name: "a Supabase anon key, which is public by design",
    content: `createClient("https://x.supabase.co", "${fake.supabaseAnon}");`,
  },
  {
    name: "a local default database password",
    content: 'const url = "postgres://postgres:postgres@localhost:5432/app";',
  },
  {
    name: "a request body validated further down the handler",
    content: `const data = req.body;\n${"// ".padEnd(260, "x")}\nconst parsed = schema.parse(data);`,
  },
];

for (const benignCase of benignCases) {
  test(`does not flag ${benignCase.name}`, async () => {
    const result = await deterministic().guardGeneratedContent({
      content: benignCase.content,
      filePath: "src/example.ts",
      language: "typescript",
    });

    assert.deepEqual(
      result.findings.map((finding) => finding.title),
      [],
    );
  });
}

test("still flags prompts built from request input", async () => {
  const result = await deterministic().guardGeneratedContent({
    content: "const prompt = `Answer the user: ${req.body.question}`;",
    filePath: "src/chat.ts",
    language: "typescript",
  });

  assert.ok(
    result.findings.some(
      (finding) => finding.category === "prompt-injection",
    ),
  );
});

test("reports unvalidated req.body once per file", async () => {
  const result = await deterministic().guardGeneratedContent({
    content:
      "app.post('/a', (req, res) => save(req.body));\napp.post('/b', (req, res) => save(req.body));\n",
    filePath: "src/routes.ts",
    language: "typescript",
  });

  assert.equal(
    result.findings.filter((finding) => finding.category === "validation")
      .length,
    1,
  );
});

test("honors vibinguard-ignore directives in file scans", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "vibinguard-ignore-"));
  const filePath = path.join(directory, "config.ts");
  await writeFile(
    filePath,
    [
      "// vibinguard-ignore-next-line",
      'const apiKey = "fake_test_1234567890abcdef";',
      'const token = "fake_test_abcdef1234567890"; // vibinguard-ignore hardcoded-secret',
      "// vibinguard-ignore-next-line insecure-cors",
      'const password = "fake_test_pw_123456";',
    ].join("\n"),
    "utf8",
  );

  const result = await deterministic().scan({ target: filePath, mode: "file" });

  // Only the last secret remains: its directive names a different rule.
  assert.equal(result.findings.length, 1);
  assert.equal(result.findings[0]?.location.startLine, 5);
  assert.equal(result.summary.findings, 1);
});

test("does not let generated content silence the guard with a directive", async () => {
  const result = await deterministic().guardGeneratedContent({
    content: `// vibinguard-ignore-next-line\nconst key = "${fake.openai}";\n`,
    filePath: "src/ai.ts",
    language: "typescript",
  });

  assert.equal(result.blocked, true);
});

test("scans project sources even when node_modules exceeds maxFiles", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "vibinguard-project-"));
  const dependencyDirectory = path.join(directory, "node_modules", "lib");
  const routeDirectory = path.join(directory, "src", "app", "api", "users");
  await mkdir(dependencyDirectory, { recursive: true });
  await mkdir(routeDirectory, { recursive: true });
  await Promise.all(
    Array.from({ length: 30 }, (_, index) =>
      writeFile(
        path.join(dependencyDirectory, `file${index}.js`),
        `module.exports = ${index};\n`,
      ),
    ),
  );
  await writeFile(
    path.join(routeDirectory, "route.ts"),
    'const apiKey = "fake_test_1234567890abcdef";\n',
  );

  const result = await createScanner({
    ai: { provider: "disabled" },
    staticAnalysis: {
      enableBuiltInRules: true,
      enableNpmAudit: false,
      enableSemgrep: false,
    },
    performance: { maxFiles: 5, maxFileSizeKb: 256, commandTimeoutMs: 5000 },
  }).scan({ target: directory, mode: "project" });

  assert.equal(result.summary.filesScanned, 1);
  assert.equal(result.findings[0]?.category, "secret");
});

test("skips Git checks for dotenv files when Git is disabled", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "vibinguard-nogit-"));
  await writeFile(path.join(directory, ".env"), "API_KEY=fake_value_123456\n");

  const result = await createScanner({
    ai: { provider: "disabled" },
    git: { enabled: false },
    staticAnalysis: {
      enableBuiltInRules: true,
      enableNpmAudit: false,
      enableSemgrep: false,
    },
  }).scan({ target: directory, mode: "project" });

  assert.equal(result.summary.filesScanned, 1);
  assert.equal(result.findings.length, 0);
});

test("resolves Git to an absolute executable path", () => {
  const gitExecutable = resolveGitExecutable();
  if (gitExecutable !== undefined) {
    assert.equal(path.isAbsolute(gitExecutable), true);
  }
});

const jwtCases: Array<{ name: string; content: string; flagged: boolean }> = [
  {
    name: "flags jwt.sign with a multi-key payload and no options",
    content:
      "jwt.sign({ id: user.id, role: user.role }, process.env.JWT_SECRET);",
    flagged: true,
  },
  {
    name: "flags jwt.sign with options that omit expiresIn",
    content: 'jwt.sign({ id }, secret, { algorithm: "HS256" });',
    flagged: true,
  },
  {
    name: "does not flag jwt.sign with expiresIn",
    content: 'jwt.sign({ id, role }, secret, { expiresIn: "15m" });',
    flagged: false,
  },
  {
    name: "does not flag jwt.sign with exp in the payload",
    content:
      "jwt.sign({ id, exp: Math.floor(Date.now() / 1000) + 900 }, secret);",
    flagged: false,
  },
  {
    name: "does not flag jwt.sign with options in a variable",
    content: "jwt.sign(payload, secret, signOptions);",
    flagged: false,
  },
  {
    name: "parses strings and nested braces in jwt.sign payloads",
    content:
      'jwt.sign({ name: "a, b", meta: { tags: ["x", "y"] } }, secret);',
    flagged: true,
  },
];

for (const jwtCase of jwtCases) {
  test(jwtCase.name, async () => {
    const result = await deterministic().guardGeneratedContent({
      content: jwtCase.content,
      filePath: "src/auth.ts",
      language: "typescript",
    });

    const titles = result.findings
      .filter((finding) => finding.category === "auth")
      .map((finding) => finding.title);
    assert.deepEqual(
      titles,
      jwtCase.flagged ? ["JWT signed without explicit expiration"] : [],
    );
  });
}
