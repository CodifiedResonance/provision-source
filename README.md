# PROVISION SOURCE — Live Network build

This package is wired to the Provision Network Supabase project.

## Deploy
1. Upload every file in this folder to the GitHub Pages repository root for Provision Source.
2. Commit to `main` and enable GitHub Pages from `main` / root.
3. Copy the final deployed Source URL.
4. In Supabase Authentication URL Configuration, add that exact Source URL to the redirect allow-list.

## Live flow
- Email magic-link authentication.
- First authenticated user can create a source through the database `create_source` RPC.
- Existing source owners load their current network state.
- `Publish changes` appends rows to `public.provision_event`; it never edits the ledger.
- The database projection trigger updates `public.current_offer`.
- Consumer Provision sees those changes through `current_offers` + Realtime.

The Source UI currently publishes foods already present in the network ontology. The first seeded foods are Courgettes, Potatoes, Tomatoes, Eggs, Red snapper and Bread.

No service-role or secret key is included.
