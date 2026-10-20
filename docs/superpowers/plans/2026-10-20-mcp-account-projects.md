# MCP Account Projects Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One personal MCP token can access every project its owner currently belongs to.

**Architecture:** Add explicit account targeting (`projectId: null`) alongside existing project targeting. Keep all data access behind live membership checks and intersect token read/write scope with current project roles. Migrate the SQLite token table without broadening existing credentials.

**Tech Stack:** Node SQLite, OIDC, React/TypeScript, MCP SDK, node:test and Playwright.

## Task 1: Account project access, UI and compatibility

These changes form one authorization feature and should be implemented together before deployment. Spec: `docs/superpowers/specs/2026-10-20-mcp-account-projects-design.md`.

**Files:**
- Modify `server/identity.mjs`: nullable project targeting, atomic migration, live membership filter, issuance validation.
- Create `server/token-schema.mjs` if useful to isolate transactional schema migration; tests must exercise actual SQLite.
- Modify `src/components/AccessDialog.tsx`: `projectId: string | null`, default account target, target selector, contextual write eligibility, connection target labels.
- Modify `tests/auth.test.mjs`: real signed OIDC and MCP clients, mixed roles, live membership, token lifecycle and old schema upgrade.
- Modify `tests/e2e/security.spec.ts`: account default and project choice, account token list, request shape and permission hints.
- Modify `README.md`, `docs/security/api-contract.md`, `docs/security/controls.md` as needed for accurate targeting policy.

- [ ] Add failing authorization tests. An owner with two projects and a second user with editor/viewer membership must see both through `projectId: null`; an unrelated project must remain inaccessible. Assert issuance 201 before inspecting any response fields. Retain a string-target token and prove only one project is visible.

```js
const minted = await s.request('/tokens', owner.cookie, 'POST', {
  name: 'My projects', projectId: null, scope: 'read', days: 7,
});
assert.equal(minted.status, 201);
const state = await s.request('/state', undefined, 'GET', undefined, minted.value.token);
assert.deepEqual(state.value.projects.map(p => p.id).sort(), expectedIds.sort());
assert.ok(state.value.projects.every(p => p.role === 'viewer'));
```

- [ ] Run `node --test --test-name-pattern='account|migration' tests/auth.test.mjs` and record expected failure: account target currently rejected with 400. Add migration tests that create the old NOT NULL schema with hashed credentials, reopen through real identity initialization, and verify rows/foreign keys and repeat initialization.
- [ ] Implement minimal support. Change only the token table's project NOT NULL constraint. For old databases, create a replacement table, copy the same eight columns, drop the old table and rename the replacement inside `store.transaction`. Keep foreign keys enabled; no other table references `auth_tokens`. Derive account targeting from an explicit SQL NULL; no sentinel project.

```js
if ((signed.user.guest || (signed.bearer && signed.projectId !== null)) &&
    signed.projectId !== projectId) return undefined;
```

Validate explicit `projectId === null` or nonempty string, reject missing values and other types. For account write issuance require at least one actual editor/admin membership; project write issuance retains the existing project check. Do not grant site admins implicit project membership. Existing token scope checks continue enforcing writes.

- [ ] Add tests for later membership addition/removal, role demotion, read token write rejection, account write token unable to write viewer projects, account disable/expiry/revocation, project deletion retaining account token, audit transaction rollback and guest/bearer issuance denial. Verify HTTP resources and tools, plus stdio `list_projects`/board access with disposable credentials. Existing tools, routes and ports stay the same.
- [ ] Run `node --test tests/auth.test.mjs tests/guest.test.mjs tests/mcp.test.mjs` and resolve failures.
- [ ] Add failing Playwright coverage before UI code: `await expect(page.getByLabel('접근 대상')).toHaveValue('account')`; intercept POST and assert `{projectId: null}`; switch to project target and assert selected project ID. Supply mixed-role fixtures to test editor eligibility and account token visibility.
- [ ] Run the targeted browser test after `npm run build`; verify failure because the selector is absent. Then implement the selector and scoped labels. Read current projects from `/state` for account write eligibility; never derive eligibility from siteAdmin. Account tokens appear in every project's connection dialog. Selected project tokens retain the prior filter.
- [ ] Update docs with explicit null API semantics, dynamic future membership, migration and credential replacement instructions. Preserve legacy workshop behavior.
- [ ] Run `npm test`, `npm run build`, `npm run test:e2e`, and `npx prettier --check` for changed supported files. Self-review the entire diff for access leaks and migration failure atomicity. Commit the implementation only after passing.
- [ ] Run independent spec review, address findings, then independent quality/security review and address findings before integration.

## Task 2: Integrate and deploy the existing local Docker service

**Files:** Existing Dockerfile and compose configuration; do not change secrets or user data. Existing release scripts under `/tmp/ddd-release-*.mjs` must be inspected before use.

- [ ] Push branch and create/attach a PR with feature behavior, compatibility and actual validation results. Wait for required CI including security checks. Merge on green and fast-forward `/Users/sol/dev/ddd-builder` without overwriting unrelated changes.
- [ ] Build an immutable image tagged with the merged revision and OCI revision label; scan with Trivy. Run `npm run test:docker` against that image if supported by the test contract.
- [ ] Back up current production config and SQLite data privately; test both old and new images against cloned data, including an upgraded database reopened by the old image. Existing project/card content and old credential rows must be preserved. Do not print tokens or environment values.
- [ ] Deploy using the existing compose service/volume, verify healthy state, production OIDC, anonymous state/MCP rejection, public HTTPS assets and unchanged board content. Keep the pre-release backup and rollback image. Check authenticated UI without issuing a real credential.
- [ ] Mark the plan complete and report release revision, URL and token replacement instructions. Archive the managed worktree after integration and successful deployment.
