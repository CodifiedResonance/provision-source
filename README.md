# PROVISION SOURCE — Live Network v3

This build is wired to the Provision Network Supabase project.

## Before deploying
Run `20260828_provision_provenance_location.sql` once in the Supabase SQL Editor. It adds the source-profile/location RPC and public-safe provenance fields used by both PWAs.

## Deploy
1. Upload every file in this folder to the GitHub Pages repository root for Provision Source.
2. Commit to `main` and keep GitHub Pages on `main` / root.
3. Keep the deployed Source URL in the Supabase Auth redirect allow-list.
4. Reload the installed PWA after Pages redeploys. The service-worker cache has been bumped.

## v3 changes
- `Unit` is now `How is this counted?`.
- Food-aware defaults: courgette/tomato/fish → each; potatoes → kg; eggs → dozen; bread → loaf, with sensible alternatives.
- Evidence wording is now `Source declared`, not `Producer verified`.
- Source setup can capture address/locality and automatically resolve a postcode to coordinates; an existing source with a postcode and missing coordinates is repaired on load.
- Source publishes explicit provenance metadata (`source_direct`) so the consumer can say how the update reached the network without exposing the individual user identity.

No service-role or secret key is included.
