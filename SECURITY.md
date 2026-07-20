# Security Policy

## Supported versions

The latest `0.2.x` release receives security fixes during the MVP pilot.

## Reporting a vulnerability

Use the repository's private GitHub Security Advisory reporting flow when available. If private reporting is unavailable, open a minimal issue asking for a private contact channel without including exploit details, source code, credentials, or personal data.

Never submit a real secret. Revoke and rotate any credential that may have been exposed.

Include the affected VibinGuard version, operating system, VS Code version, reproduction steps using fake data, and the expected versus actual behavior.

## Development dependency note

The current `tsup` release depends on an `esbuild` version with a low-severity Windows development-server advisory. VibinGuard does not run the esbuild development server in production, and esbuild is not included in the VSIX. Revisit this dependency when a compatible `tsup` release is available.
