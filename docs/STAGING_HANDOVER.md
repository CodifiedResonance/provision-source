# Provision integrity staging checkpoint — 8 September 2026

**Decision: NOT READY for release. Job 2 is incomplete.**

Historical checkpoint report. See `GITHUB_PROGRESS.md` for the subsequent remote recovery, CI and engineering changes; the transport and first-page-only statements below describe the earlier checkpoint.

This is a reviewable implementation checkpoint, not a deployed staging consumer or frontend acceptance certification. Production, the original root PWA files, historical SQL and the live branches have not been changed. No backend requests, synthetic users, emails, database migrations or ingestion were executed by this frontend task.

## Repository baseline

| Repository | Main / latest public GitHub Pages deployment SHA observed |
| --- | --- |
| CodifiedResonance/food-freshness | `24ec8475e0408497f2158a0a3381605da8c52b41` |
| CodifiedResonance/provision-source | `99df392d42c6f4cea98a64c22ba012f0599638df` |

Both repositories are public, use `main`, and report Pages enabled. The Source deployment status also confirmed `https://codifiedresonance.github.io/provision-source/` as successful on 30 August 2026. Consumer environment URL retrieval failed and remains unverified. Their checked-out files match the supplied consumer v5 and Source v4 archives. The public deployments endpoint reports the SHAs above. The Pages configuration endpoint returned 404 without authenticated access; custom domains, exact Pages source settings and redirect allow-lists are not verified. No CNAME or deployment workflow was present in either checkout. Repository names are confirmed by the owner; no rename was assumed.

Local work is on `integrity/staging-20260908` in each repository. The GitHub connection was confirmed by the user, but no authenticated GitHub tool was exposed to this execution. A non-mutating `git push --dry-run` failed because no Git credential was available. Therefore remote branches, PRs and CI execution are NOT CREATED/NOT RUN. The delivery manifest records the actual local commit SHAs and archive hashes.

## Contract

- Staging only: `https://qaaskvbhssonbktdjdki.supabase.co`.
- Wire version `1.0.0-draft.1`; document revision `staging-20260908.3`.
- Exact contract SHA-256: `709f13cff71043d52344f03e6dcb04e2db1cdb99efeb0abfed0064bebbe06726`.
- Backend archive SHA-256: `7c4b0da4d6a8a9ff031957e7748401ba762f6e10a79df3ecdfbce52b0498a90f`.
- Both hashes independently verified. Only the reviewed JSON contract, generated types and checksum were copied into the repos; the private backend checkpoint was not copied wholesale.
- All 44 RPC schemas generate 88 CSP-compatible request/response validators at build time. RPC calls use `{p_request: ...}` and stable PostgREST business errors. Unknown values remain null. Replay timestamps never reset the fresh-read server clock.
- Health currently has no document revision/checksum field. Build pinning and response validation cannot establish that an unfrozen server with the same wire version has unchanged semantics. Backend contract freeze remains mandatory.

## Implemented in the isolated staging source

- Vanilla ES modules and a reproducible Vite build; exact SDK/dependency versions and lockfiles. Existing root files remain the known-good baseline. Only `dist/` is deployment output.
- DOM creation/textContent, no interpolated event handlers, strict CSP metadata and host `_headers`, no remote moving SDK. Build validation rejects privileged keys and a Production legacy anon JWT.
- Consumer offer page, search, explicit empty/error/setup states, trusted physical/held/claimable values, prices, physical dates, provenance, independent My holds, cancellation, notices, report intake, evidence gateway preview, and opt-in private demand form where an approved area catalogue is supplied.
- Source catalogue flow, same/new batch, reconfirmation, physical count zero, retirement, basic profile edit/pause, claim response/collection flows, and private evidence upload/finalization/public-sharing steps. These are code paths awaiting actual staging execution.
- IndexedDB server snapshots, versioned drafts, per-operation outbox and attachment blobs. Account/Source keys are separate. Refresh does not clear drafts. Cross-tab draft conflicts are detected with atomic local version checks. A stable operation and its exact payload are reused for response-loss retries and repeat submissions; unresolved operations cannot be replaced by changing their quantity.
- Independent per-operation acknowledgements; recoverable evidence blobs after stock publication. No automatic reconnect publication. Old unsent operations require review. Source publication resumes the same create-lot and publish IDs.
- `public.integrity_change` invalidates safe reads; foreground/reconnect, bounded polling and server expiry timers reconcile state. Synchronous auth callbacks schedule network work outside the callback. Minimal claim/demand intent is retained within the initiating browser and requires fresh review after sign-in.
- App/scope-specific staging service-worker caches, complete hashed shell, rejection of failed precache responses, no API/private evidence/callback caching, user-selected updates, and installation help.

