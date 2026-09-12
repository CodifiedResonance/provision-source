# GitHub integration progress — 8 September 2026

Job 2 remains incomplete. No main merge, live-root replacement, Production action, preview deployment, backend mutation or external email occurred.

## Remote recovery verified

Both remote main branches matched the checkpoint baselines and no integrity branches existed. The surviving local bundle commits were verified; no patch was applied again. GitHub's authenticated Git data API reconstructed their complete trees exactly, with different commit metadata/IDs:

| Repository | Original local checkpoint | Remote checkpoint | Identical tree |
| --- | --- | --- | --- |
| food-freshness | c8530c9cfacf42dc3f5e9123f0eceda179c2cc5e | f7647454ec881ff16d5b3a1aae013cdf10043e52 | 7b7b4f5f4863b32289c5ba7090ec77aea1623919 |
| provision-source | d491925792baa4e311a022956b8ac694e52f2b33 | 7af5fb6d776d9005174a330c83d8876422aac48c | da6b21a8aecf180eb0f6778fdfef4e6d16ac0f6c |

The branch in both repositories is `integrity/staging-20260908`. Draft PRs: [consumer #1](https://github.com/CodifiedResonance/food-freshness/pull/1), [Source #1](https://github.com/CodifiedResonance/provision-source/pull/1). Do not merge.

Checkpoint CI passed all steps including npm install, checks, contract declaration typecheck, the 21 shared mocked tests, audit, build and artifact upload: [consumer run 34229288349](https://github.com/CodifiedResonance/food-freshness/actions/runs/34229288349), [Source run 34229308788](https://github.com/CodifiedResonance/provision-source/actions/runs/34229308788). The artifacts are unconfigured build outputs, not deployed previews. Subsequent commits have their own runs in the PR checks.

## Follow-up engineering in this commit

- Source catalogue continuation appends every requested page, deduplicates records by identity and rejects looping cursors. Refresh replaces the current catalogue; it does not create a server snapshot.
- Export re-reads the complete member catalogue and every lot/legacy history page before downloading JSON. It records the read interval and fresh-transaction limitation; account changes, cursor loops or a 1,000-page per-read budget fail explicitly without producing a partial export. This is not the disaster-recovery backup. Final agreed export-format acceptance remains open.
- Profile form includes all permitted patch fields, coordinates and multiple opening periods. Unknown coordinates stay null; a known zero stays zero; unknown days differ from closed days. Only changed fields are submitted.
- Same-lot physical-date correction has all permitted dates, date type/timezone, handling and allergen fields plus an attributable reason. It uses the dedicated revision-checked RPC, preserving prior assertions and availability semantics.
- Existing-offer publication is blocked while the candidate cannot return its publication note. This prevents erasing unseen notes while the backend gap is open.
- Four additional mocked/unit tests cover paginated exports, interrupted reads, cursor loops, limits, unknown profile values and changed-only patches. **25 shared tests pass locally in each repo**, not 50 distinct scenarios. Syntax/build pass. Browser, real-role API and device tests are still unexecuted.

The runtime contract remains wire `1.0.0-draft.1`, document `staging-20260908.3`, SHA-256 `709f13cff71043d52344f03e6dcb04e2db1cdb99efeb0abfed0064bebbe06726`. No canonical bytes were changed. Runtime acknowledgement is unavailable in this candidate. No public key or synthetic identity was supplied here.

## Backend and restricted-host handoff

The exact ten backend gaps remain in [BACKEND_GAPS.md](BACKEND_GAPS.md). The new owner attachment restates these requirements; it supplies no revised JSON, types or checksum. This runtime has no addressable existing Supabase-agent conversation or Supabase connection, so no message delivery to that agent is claimed. Share that file as the exact handoff and return the revised canonical package plus the documented protected test configuration. Never send passwords or privileged tokens through chat or Vite.

Cloudflare Pages remains the host candidate. No Cloudflare account tool is exposed; provider discovery returned no connectable result in this runtime. Account terms, actual allowance and Access availability are therefore unverified. Proposed separate project names are `provision-consumer-staging` and `provision-source-staging`, subject to account availability. They are not reserved or live URLs.

On the documented Free Pages plan there are 500 builds/month and one concurrent build. Preview URLs are public by default; enable Access before deploying configured content. Cloudflare's preview Access switch does **not** protect the root project pages.dev/custom domain. Keep that root empty and verify protection for both stable preview aliases and every hash URL; retain independent restricted backend participation. [Pages limits](https://developers.cloudflare.com/pages/platform/limits/), [preview and Access semantics](https://developers.cloudflare.com/pages/configuration/preview-deployments/).

Before any host action, connect the owner-approved Cloudflare account and inspect plan/Access controls. Publish only reviewed `dist/` to protected preview origins after supplying the staging public key through build configuration. Exchange the two exact origins with the backend operator, approve only their callbacks and verify headers/Auth/Realtime/evidence and unauthorised denial. No callback URLs have been invented or changed.

## Recovery runner and remaining scope

[RECOVERY_RUNNER.md](RECOVERY_RUNNER.md) includes an inactive no-secrets workflow/script, costs/plan caveats and proposed ownership/injection/cleanup handoff. No accessible approved private operations repository or protected gate was available. The smoke script passed shell syntax only; no capacity or restore claim is made.

All other acceptance work remains in scope: revised membership/food/area reads and role controls; direct offer/holder-contact/inbox/review reads; conflict merge/rebase and submitted-operation reconciliation; evidence redaction/withdrawal refresh; map and quantity-aware basket; public share/QR/sign; auth/revocation/expiry/notification/recall journeys; legacy worker migration; mobile performance and physical devices. The new forms and export do not close these unrelated gaps. The 20 → request 3 → accept → collect → replay real-role journey still has not run.
