import type { Finding } from "./types.js";

export function buildFixPrompt(finding: Omit<Finding, "fix">, language: "pt-BR" | "en-US"): string {
  if (language === "en-US") {
    return [
      "You are a senior application security engineer.",
      "Refactor the vulnerable code below with a minimal, production-ready security fix.",
      `Issue: ${finding.title}`,
      `Risk: ${finding.description}`,
      `Location: ${finding.location.filePath}:${finding.location.startLine}`,
      `Evidence: ${finding.evidence}`,
      "Requirements:",
      "- Preserve existing behavior and public APIs unless security requires a change.",
      "- Add strict validation, safe defaults, and tests when relevant.",
      "- Explain the security reasoning briefly after the patch.",
    ].join("\n");
  }

  return [
    "Voce e um engenheiro senior de seguranca de aplicacoes.",
    "Refatore o codigo vulneravel abaixo com uma correcao minima, segura e pronta para producao.",
    `Problema: ${finding.title}`,
    `Risco: ${finding.description}`,
    `Local: ${finding.location.filePath}:${finding.location.startLine}`,
    `Evidencia: ${finding.evidence}`,
    "Requisitos:",
    "- Preserve o comportamento existente e APIs publicas, exceto quando a seguranca exigir mudanca.",
    "- Adicione validacao rigorosa, defaults seguros e testes quando fizer sentido.",
    "- Explique brevemente o motivo de seguranca apos o patch.",
  ].join("\n");
}

