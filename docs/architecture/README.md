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
reserve a Sales adapter. Sales has distinct v4 operations and must establish a concrete adapter
before any portal-owned delivery mechanics are extracted as shared.

## Candidate admission

Candidate admission is the portal-owned lifecycle shared by Individual Exam Delivery and Cohort
Exam Session delivery. It validates Candidate identity and the Customer-scoped CloudShare
Connection, applies the same-Exam availability rule, reserves and recovers the provisional
ExamAttempt, and finalizes the ready attempt with its server-only LabLaunch. Blueprint Snapshot
guarding remains a shared runtime safety check. Individual and Cohort adapters retain their
distinct availability rules, TrainingDelivery operations, CloudShare-specific diagnostics, and
user-visible response wording. This is not a generic delivery, Session, or Experience model.
