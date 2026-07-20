# VibinGuard Support

## Before reporting a problem

Pilot testers should follow [GUIA-DE-TESTE-PT-BR.md](GUIA-DE-TESTE-PT-BR.md) and use its report template.

1. Confirm that the latest VibinGuard version is installed.
2. Run **Developer: Reload Window** in VS Code.
3. Reproduce the problem with fake data in a minimal file or workspace.
4. Record the VibinGuard version, VS Code version, operating system, and expected behavior.

## Local AI troubleshooting

Run **VibinGuard: Check Local AI** before reporting an Ollama issue. Confirm that Ollama is running, that the configured model exists locally, and that the address uses `localhost`, `127.0.0.1`, or `::1`. The deterministic security checks remain available when local AI is disabled or unreachable.

## Bug reports and feature requests

Use [GitHub Issues](https://github.com/joaobastos000/vibesec/issues) for reproducible bugs and focused feature requests.

## Security vulnerabilities

Use the repository's private GitHub Security Advisory flow. If private reporting is unavailable, open a minimal issue asking for a private contact channel without including technical details, source code, credentials, or personal data.

Never submit a real secret. Revoke and rotate any credential that may have been exposed.
