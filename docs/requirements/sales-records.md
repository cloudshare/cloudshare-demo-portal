# Sales Accounts, Opportunities, and Contacts

Issue #345 adds local, Certalis Customer-scoped commercial records to the Sales Workspace. It is intentionally not a CRM, Salesforce synchronization, CloudShare Sales Experience, or any CloudShare operation.

- An Account is classified as a `prospect` or `current_customer`.
- An Opportunity belongs to an Account and has independent commercial status: `open`, `won`, or `lost`.
- Accounts, Opportunities, and Opportunity Contacts are archive-only. The API exposes no hard-delete operation, and archive only preserves local history; it cannot affect a CloudShare Experience. Every record retains `createdAt` and nullable `archivedAt` timestamps.
- Opportunity Contacts retain first name, last name, and email for later Sales Demo Session selection.
- All Sales routes require an authenticated admin whose Customer workspace is `sales`; handlers always use that session's Customer ID for reads and writes. Mutations append Customer-scoped audit and diagnostic evidence using the `local_sales_records` integration surface.

The UI calls these typed, framework-agnostic handler-backed routes:

- `GET` / `POST` `/api/sales/accounts`
- `PATCH` `/api/sales/accounts/:accountId`; `POST` `/archive`
- `POST` `/api/sales/opportunities`; `PATCH` `/api/sales/opportunities/:opportunityId`; `POST` `/archive`
- `POST` `/api/sales/contacts`; `PATCH` `/api/sales/contacts/:contactId`; `POST` `/archive`

The workspace is a URL-backed drill-down: an Account selection reveals only that Account's
Opportunities, and an Opportunity selection reveals only that Opportunity's Contacts. Each grid
defaults to active records and provides explicit Active, Archived, and All filters, ISO-style UTC
lifecycle dates, sorting, result counts, and pagination-ready presentation. Record creation and
editing use a compact modal; no inactive bulk-operation controls are shown.

An archived Account cannot receive a new Opportunity or become a reparenting target. Likewise, an
archived Opportunity cannot receive or become a reparenting target for an active Contact. A denied
operation returns a deliberate conflict response and writes Customer-scoped audit and diagnostic
evidence. Historical edits may retain an archived record's existing archived parent.
