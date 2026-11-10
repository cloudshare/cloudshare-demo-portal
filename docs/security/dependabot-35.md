# Dependabot alert 35: deepmerge-ts

Approved scope: address https://github.com/cloudshare/cloudshare-demo-portal/security/dependabot/35 with an npm override scoped to `@prisma/config`, selecting `deepmerge-ts` 8.0.0, and a regenerated lockfile. Retain the existing Next/PostCSS override. No Prisma major upgrade, schema, application, Vite or CloudShare integration changes.

GHSA-ggr8-5vv4-36mx / CVE-2026-40345 affects deepmerge-ts below 8.0.0 (high, CVSS v4 8.2). The current chain is prisma 6.19.3 -> @prisma/config 6.19.3 -> deepmerge-ts 7.1.5. The failure requires matching cyclic JavaScript object graphs; plain JSON cannot create this condition. No direct portal use or prisma.config file was found. This is CLI configuration tooling exposure; no remote portal exploit path was identified.

Compatibility risk: v8 changes Map merging and deepmergeInto semantics. Validate clean installation, dependency resolution, Prisma generation/schema validation/config loading, lint, typecheck, existing tests, production build and a disposable database-backed portal smoke test. Do not run migrations or smoke tests against the shared database.

PR #498 changes Vite in the same manifest/lockfile; coordinate ordering and preserve its independent scope. This alert is not GitHub issue #35; do not use an issue-closing keyword with that number.

The shared checkout and port 3000 must remain untouched. No merge is authorized. Exact validation and review evidence will be recorded in the PR.

Upstream sources:
- https://github.com/RebeccaStevens/deepmerge-ts/security/advisories/GHSA-ggr8-5vv4-36mx
- https://github.com/RebeccaStevens/deepmerge-ts/releases/tag/v8.0.0
