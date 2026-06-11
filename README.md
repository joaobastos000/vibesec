# VibeGuard

## 🎯 Main Objective

Create a tool that automatically detects security vulnerabilities in AI-generated code and delivers fixes in an extremely easy way:

- Apply-ready patches
- Prompts ready to paste back into the AI agent

## 🚀 Initial Focus (MVP - Solo Vibe Coders)

Total priority for individual developers:

1. **VS Code Extension** (primary interface)
2. **Robust CLI**
3. Lightweight backend (Node.js) for heavier AI-powered functionality

After that, we will build:

- GitHub App
- Dashboard

## 🛠️ Technology Stack (Mandatory)

- **Backend**: Node.js 22 + TypeScript + Fastify
- **AI**: LangChain.js + OpenAI (GPT-4o or Claude 3.5 Sonnet) + Ollama fallback (local)
- **Vector DB**: Chroma (local) or Supabase Vector
- **Static Analysis**: Semgrep + ESLint security rules + npm audit
- **VS Code Extension**: TypeScript + VS Code Extension API
- **Others**: Zod, Helmet, dotenv, BullMQ (queues), Redis (optional for MVP), pdf-lib or Markdown for reports

## 🔍 MVP Features (VS Code Extension + CLI)

### Core Engine (Backend)

- Hybrid scanner:
  - Static analysis (Semgrep + OWASP rules)
  - LLM + RAG analysis (knowledge base with OWASP Top 10, OWASP LLM Top 10, common CVEs in Node.js/Next.js)

- Specialized detection for AI-generated code:
  - Hardcoded secrets
  - Weak authentication
  - Client-side secrets
  - Missing input validation
  - SQL Injection
  - XSS
  - Prompt injection risks
  - Unsafe dependencies
  - Etc.

- Fix generation:
  - Apply-ready diff/patch
  - Optimized prompt to paste into Cursor/Claude

Example:

> Refactor this code securely using Zod + parameterized queries...

### VS Code Extension

- Command: `VibeGuard: Scan Current File`
- Command: `VibeGuard: Scan Project`
- Visual problem highlighting (squiggles + hover explanation + severity)
- "Generate Fix Prompt" button
- "Apply Secure Patch" button (when possible)
- Sidebar with "Vibe Security Score" (0-100)
- Support for local mode (Ollama) for privacy

### CLI

```bash
vibeguard scan .
vibeguard scan src/app
vibeguard watch
```

- Beautiful terminal output
- Option to generate Markdown reports

## 📌 Important Requirements

- VibeGuard itself must follow security best practices
- Support for Node.js, Next.js, Express, and NestJS projects
- Friendly explanations in Portuguese and English
- Fast scans with smart caching
- Easy configuration through extension settings.json
- Excellent DX (Developer Experience)

