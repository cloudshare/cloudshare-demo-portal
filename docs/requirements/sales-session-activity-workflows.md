# Sales Session Activity workflow contract

Session Activity is a read-only, Customer-scoped projection. The repository
selects safe metadata columns, groups complete correlated histories behind the
workspace read interface, and returns safe `activityGroups` DTOs; React never
regroups raw activity. Correlation is the only workflow anchor. Independent
correlations and legacy uncorrelated rows remain separate.

Workflow outcomes are truthful: terminal failure wins, terminal success with a
failed child is `mixed`, and a correlated history without a terminal business
row is `incomplete`. Protected messages, headers, provider identifiers, and
request/response bodies never cross the ordinary API. Support navigation uses
only the encoded correlation ID and never performs a provider call or write.

The repository uses a bounded 5,501-row probe, groups complete histories before
applying a 100-workflow presentation limit, and reports typed `hasMore` metadata.
When the source probe is capped, the total is intentionally unknown and every
displayed workflow is marked incomplete; when source scanning is complete, an
exact workflow total is reported if presentation is capped.
Ordering is deterministic ISO UTC. This preserves all independent Sales
operation, Experience, and attention status dimensions and does not mutate
lifecycle state.
