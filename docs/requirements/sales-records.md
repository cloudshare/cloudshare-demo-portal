# Sales Accounts, Opportunities, and Contacts

Issue #345 adds local, Certalis Customer-scoped commercial records to the Sales Workspace. It is intentionally not a CRM, Salesforce synchronization, CloudShare Sales Experience, or any CloudShare operation.

- An Account is classified as a `prospect` or `current_customer`.
- An Opportunity belongs to an Account and has independent commercial status: `open`, `won`, or `lost`.
- Accounts and Opportunities are archive-only. The API exposes no hard-delete operation, and archive only preserves local history; it cannot affect a CloudShare Experience.
- Opportunity Contacts retain first name, last name, and email for later Sales Demo Session selection.
- All Sales routes require an authenticated admin whose Customer workspace is `sales`; handlers always use that session's Customer ID for reads and writes. Mutations append Customer-scoped audit and diagnostic evidence using the `local_sales_records` integration surface.

The UI calls these typed, framework-agnostic handler-backed routes:

- `GET` / `POST` `/api/sales/accounts`
- `PATCH` `/api/sales/accounts/:accountId`; `POST` `/archive`
- `POST` `/api/sales/opportunities`; `PATCH` `/api/sales/opportunities/:opportunityId`; `POST` `/archive`
- `POST` `/api/sales/contacts`; `PATCH` `/api/sales/contacts/:contactId`
