# Required frontend contract additions / clarifications

These are findings from the exact 44-operation `staging-20260908.3` JSON contract, not requests to reopen raw tables. No signatures are proposed as though deployed.

| Need | What the candidate actually exposes | Required backend response |
| --- | --- | --- |
| Source membership selector and viewer controls | `integrity_profile_v1` requires a known Source ID and current membership; Profile has no role | Safe authenticated membership listing with Source identity, current role and pause state; revocation semantics |
| New food selection and food-aware increments | Offers expose foods already present; no food catalogue operation | Safe food directory, identity, unit options/increments, pagination and expiry semantics |
| Confirmed demand area | Save accepts `area_id` and explicit confirmation; no approved-area discovery | Safe named coarse-area catalogue/search and exact permitted IDs |
| My demand across browsers | Save/cancel/disabled summary, no own-demand listing | Private paginated current demand endpoint |
| Actionable Source inbox | `integrity_source_claims_v1` takes only Source and Page; notes specify ascending UUID order | Server-supported actionable-first query/pagination. Do not fetch a recent subset then filter |
| Holder contact information | Claim includes Source ID and frozen terms, no food/Source display or contact instructions; Profile is member-only | Safe frozen/current display and contact information for entitled holders even after public expiry/pause |
| Direct member offer read | Catalogue pages up to 100; no direct safe offer endpoint | Documented lookup for claim actions and conflict resolution without scanning arbitrary pages |
| Full operator review | Report/review/appeal commands exist; no ordinary report review listing is specified | Permission-filtered report/appeal queue and detail read contracts |
| Exact server revision | Health has wire version but no document revision/hash | A runtime revision/capability acknowledgement that binds the client to frozen semantics |
| Publication note round-trip | Publish accepts note; Offer does not return note | Safe member presentation of the existing note so edits do not erase unseen content |

If another documented safe API already supplies any need, provide its exact versioned schema and permissions. A contract revision requires new canonical bytes, types and checksum. Do not change the pinned file silently, reuse a Production key, or give the client service-role access.
