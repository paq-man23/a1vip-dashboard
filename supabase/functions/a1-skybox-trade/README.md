# Skybox inventory actions

Implemented for administrator accounts: fresh inventory inspection; exact-ticket sales; timed consecutive-seat holds; asking-price changes; marketplace broadcast changes; and read-only reconciliation after an uncertain response. Regular staff cannot access this endpoint. Existing Skybox credentials are decrypted only on the server.

## Rollout and permissions

Deliver through review of this PR. Apply prerequisite Skybox sync/rate-limit migrations (also included as source parity with the already deployed backend), then `skybox_inventory_actions`. Deploy this directory as `a1-skybox-trade` with gateway JWT verification disabled: the handler verifies bearer tokens with Auth and current administrator membership; its service-only SQL repeats live session, activity and membership checks. No anonymous action or service key is shipped to the browser.

Trading starts **disabled**. Read-only inspection and previews work before enablement. Before enabling live actions in Admin, obtain confirmation that this application/account may use the write endpoints below and perform a separately approved controlled acceptance test or use a Skybox test account. This implementation was tested with synthetic fixtures only; read credentials do not prove write entitlement. Do not enable trading or create a test sale as part of deployment. Permission denial is surfaced without returning provider bodies.

The Admin approval switch is an explicit application gate, not a substitute for provider authorization. Both enabled trading and enabled sync are required at confirmation. Every action also requires its own checkbox and Confirm button. No email, ticket delivery, payment processing, checkout, forced invoice, inventory split, or automatic hold override is invoked.

## Provider contract (official OpenAPI, inspected November 7, 2026)

Source: https://skybox.vividseats.com/services/openapi.json

- `GET /inventory/{inventory-id}`, `/inventory/{inventory-id}/tickets`, `/events/{event-id}`, and `/holds?inventoryId=...` verify the live snapshot. `GET /customers/{customer-id}` verifies the chosen existing Skybox customer. A1-only contacts must first be established in Skybox; no customer is silently created.
- `POST /invoices`: customerId, accountId, externalRef and INVENTORY lines containing the exact ticketIds as itemIds and the total line amount. Never uses force. Read back `/invoices/{invoice-id}` and line tickets when itemIds are omitted. Verify account, external reference, customer, ticket identity, price, extra charges and payment/balance consistency before creating the local invoice.
- `POST /holds`: inventoryId, customerId, quantity, lowSeat, expiryDate and externalRef. Read back and verify exact seats and expiry. Holds are restricted to consecutive numeric seats, 1–30 minutes. Existing holds must be resolved in Skybox; no hold is forcibly deleted or invoiced.
- `PUT /inventory/{inventory-id}` changes listPrice while preserving the provider's full current object and version. Read-only flags are omitted. Do not log this payload: server-held provider ticket data may be present. Verify listPrice by GET afterward.
- `PUT /inventory/bulk-update` uses a single inventory ID and only the requested broadcast boolean, without force or unrelated fields. Read back inventory afterward.

All trade requests share a private 1.1-second outbound reservation. HTTP 429 extends this reservation using Retry-After. No write request is automatically retried, including HTTP 429, HTTP 5xx or a timeout. The existing sync worker retains its independent published inventory-list pacing. Per-account/application limits may differ; a 429 leaves the action for review instead of attempting a new write.

## Duplicate and stale-sale protection

A two-minute preview stores only a safe inventory projection and canonical intent. A unique active-order index fences the listing across administrators. Confirmation is tied to the creating administrator, current session, exact preview and fingerprint; current inventory/tickets/holds are fetched again. Provider version is preserved for price updates. The database claim occurs once before dispatch. Another click, browser retry or a second administrator cannot redispatch the same order.

After a possibly dispatched write, ambiguous responses keep the operation locked as uncertain. A crash can leave executing; reconciliation waits at least two minutes before investigating. Sale/hold reconciliation looks up the deterministic `A1-<order UUID>` external reference and reads the provider record; it never POSTs again. Absence from search is not proof that a write failed, so an unconfirmed result stays locked for manual Skybox review. Disabling live writes prevents new submits but allows safe reconciliation of prior operations.

## Invoice identity

A confirmed sale creates a shared A1 dashboard invoice using the existing Skybox import function and `inv-skybox-invoice-<provider ID>` identity. The Skybox invoice number is retained, consistent with other imported invoices. It does not allocate a second A1 invoice number or create a duplicate when regular sync later imports the same sale. Provider-reported payments are reflected in the local status/credit/balance; the app does not collect payment itself. Existing edit/conflict protection remains in effect.

If the provider sale succeeded but local persistence failed, keep provider_confirmed and offer Reconcile. Finalization is transactional and idempotent. It must not resend the provider sale. A number/import conflict requires Admin import-conflict review. Cached listing availability is invalidated after completion until the sync refreshes it.

## Validation

`npm test` includes backend request/state-machine tests, DOM tests and the SQL authorization/concurrency/invoice integration suite. The local PostgreSQL harness substitutes Vault for authorization/data-flow tests and does not test encryption. Desktop browser QA uses an isolated synthetic preview with no provider access. Mobile visual QA and an authorized live/test-account acceptance transaction remain required before enabling production writes.
