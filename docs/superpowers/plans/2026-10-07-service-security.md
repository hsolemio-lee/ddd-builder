# Service security implementation plan

> For agentic workers: use superpowers:subagent-driven-development for isolated tasks with spec and quality review.

Goal: establish enforceable access controls and a verifiable operations policy for official service deployment.

Architecture: retain the Node/SQLite service and Docker/Funnel deployment. Extract transport defenses and authentication/authorization behind focused modules. Preserve the running legacy workshop until the selected identity provider and owner are configured and migration succeeds.

## Task 1: Independently deployable transport and abuse defenses

Files: create server/security.mjs and tests/security.test.mjs; modify server/app.mjs, server/index.mjs, compose.yaml, .env.example, package.json, README.md.

- [ ] Add failing tests for CSP/frame/permissions headers, HTTPS-only HSTS, rejected foreign origins, bounded fixed-window request limiting, Retry-After, fake forwarded headers, active session and SSE limits.
- [ ] Run node --test tests/security.test.mjs and confirm missing defenses fail.
- [ ] Implement a focused security module exporting header application and bounded request limiting. createApp security options permit small limits in tests; defaults must allow existing tests. Validate configuration integers before opening DB. No unconditional forwarded-header trust, no bearer secrets or request bodies in logs.
- [ ] Integrate API and login rate limits before body parsing; cap sessions and SSE before registration. Add Retry-After on 429. Reclaim expired limiter buckets and sessions. Guard existing HTTP localhost and HTTPS PUBLIC_URL origin semantics.
- [ ] Set Compose default host binding to 127.0.0.1; document explicit 0.0.0.0 opt-in for trusted LAN. Add memory, CPU and pid limits compatible with Docker Desktop and maintenance commands.
- [ ] Update npm test to include new tests. Run npm test, npm run build, test:e2e and isolated test:docker. Review implementation against tests and inspect diff; commit only assigned files.

## Task 2: Selected identity and invitation policy

- [ ] Resolve the pending user choice of users and login method. Implement the selected approach, preferably OIDC through maintained openid-client, with signed provider fixture tests and state/nonce/PKCE failure tests before code.
- [ ] Add durable users, invitations, hashed sessions, roles and security events via additive SQLite migration; preserve project/card rows.
- [ ] Require verified provider identity and explicit invitation or configured bootstrap owner. Apply roles in the server, not only UI.
- [ ] Provide owner tools for invitations, revocation, memberships and audit; implement matching Korean UI and session expiry/re-authentication.

## Task 3: Enforced MCP credentials

- [ ] Add scoped, expiring, revocable project tokens stored only as hashes. Test direct API writes with read-only tokens are rejected.
- [ ] Filter project lists and SSE by current identity and token grants. Replace official MCP shared-code configuration with tokens; keep legacy development mode explicit.

## Task 4: Operations policy and release gate

- [ ] Add SECURITY.md, security-controls matrix and incident/backup/data-retention/AI-data handling runbooks with implemented versus pending status.
- [ ] Add dependency/secret checks and deployment checks. Production startup rejects legacy auth, absent identity/owner settings and non-HTTPS public URL.
- [ ] Verify owner login and additive data migration in isolated environment; only then transition the current public service. Record external setup requirements without exposing credentials.
