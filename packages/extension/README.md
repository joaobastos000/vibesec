# VibeGuard

VibeGuard is a local security guard for AI-generated code.

It helps vibe coders catch secrets and common security mistakes before generated code reaches the workspace.

## Features

- Scan the current file.
- Scan the current project with local deterministic rules.
- Guard clipboard content before paste.
- Block generated content that contains hardcoded secrets or high-risk findings.
- Show findings as VS Code diagnostics.
- Show detailed explanations and fix prompts in the VibeGuard output panel.

## Commands

- `VibeGuard: Scan Current File`
- `VibeGuard: Scan Project`
- `VibeGuard: Guard Clipboard Before Paste`
- `VibeGuard: Show Output`

## Privacy

The MVP runs locally by default. It does not send generated code to a remote model before local secret checks.

## Settings

- `vibeguard.language`: `pt-BR` or `en-US`
- `vibeguard.aiProvider`: reserved for future AI-assisted fixes
- `vibeguard.scanOnSave`: scan supported files after save
- `vibeguard.insertSafeClipboard`: insert clipboard content automatically when it passes the guard
