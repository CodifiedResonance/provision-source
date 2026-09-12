> September 10 update: see [revised integration status](INTEGRATION_20260910.md). Earlier checkpoint statements below are historical; full acceptance remains open.

# Staging build and later hosting

## Build

Use Node 24, `npm ci --ignore-scripts`, `npm run check`, `npm run typecheck`, `npm test`, then `npm run build`.

Provide only `VITE_STAGING_PUBLISHABLE_KEY` from staging in an ignored local `.env.local` or the host's build environment. A publishable key is a public client credential, not privileged authority. Never add test-account passwords, JWT sessions, service-role keys or database passwords to Vite variables. The build rejects known secret-key formats and legacy anon JWTs for another project before bundling.

`dist/` is root-flat static upload output with hashed bundled code, original identity assets, a **STAGING** manifest, generated scoped service worker and `_headers`. It excludes the historical SQL and backend operational evidence. The downloadable archives in this checkpoint contain no configured staging key and therefore show setup pending.

Do not upload these archives over either existing live Pages root. The untouched original files retain their prior behavior, including known audit defects. Keeping them as a baseline does not certify them safe.

## Suitable next hosting path

Cloudflare Pages is a candidate for separate static consumer and Source origins with a GitHub integration. Expected frontend hosting cost for this static pilot on the free plan: $0/month within platform limits, excluding Supabase, email, domains or later Functions. Static asset requests are free and unlimited ([Cloudflare pricing](https://developers.cloudflare.com/pages/functions/pricing/)); free projects have file/build limits ([Pages limits](https://developers.cloudflare.com/pages/platform/limits/)). `_headers` supports host-applied CSP and related headers ([headers documentation](https://developers.cloudflare.com/pages/configuration/headers/)). No account was created, integration connected, deployment made or paid service introduced.

GitHub remains version control. Its published Pages policy restricts commercial business/transaction/SaaS hosting ([GitHub additional product terms](https://github.com/github/docs/blob/main/content/site-policy/github-terms/github-terms-for-additional-products-and-features.md)). Confirm final service eligibility with the selected provider before commercial cutover.

Owner decisions later: hosting account ownership, two exact staging origins, eventual domains, DNS control and migration window. Use provider subdomains for staging so current domains need not move. Protect staging appropriately; a TEST banner and `noindex` are not access control.

## Redirects, CSP and origin changes

Once staging origins exist, provide their exact trailing-slash callback URLs to the Supabase operator; allow only those on staging. Do not use wildcard Production redirects. Validate PKCE callback links in the initiating browser and the different-browser recovery message. The current password flow is for approved synthetic accounts; it is not proof of real external email delivery.

The CSP allows only the pinned staging HTTPS/WSS origin and local assets/blob image previews. `frame-ancestors`, MIME enforcement and the other headers require the host `_headers` file; the HTML meta policy cannot provide all response headers. Test actual header delivery, auth, Storage gateway and Realtime before acceptance.

New origins do not inherit old sessions, installed PWA identities, drafts or attachment blobs. Inform operators to resolve/review pending work at the old app before migration, sign in on the new origin, and deliberately install the new PWA. A user-consented, validated private draft/file transfer tool is still to be built; do not instruct users to paste session tokens or assume a browser origin move transfers their work.

The old-surface migration notice and the legacy workers' safe update are deferred to coordinated release; neither live surface has been edited. Never clear origin-wide caches, storage or worker registrations.

## CI and rollback

The integrity workflow runs checks/tests/audit/build on integrity pushes and PRs and saves an immutable build artifact. It deploys nothing and runs no SQL. Authenticated GitHub write access and a successful remote CI run are still required.

After real staging acceptance, configure host Git integration to build the explicit integrity/staging branch with `npm ci --ignore-scripts && npm run build`, output `dist`. Keep Production branches/environment variables separate. A push can then replace manual file uploads.

Retain the previous immutable static artifact and its contract compatibility record. Roll back only to a contract-compatible frontend; otherwise fail closed/read-only. Do not roll back backend state, restore old snapshots over new ledger events, rerun historical migrations or reopen unsafe writers. An actual hosting rollback rehearsal is NOT RUN here.
