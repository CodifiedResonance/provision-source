# Claim acceptance and failed-operation recovery — staging only

This frontend pass targets the existing integrity branch and private staging preview. Production, main, backend schema/RPCs, and staging records are unchanged. No real claim mutation or replacement backend fixture was used for verification.

## Changes

- Outbox states: draft, sending, committed, rejected, uncertain; closed records preserve explicitly abandoned attempts. Legacy known validation errors migrate to rejected. A received PostgREST business rejection is deterministic; transport loss and invalid/missing responses remain uncertain.
- Exact-ID lookup adopts committed claim state through safe claim-detail/member-offer reads, without redispatch. Pending/failed lookups block replacement. Exact absence permits immutable same-ID retry. Changed values require explicit local closure and a new ID. This supersedes the earlier publication-correction policy that changed a rejected payload under its original ID.
- Saved Work explains rejected acceptance, quantity, current collection window and unchanged network state. Edit acceptance refetches the current claim and closes the previous local attempt. Discard removes only that failed local record. Raw payloads are expandable technical details. Legacy absent-but-invalid saved times are reviewed under the operation lock and cannot create an endless exact-send loop.
- Acceptance defaults to collection end, with device-local times shown consistently. Hold time must be strictly after max(server-adjusted now, collection start) and at or before collection end. Client errors focus the field; server rejection remains inside the modal. Final action says Accept & hold with quantity. Acknowledged acceptance and collection retain a visible result with freshly returned stock.
- Source Claims has all requested status filters and frozen terms; accepted/collected records persist. Today and Claims show incoming-request attention from the safe inbox. Consumer offers retain active personal request/hold state and suppress a second active request; My holds remains independently queried. Requesting does not hide an offer or reserve stock. Demand and batch-request labels explain their distinct intent. Staging email language is explicit.
- Publication regression coverage retains one batch/one publication, exact-ID recovery, persisted created lot, acknowledgement-only draft clearing, modal validation, missing unpublished offer handling, and cross-tab draft protection.

## Verification and release gate

The automated suite uses isolated IndexedDB and controlled HTTP transports with the pinned request/response validators. It covers known rejection, lost acceptance/collection responses, pending and absent operation status, immutable payloads, closure/new IDs, local discard, legacy invalid saved payloads, 20/0/20 → 20/1/19 → 19/0/19, acknowledged retries, personal state, attention and distinct demand intent. Existing publication and runtime/security checks remain in the suite.

The local browser harness exercises the actual acceptance, Saved Work recovery-card, collection, attention and personal-state components. It is excluded from the deployed build and never connects to a backend. Browser checks include field validation before dispatch, server rejection retained in-modal, Edit acceptance, durable acceptance/collection confirmation, and lost-response recovery with one acceptance dispatch.

## Backend contract limit

Pinned revision staging-20260910.1 (56 operations) supports this claim journey without backend changes. integrity_operation_v1 returns commitment metadata, not the original response body. For this pass the client adopts safe authoritative claim/offer reads and never resends a committed mutation. For recovered collection it does not invent the original movement_event_id; for unrelated operations without a corresponding safe result reader it retains the committed receipt and directs the operator to current state. Exact historical response/receipt reconstruction without replay would require a backend extension for the Supabase agent; it is not a blocker to continuing this acceptance/collection journey.

Job 2 is NOT complete. The approved tester must resume the existing 1kg request on the existing 20kg potato offer: accept → consumer sees 1kg held and 19kg available → fully collect → 19kg physical / 0 held / 19kg available. Do not replace those records, manually accept them, or claim the real-device release gate from mocked evidence.
