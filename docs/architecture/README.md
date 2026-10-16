# Architecture Notes

This folder holds durable architecture planning artifacts that are not ADRs.

## Refactor Planning

- [Architecture review: CloudShare Demo Portal deepening opportunities](architecture-review-2026-06-25.html)
  was created on 2026-06-25 from Matt's `request-refactor-plan` flow. It identifies four
  refactor candidates and recommends deepening the active `ExamAttempt` runtime lifecycle first.

Use [integration-slice-protocol.md](integration-slice-protocol.md) for any slice that touches
CloudShare or another live integration.

## CloudShare Training delivery

The Training-only delivery module is the active integration seam for individual Exam delivery and
Cohort Exam Sessions. Runtime handlers load the Customer's encrypted CloudShare Connection and
retain entitlement, Blueprint Snapshot guarding, portal state transitions, auditing, and
candidate-safe HTTP responses. They then construct one Training delivery module from that
Customer-scoped client. Its public provisioning operations own the ordered individual flow
(Training → user properties → participant → sponsored link), Cohort publication (Training → user
properties), and Cohort admission (start-state gate → user properties → participant → sponsored
link). The module also owns Training reads, retirement, reconciliation support, and Guided Journey
reads; runtime handlers consume returned evidence for portal diagnostics and state updates.

The module intentionally does not define a generic Session or Experience interface and does not
reserve a Sales adapter. Sales now has a separate concrete v4 delivery adapter; its Session and
Trial lifecycles remain distinct from Training and from one another.

## Environment observation and commands

`domain/environment.ts` defines Certification state and command contracts. Commands acknowledge
dispatch; authoritative polling establishes the resulting state. HTTP method/path are optional
evidence, not requirements on an implementation. The CloudShare and simulator adapters preserve
their existing results. `domain/environment-observation.ts` defines Sales semantic readings:
named state, parsed expiry, protected exchange evidence and the existing persistence projection.
Session extension, Trial extension and Trial ending consume this interface. Eligibility, clocks,
dispatch fences, exact identity checks and recovery remain with their respective lifecycle.

The CloudShare environment module owns string/numeric normalization, owner/Project resolution,
getextended reads and expiry parsing. Certification still ignores numeric-only status for its
runtime state. Session expiry accepts ISO offset/Z and RFC GMT; Trial retains JavaScript Date
acceptance. Snapshot has no Trial persisted label, so reconciliation retains the previous label.
Session and Trial extension resolve environment IDs through owner/Project reads. Trial ending
preserves its existing behavior of passing roster environment IDs directly to getextended;
this refactor does not change that correlation path. Suspend, Resume, Archive and Extend share
a single-dispatch v3 text transport; Archive is unchanged. Certification
and Sales retain their different historical fallback evidence for clients without detailed reads.

`integrations/cloudshare/sales-environment.ts` remains a compatibility projection over the semantic
implementation for existing numeric persistence/display consumers and unmerged cancellation PR448.
Its source methods, optional methods, error class identity and returned raw evidence remain intact.
The persisted numeric decoder and separate roster provenance are intentionally retained: removing
them requires a coordinated persistence/projection migration, outside this slice. PR448 must rebase
and repeat exact-head review/QA before proceeding; this bridge neither changes nor waives its
Preparing-state gate. See [environment-module-verification.md](environment-module-verification.md).

## Resource discovery

`createCloudShareResourceDiscovery` in `integrations/cloudshare/resources.ts` owns the actual
single-resource reads and normalization for Projects, Regions, Project Blueprints, Blueprint
detail/Snapshots, Project Policies and Policy detail. Both Exam and Sales Item authoring adapters
use that interface. It owns the existing v3 paths, schemas, default Snapshot/Region projection,
missing timing evidence and detailed/fallback exchange conversion. Policy discovery returns the
normalized authoring Policy alongside the original parsed detail read: list identity and name
remain authoritative for authoring, while Item completed-read evidence keeps its original shape.

Exam retains descriptions, awaited diagnostic observers and `Promise.all` failure timing. Sales
Item retains its summary projection, `allSettled` groups, completed exchanges and first input-order
failure. Authoring validation, Customer-specific clients, cache/invalidation and diagnostic
operation/resource anchors remain with their callers. Legacy resource-sync keeps its separate
cached list workflow. No universal resource engine or v4 transport is introduced.

Deletion test: removing discovery would restore duplicated retrieval and Snapshot/Region/Policy
normalization in the two authoring adapters. The extraction deletes that duplication; it does not
add a forwarding facade over the old adapters. See
[resource-discovery-verification.md](resource-discovery-verification.md) for checks and limitations.

## Candidate admission

Candidate admission is the portal-owned lifecycle shared by Individual Exam Delivery and Cohort
Exam Session delivery. It validates Candidate identity and the Customer-scoped CloudShare
Connection, applies the same-Exam availability rule, reserves and recovers the provisional
ExamAttempt, and finalizes the ready attempt with its server-only LabLaunch. Blueprint Snapshot
guarding remains a shared runtime safety check. Individual and Cohort adapters retain their
distinct availability rules, TrainingDelivery operations, CloudShare-specific diagnostics, and
user-visible response wording. This is not a generic delivery, Session, or Experience model.
