# Skybox migration

The dashboard's Admin → Import from Skybox reads the original customer, vendor, invoice, and purchase Excel (.xlsx) or CSV exports. Files are parsed locally. Nothing is uploaded until staff reviews the preview and chooses Import Reviewed Records.

Select all four export files together so customer/vendor information is available during document conversion. Required Skybox headings are detected automatically. Download Full Review includes every converted record, original source field, warning, and validation error; the dashboard shows the first 30 records. Files are limited to 15 MB, 20,000 rows per sheet, and 60 MB of extracted workbook XML. Blank or duplicate headings and invalid essential financial values block import.

Customers and Vendors have searchable shared directories and an invoice editor picker. Same-name contacts stay separate by source ID. An invoice/purchase name is linked only when exactly one matching contact exists. Customer credit remains reference information; it is not silently applied to invoice balances. Vendors can populate new purchase orders. Shared customer/vendor selectors also fill form-letter recipients and emails, select itinerary talent, and append trip contact names, both phone numbers, emails, and available addresses without erasing existing notes. Hotel, rental-car, and flight entries have vendor selectors that fill the property/company/airline and append contact details to booking notes. Selected values remain editable and are persisted through each document’s existing Save action.

Invoice reports lack sale quantities, seating, individual sale prices, and tax breakdowns. Converted invoices explicitly contain one summary line rather than fabricated ticket details. Skybox Invoice Total is the gross total; the report's shipping is separated without increasing that total. Credit / Amount Paid is the total-minus-outstanding-balance adjustment, not an itemized payment ledger. Void records retain Void status, including negative exported balances. Literal `Invalid date` event values remain blank with a review warning. Original source fields, including internal report fields, are retained privately in the shared archive; internal purchase notes are not copied onto customer-facing documents.

Purchases become `po-ticket` documents. Ticket Cost is the total ticket cost, so unit cost is Ticket Cost / Ticket Qty. Non-Inventory Cost is a separate line. Purchase Total must match these components. Fractional unit prices can be needed to retain the exported total. Purchase-order numbers use `SB-PO-<Purchase ID>`; historical invoice numbers retain their Skybox Invoice ID.

New A1 documents receive their permanent incremental number from a Supabase sequence on the first successful Save, starting above the highest existing A1 numeric number (or at 4100). Skybox imports retain their original numbers and do not advance that initial seed. The sequence skips occupied numbers, does not reuse deleted assigned numbers, and can have gaps after failed transactions. Repeating the same first-save request returns its existing number instead of allocating another. Assigned numbers are immutable. Invoice History combines an All Sources / Skybox / A1 Dashboard filter with year filtering, newest/oldest ordering, and 50-record pages.

Imports use 50-record batches. A row failure rolls back that row, while completed rows remain. Repeat source records skip safely even after a converted invoice has been edited. A changed original with the same Skybox kind/ID is flagged and does not overwrite the first import. Invoice-number collisions preserve the converted copy under Admin → Imports Needing Review. The original source records are immutable and accessible only to approved staff through RLS.

The uploaded workbooks were used for local conversion/reconciliation checks only. They are not committed to the public repository or automatically imported into the live database. Automated tests use synthetic records and disposable Postgres; importing real records remains an explicit dashboard action.


## Weekly Mac folder synchronization

Admin also provides a Mac Folder Sync installer and shared run history. The installed helper watches `~/skyexport` every five minutes and imports new weekly exports while the Mac is awake, logged in, and online. A1 edits are protected: changed Skybox invoices update only when the stored A1 document still equals its last imported snapshot. Conflicting incoming copies remain in Imports Needing Review. The immutable first import and subsequent source revisions are retained. Updated customer/vendor snapshots feed the shared directory through a view that uses invoker RLS.

The helper signs in with regular dashboard staff credentials, discards the entered password, and stores rotating session tokens in macOS Keychain through stdin rather than command-line arguments. It uses no service-role key. It records processed file hashes, waits for stable copies, uses batches of 50, prevents overlapping local runs, and retries incomplete imports. It chooses the newest modified export of each kind; previously seen source revisions safely skip. It never deletes export files or saved records missing from a later export.

See `mac-sync/README.md` for setup, Node.js requirements, logs, removal, and native Mac verification. Publishing the installer does not activate it on JAW's computer.


## Skybox invoice fields

Invoice editors now include a separate Skybox / Internal Details panel for Vendor, Payment Reference, Non-Inventory Costs, COGS, Inventory P&L, Inventory Tags, Ticket Sales, Inventory Margin, Consignment, PO Tags, and Internal Notes. A saved-vendor selector fills the Vendor field independently of the invoice customer. Original Skybox Report Fields shows all export columns read-only. These bookkeeping fields do not alter customer totals and are excluded from the customer preview/PDF and email body.

The invoker invoice-history view enriches older imported invoices from immutable original records or the latest accepted source revision without rewriting stored documents. Edited invoice fields take precedence over report defaults and survive later saves. Source classification also handles resolved import copies. Duplicate/imported drafts created as a new A1 document receive a new database number.

Invoice Total means gross subtotal plus tax and shipping; Outstanding Balance deducts credit/amount paid. Merely saving the derived report metadata does not create a false weekly-sync conflict, while genuine changes to business or bookkeeping fields remain protected.


## Editable contact cards

Customers and vendors share an editable Rolodex. Letter tabs use the imported last name, with company/display name as the fallback. Search covers contact details, type, tags, and notes. Add Customer/Add Vendor creates a shared contact without a Skybox ID. Save Contact persists changes across devices; phone and email links open the device's configured calling/email app. Photos are resized to JPEG and stored in a private, staff-only Supabase bucket.

Staff changes overlay the latest Skybox contact, preserving imported originals and protecting locally added details from weekly imports. Unedited fields continue to receive Skybox updates. Simultaneous contact edits are rejected rather than overwriting another device's save.

Invoice contact search shows clickable matches as you type. Selecting a contact fills the invoice fields. Saving an invoice does not automatically overwrite a contact: choose **Save invoice details to contact** to update the selected contact's changed name, company, email, phone, address, or payment preference. Existing invoices remain historical snapshots.
