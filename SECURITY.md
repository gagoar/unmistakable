# Security policy

## Supported versions

Only the latest release gets security fixes. Check the version in `.claude-plugin/plugin.json` against the [releases page](https://github.com/gagoar/unmistakable/releases).

## Report a vulnerability

Do not open a public issue. Use [private vulnerability reporting](https://github.com/gagoar/unmistakable/security/advisories/new) on this repository.

Include the version, the steps to reproduce, and the effect you see. You get a first reply within 7 days.

## Scope

unmistakable has no hook, no server and no telemetry. The skill runs in your session. The linter (`scripts/ste-lint.ts`) runs on your machine and makes no network call. A report is in scope when the linter or a script in this repository reads, writes or runs something it should not.