## Verification performed

Run `npm ci --ignore-scripts`, then `npm run check`, `npm run typecheck`, `npm test`, and `npm run build`.

`check` covers syntax, prohibited executable sinks/raw-table access, original migration checksum, manifest identity and actual PNG dimensions. `typecheck` validates the supplied contract declarations; it does **not** type-check all application JavaScript. `npm audit` returned zero known vulnerabilities at this checkpoint. CI uses commit-pinned actions, read-only permissions and immutable build artifacts; it has not run on GitHub.

The final shared suite passes **21 tests in each repository** (the same suite copied to both, not 42 independent scenarios). The executable tests use Node, fake IndexedDB, fake locks/transports and the real generated service-worker handlers. They cover null/unknown/bundle/precision semantics, excluded data classes, replacement after rename/location removal, draft/file survival across reopening and server replacement, local concurrent draft conflicts, quota failure, exact lost-response replay, repeated submissions, account isolation including a mid-save account switch, stale-operation review, role denial, schema incompatibility and bounded expiry/invalidation.

These are local assertions, not real independent backend-account tests. The backend's accumulated 83 assertions are not re-counted as frontend tests. The required full `20kg → request 3kg → accept → collect → retry = 17/0/17` sequence remains NOT RUN against staging.

The supervised development server started successfully. The supported cloud browser failed to navigate to it with `ERR_BLOCKED_BY_CLIENT`, while the preview service reported running. Browser acceptance, rendered screenshots, mobile performance, real Android, Safari and installed contexts are NOT RUN. No alternate browser-control path was used. The generated JS bundle still needs mobile parsing/performance measurement and further splitting if necessary.

## Actual blockers and remaining engineering

1. Supply the staging publishable key through local/build configuration and approved synthetic-account access through a protected runner. No credentials or sessions have been inferred or copied from another task. The supplied build intentionally opens in a setup-pending state until configured.
2. Resolve the contract gaps in `BACKEND_GAPS.md`. Source choices, food choices and demand areas are empty intentionally. No private-table workaround was written.
3. Source conflict **detection** exists; full non-conflicting merge/rebase UX still needs completion. The current first catalogue page does not implement complete pagination, direct offer lookup, member role discovery, history export or the whole profile/physical-date correction form. Some submitted-operation errors require reconciliation through Saved work.
4. Complete Source public share messages and QR/print sign, history export, evidence redaction and withdrawal refresh while an image is visible, report review/appeal queue UI, private demand listing/cancellation reconciliation, and old-worker migration. A basic print view and member catalogue JSON export exist but do not satisfy the entire requirement.
5. Port the map and quantity-aware basket/source-combination experience onto the trusted contract. The old invented route scoring is excluded from the new staging build; the replacement feature is not implemented. No paid routing is configured. A pure candidate cap helper is not a completed route engine or performance certification.
6. Complete auth return/expired-link, multi-tab/session/revocation, actual upload/finalization failures, local storage eviction/quota, notifications, recall and all-stock-held tests in browser and staging. Do not rely on Node mocks for these gates.
7. Push the two integrity branches using authenticated GitHub access, run CI, and deploy the **configured and tested** staging build to an isolated origin with headers. A public preview has not been deployed in this checkpoint.
8. Job 1 restore/email/policy/contract-freeze gates and later coordinated Production approval remain in force.

## Recovery-runner feasibility

Node, npm and Git are present. Docker, the Supabase CLI, psql, pg_dump and pg_restore are absent. No protected database credential injection or isolated recovery target is configured. This environment has not demonstrated a usable full recovery runner. No tools were installed for recovery, credentials loaded, database reset, or restore attempted.

## Next bounded step

Restore authenticated repository write access, supply staging runtime configuration, and obtain the backend's explicit directory/roles/contact/actionable-claims response. Then finish the member/consumer flow against that exact revised contract, run real-role browser acceptance and produce the isolated staging preview. Keep this checkpoint's archives away from existing Production root uploads.
