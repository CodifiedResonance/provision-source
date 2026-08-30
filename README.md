# PROVISION SOURCE — Live Network v4

Authenticated source surface for the Provision Network.

## This release
- Provision Source visual identity separated from the consumer PWA.
- Tap the PROVISION SOURCE identity / business name to edit the persistent Source profile.
- Auth account email is displayed separately from business identity.
- Owner/admin profile editing and pause/reactivate controls.
- Owner/admin/editor publishing; viewer read-only behaviour.
- Food-aware **How is this counted?** defaults.
- Evidence photo/PDF upload to the private `provision-evidence` bucket with `upsert: false`.
- Claims inbox with accept / decline / fulfil via Migration 04 RPCs.
- Privacy-thresholded 3/5/10 km demand summaries.
- Realtime updates for source, offers, claims and evidence.

Database contract: `20260830_provision_network_expansion_04.sql` (already applied to Production).

Deploy all files at repo root on GitHub Pages. The deployed URL must be present in Supabase Authentication redirect URLs for email magic-link sign-in.
