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
Customer-scoped client for Training creation, participant handling, retirement, reconciliation,
and Guided Journey reads.

The module intentionally does not define a generic Session or Experience interface and does not
reserve a Sales adapter. Sales has distinct v4 operations and must establish a concrete adapter
before any portal-owned delivery mechanics are extracted as shared.
