# Service security implementation plan

> For agentic workers: use superpowers:subagent-driven-development for isolated tasks with spec and quality review.

Goal: establish enforceable access controls and a verifiable operations policy for official service deployment.

Architecture: retain the Node/SQLite service and Docker/Funnel deployment. Extract transport defenses and authentication/authorization behind focused modules. Preserve the running legacy workshop until the selected identity provider and owner are configured and migration succeeds.

## Task 1: Independently deployable transport and abuse defenses

Files: create server/security.mjs and tests/security.test.mjs; modify server/app.mjs, server/index.mjs, compose.yaml, .env.example, package.json, README.md.

- [x] Add failing tests for CSP/frame/permissions headers, HTTPS-only HSTS, rejected foreign origins, bounded fixed-window request limiting, Retry-After, fake forwarded headers, active session and SSE limits.
- [x] Run node --test tests/security.test.mjs and confirm missing defenses fail.
- [x] Implement a focused security module exporting header application and bounded request limiting. createApp security options permit small limits in tests; defaults must allow existing tests. Validate configuration integers before opening DB. No unconditional forwarded-header trust, no bearer secrets or request bodies in logs.
- [x] Integrate API and login rate limits before body parsing; cap sessions and SSE before registration. Add Retry-After on 429. Reclaim expired limiter buckets and sessions. Guard existing HTTP localhost and HTTPS PUBLIC_URL origin semantics.
- [x] Set Compose default host binding to 127.0.0.1; document explicit 0.0.0.0 opt-in for trusted LAN. Add memory, CPU and pid limits compatible with Docker Desktop and maintenance commands.
- [x] Update npm test to include new tests. Run npm test, npm run build, test:e2e and isolated test:docker. Review implementation against tests and inspect diff; commit only assigned files.

## Task 2: Selected identity and invitation policy

- [x] Proceed with the announced invited-user/OIDC default while the provider selection is pending. Implement the selected approach, preferably OIDC through maintained openid-client, with signed provider fixture tests and state/nonce/PKCE failure tests before code.
- [x] Add durable users, invitations, hashed sessions, roles and security events via additive SQLite migration; preserve project/card rows.
- [x] Require verified provider identity and explicit invitation or configured bootstrap owner. Apply roles in the server, not only UI.
- [x] Provide owner tools for invitations, revocation, memberships and audit; implement matching Korean UI and session expiry/re-authentication.

## Task 3: Enforced MCP credentials

- [x] Add scoped, expiring, revocable project tokens stored only as hashes. Test direct API writes with read-only tokens are rejected.
- [x] Filter project lists and SSE by current identity and token grants. Replace official MCP shared-code configuration with tokens; keep legacy development mode explicit.

## Task 4: Operations policy and release gate

- [x] Add SECURITY.md, security-controls matrix and incident/backup/data-retention/AI-data handling runbooks with implemented versus pending status.
- [x] Add dependency/secret checks and deployment checks. Production startup rejects legacy auth, absent identity/owner settings and non-HTTPS public URL.
- [x] Verify signed-fixture owner login and additive data migration in isolated tests; record external setup requirements without exposing credentials.
- [ ] Configure the actual identity provider and owner, verify real login/MFA against a separate data copy, and then transition the public service to production.
- [ ] Configure encrypted off-host backups, restore drills, alert delivery and a real security contact before official release.

## Verification record (2026-10-07)

Node tests: 61 passed, including signed OIDC failures, live revocation, MCP scope enforcement, and audit-write failure rollback. Browser tests: 11 passed. Production build and production dependency audit passed. Docker integration passed and validates the real image, persistence and deployment limits. The final production image passed HIGH/CRITICAL vulnerability scanning. GitHub checks are required before deployment. Real provider credentials and operator controls remain pending; the existing public workshop stays explicitly in workshop/legacy mode.
