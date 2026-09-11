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

The repository uses a 5,501-row probe and presents at most 5,500 rows after
grouping, marking incomplete history explicitly when the probe finds more.
Ordering is deterministic ISO UTC. This preserves all independent Sales
operation, Experience, and attention status dimensions and does not mutate
lifecycle state.
