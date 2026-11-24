# Provision

Provision connects people who have food (Sources: traders, growers, bakers, market stalls) with people who want it. A Source says what is true today, people reserve it for collection, and the Source accepts, packs and hands it over.

This repo is the single source of truth: the app, the database contract and the history.

## What's here

| Path | What it is |
| --- | --- |
| `index.html`, `manifest.webmanifest`, `service-worker.js`, icons | **Provision Source**, the trader-facing PWA. Static, deployed from the repo root on GitHub Pages. |
| `supabase/migrations/` | The database contract, applied in filename order. |
| `archive/` | Retired code kept for reference. Not deployed. |

## The database

One Supabase project: `qaaskvbhssonbktdjdki` (eu-west-2). The older paused project `aumcpvepxeytfiqhsmwf` is no longer used.

**Core tables**

- `source`, `source_member` (`member_role`: owner, admin, editor, viewer), `source_profile_event` (append-only profile history)
- `food`, `lot`
- `provision_event`: the append-only ledger of what a Source says is true. A trigger projects the latest state into `current_offer`.
- `current_offer`, with the `current_offers` view for browsing (includes `available_to_claim`)
- `claim`: a reservation or pre-order with a collection window. It moves through requested → accepted or declined → fulfilled, or is cancelled.
- `demand_signal`: what people nearby want, summarised for Sources at 3, 5 and 10 km behind a privacy threshold
- `evidence`: photos and PDFs in the private `provision-evidence` bucket

**Functions the app calls** (signed-in users; each checks membership itself)

`create_source`, `update_source_profile`, `update_source_business_profile`, `set_source_active`, `request_claim`, `respond_to_claim`, `cancel_claim`, `fulfil_claim`, `upsert_demand_signal`, `cancel_demand_signal`, `get_source_demand_summary`

Browsing `current_offers`, `source_profiles`, `food` and `public_evidence` works without signing in. Everything else is gated by row-level security.

## Deploying

- **App:** push to `main`; GitHub Pages serves the repo root. The deployed URL must be listed under Supabase → Authentication → URL configuration for magic-link sign-in. Bump `CACHE` in `service-worker.js` whenever `index.html` changes.
- **Database:** add a new file to `supabase/migrations/` and apply it. Never edit a migration that has already been applied.

## History

- **Aug 2026:** foundation, provenance, then Network Expansion 04 (claims, demand, evidence, business profiles).
- **Sep–Nov 2026:** an "integrity" test harness was built over the core: account closure and erasure, a review queue, a pilot email system, ops monitoring and scheduled jobs running every minute. All its data was synthetic.
- **24 Nov 2026:** cut back to core (`20261124_cut_to_core.sql`). Before removal, every definition and all the data were copied into the locked schema `archive_20261124` in the same database. The edge function sources are in `archive/integrity-edge-functions/`. The integrity edge functions on Supabase are closed stubs that return 410 and can be deleted from the dashboard.
