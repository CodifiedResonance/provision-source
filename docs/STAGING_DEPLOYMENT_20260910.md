# Provision staging deployment handover — 10 September 2026

Both isolated private deployments succeeded. Backend pin: `staging-20260910.1`, wire `1.0.0-draft.1`, 56 operations, SHA-256 `f527526d4598ca119f6d31ccaa17f999d135664a46025b90a7f92ca2b98bccad`.

| App | Actual staging link | Exact sign-in return address | Deployed GitHub commit |
| --- | --- | --- | --- |
| Consumer | [https://provision-consumer-staging.teezel.chatgpt.site](https://provision-consumer-staging.teezel.chatgpt.site) | `https://provision-consumer-staging.teezel.chatgpt.site/` | [`f724bd37c658da903a673b798ea6db0875e3664a`](https://github.com/CodifiedResonance/food-freshness/commit/f724bd37c658da903a673b798ea6db0875e3664a) |
| Source | [https://provision-source-staging.teezel.chatgpt.site](https://provision-source-staging.teezel.chatgpt.site) | `https://provision-source-staging.teezel.chatgpt.site/` | [`c4e6f28eadadcb9f0dea7e46d14fcacf693b66a0`](https://github.com/CodifiedResonance/provision-source/commit/c4e6f28eadadcb9f0dea7e46d14fcacf693b66a0) |

## Approved tester access

1. Drew opens either link while signed into the same ChatGPT account that owns these Sites. Hosting is owner-only; another ChatGPT account is not currently an allowed viewer. These are hosted private deployments of staging apps, not replacements for either existing live PWA.
2. Inside the PWA, select **Sign in** and use the already approved synthetic Supabase email/password for staging project `qaaskvbhssonbktdjdki`. The backend operator supplies those credentials privately through the approved account channel. ChatGPT hosting sign-in does not grant a Provision role.
3. The consumer account can open its own holds and private interest. The approved Source owner/admin/editor account discovers its memberships from the backend; viewers get read-only Source controls. An account with no membership must have its approved synthetic role assigned by the backend operator. No Source IDs or roles are fabricated in the frontend.
4. An additional approved tester needs explicit hosting viewer access as well as an approved synthetic Supabase account. No extra viewers were invited in this task. Do not share owner credentials or put test passwords/tokens in chat, code or public CI.

## Auth return handoff

The exact addresses above are the root return routes handled by each PWA. Pass these two literal HTTPS addresses, including the trailing slash, to the backend Auth redirect allowlist; do not use Production or wildcard redirects. This task did not verify or change the backend Auth allowlist. The current approved password sign-in is independent of email return redirects. PKCE link exchange exists at the root and rejects unusable/expired links, but externally delivered Auth email, allowlist acceptance and real return-link journeys remain unverified. External claim/email delivery stays disabled.

## Evidence and limits

- GitHub CI passed for the exact deployed consumer commit: [run 34483743755](https://github.com/CodifiedResonance/food-freshness/actions/runs/34483743755).
- GitHub CI passed for the exact deployed Source commit: [run 34483762958](https://github.com/CodifiedResonance/provision-source/actions/runs/34483762958).
- 30 shared Node unit/mock scenarios passed in each repository. This is one shared suite, not 60 independent scenarios. Both local configured builds, syntax/sink checks and declaration type checks passed.
- Live public identity, health and both directories returned HTTP 200 and validated against generated schemas. Runtime matched project/revision/hash, all 56 operations and `integration_ready: true`; degraded mode has enabled individual features. See public-runtime-20260910.json.
- Managed browser preview loaded the real synthetic consumer offer (20 physical / 2 held / 18 available at observation), public details, unknown location, and the private-view sign-in boundary. Source preview connected and displayed its signed-out entry screen. These observations do not substitute for the independent 20/3/17 acceptance journey.
- No protected synthetic-account runner file was available, so this task did not execute authenticated operator/claimant/reviewer journeys. Physical Android/iPhone install checks, measured mobile performance, delivered hosting headers, email return acceptance, full restore and remaining A01–A19/product scope are not certified. See INTEGRATION_20260910.md and A01-A19.md.
- Deployment success is confirmed by native hosting status. The managed browser checked the internal preview; it did not navigate the deployed private URLs or attest delivered CSP/security headers.

## Deployment provenance and rollback

Each saved version is version 1, built from and tied to the full deployed SHA above, also pushed unchanged to its Sites source branch. GitHub handover-only follow-up commits are documentation; they do not change the deployed application SHA. Both PRs remain drafts, with no merge into the GitHub main branches. The separate Sites source repositories use their own main branch.

The exact version IDs in deployment-status-20260910.json can be republished to restore this known staging build. This is the first version for each new isolated site, so no earlier hosted version exists and no rollback rehearsal is claimed. The original live PWA deployments remain unchanged. Backend recovery scripts/migrations are owned by the backend handover and were not deployed here.
