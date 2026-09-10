# Sales Support workflow evidence

Sales diagnostics are an append-only, Customer-scoped investigation surface. A
CloudShare transport observation is one physical exchange attempt and carries a
stable `details.exchangeId`; retries receive new identities and cache hits do
not create observations. When a workflow correlation is available, the
workflow-enriched row is canonical. Unscoped calls use the Customer fallback.

Transport rows and semantic rows are intentionally distinct. A semantic
revalidation or final Sales outcome must carry the already-known Session
subject and explicit `details.contributingExchangeIds` when exchanges are
known. The Support API must not infer relationships from timestamps, provider
IDs, surfaces, or protected body equality.

Ordering is based on request attempt start. `details.attemptStartSequence` is a
per-client tie-breaker; `details.completedAt` and `details.durationMs` remain
separate so concurrent calls are not presented as causal. Historical rows that
only have completion-allocated ordering are labelled legacy and are not
rewritten. Bounded pages return `hasMore`, `nextOffset`, `complete`, and a
continuation hint when another page exists.

OAuth evidence is metadata-only: surface, status or bounded failure mode,
duration, ordering, and workflow/exchange identity. Credentials, Authorization
values, token bodies, and wrapped OAuth causes are never persisted or rendered.
Authorized same-Customer Support may inspect protected non-OAuth request/query
and provider-response bodies. Ordinary APIs, Activity, audit, generic logs,
browser state, candidate surfaces, and another Customer's Support response do
not receive that evidence. Filters are exact and Customer-scoped; pagination
does not merge adjacent workflows or silently discard continuation rows.
