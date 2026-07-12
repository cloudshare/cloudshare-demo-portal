# ADR-006: Customer-configured workspace routing

**Status:** accepted (2026-07-12)

## Decision

Portal administration is selected from a Customer's persisted workspace configuration, not from
its name, slug, email domain, or a distinct admin role. The supported workspace values are
`certification`, `sales`, and `both`. An existing `admin` user authenticates through the shared
portal login and is routed to the configured workspace for that user's Customer.

The seeded Certalis Customer is configured for `sales`. Its Sales Admin uses the existing
`admin` role and lands in an intentionally empty Sales workspace. The seeded Helios CX Customer
is configured for `certification` and continues to land in its certification administration.
`both` is retained as a configuration value for a future workspace chooser; it must not rely on a
brand-name conditional.

All reads and writes, including sessions, CloudShare Connection lookup, Audit Trail entries, and
Diagnostic Log Entries, remain Customer-scoped. A Certalis Sales Admin is not a cross-Customer
administrator and cannot inspect Helios CX certification records. Certalis can connect and test
its own CloudShare Connection through the same encrypted, per-Customer pattern as Helios CX.

## Consequences

- The portal continues to use the existing `admin` role; no `sales_pro` role or user-management
  surface is introduced by this slice.
- Routing is a customer configuration concern at the authenticated boundary, so subsequent sales
  capabilities can be added without weakening Customer isolation.
- The Sales workspace is an entry point, not an implementation of Sales Opportunities or Sales
  Experiences. Those future concepts remain distinct from Exams and Cohort Exam Sessions.
