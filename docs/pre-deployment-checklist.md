# Pre-Deployment Hardening Checklist

**Status:** Deferred — revisit before real customers go live, not before. None of these block current development.

Found during a 2026-08-14 review of current practice against industry standard. Captured here so they aren't lost, not because they're urgent today.

## Repository / process

- [ ] Turn on branch protection on `main` (require review + passing CI status checks before merge). Currently unprotected — confirmed via `gh api repos/.../branches/main/protection` → 404.
- [ ] Add pre-commit hooks (husky + lint-staged) so lint/typecheck run before a commit exists, not only in CI afterward. Currently absent.

## Dependencies

- [ ] `npm audit fix` for the `nanoid` advisory — non-breaking, safe to apply any time.
- [ ] Plan a deliberate Next.js major-version bump to resolve the `postcss`/`sharp` advisories. These only fix via `next@16`, a breaking change — needs its own review, not a drive-by fix.

## Infrastructure

- [ ] Move the login rate-limiter (`src/lib/auth/rate-limit.ts`) from in-memory to a shared store (e.g. Redis/Upstash). Correct for a single process today (and documented as such in the code); will silently stop enforcing correctly the moment there's more than one server instance.
- [ ] Give the test suite an isolated/ephemeral database instead of the shared dev database. Two separate flaky-test incidents during the i18n branch's merge traced directly back to concurrent test runs (a stray worktree, a stale assertion) colliding on shared state — not a one-off.

## Testing

- [ ] Add E2E coverage for at least the critical path (login → create receipt → appears in history). Explicitly deferred at MVP stage as a deliberate scope call; worth revisiting before real money moves through the app.

## Deployment itself

- [ ] Nothing has been deployed anywhere yet. This whole list assumes a "before deployment" checkpoint — schedule that checkpoint before assuming any item above is done.
- [ ] Deploying to an environment with existing logged-in sessions: pre-existing JWTs were minted before `role` existed in the session, so an already-logged-in Owner's token has `role: undefined` until it naturally expires (up to 24h) or they re-authenticate — during that window `assertOwnerRole` fail-closes (403/redirects them away from Settings). Rotating `AUTH_SECRET` at deploy time forces a clean re-login for everyone and closes this window immediately; if that's undesirable, this needs a documented step in the deploy runbook instead. Not an issue for this project today since nothing has been deployed anywhere yet, but must be decided before the first real deploy.

## Auth / RBAC

- [ ] Deactivating a Cashier blocks their next login but does not revoke an already-active session — a deactivated Cashier who was already signed in keeps access for up to 24h (the JWT's `maxAge`) until their token expires. Accepted tradeoff for now (a real fix needs a per-request DB check, which this branch deliberately avoids for cost/latency reasons); revisit if this risk profile changes.
