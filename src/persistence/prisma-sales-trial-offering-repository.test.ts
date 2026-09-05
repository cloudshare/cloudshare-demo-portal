import { describe, expect, it, vi } from "vitest";
import { createPrismaSalesTrialOfferingRepository } from "./prisma-sales-trial-offering-repository";

describe("Prisma Sales Trial Offering repository", () => {
  it("persists server-only provider correlation fields on save", async () => {
    const upsert = vi.fn().mockResolvedValue(undefined);
    const repository = createPrismaSalesTrialOfferingRepository({
      salesTrialOffering: { upsert },
    } as never);

    await repository.save({
      id: "offering-1",
      customerId: "customer-1",
      itemId: "item-1",
      title: "Helios Trial Offering",
      description: "Shared trial",
      cloudShareSalesExperienceId: "sales-1",
      externalId: "opaque-1",
      start: "2026-09-01T09:00",
      end: "2026-09-02T09:00",
      timeZone: "UTC",
      salesProEmail: "owner@example.test",
      salesProDisplayName: "Owner Example",
      status: "published",
      attentionReason: null,
      createdAt: new Date("2026-08-29T12:00:00Z"),
      updatedAt: new Date("2026-08-29T12:30:00Z"),
      publishedAt: new Date("2026-08-29T12:30:00Z"),
      unpublishedAt: null,
    });

    expect(upsert).toHaveBeenCalledWith({
      where: { id: "offering-1" },
      create: expect.objectContaining({
        cloudShareSalesExperienceId: "sales-1",
        externalId: "opaque-1",
      }),
      update: expect.objectContaining({
        cloudShareSalesExperienceId: "sales-1",
        externalId: "opaque-1",
      }),
    });
  });

  it("hydrates supported lifecycle statuses and defaults unknown rows to draft", async () => {
    const findMany = vi
      .fn()
      .mockResolvedValueOnce([
        {
          id: "offering-1",
          customerId: "customer-1",
          itemId: "item-1",
          title: "Published",
          description: "Visible",
          cloudShareSalesExperienceId: "sales-1",
          externalId: "opaque-1",
          start: "2026-09-01T09:00",
          end: "2026-09-02T09:00",
          timeZone: "UTC",
          salesProEmail: "owner@example.test",
          salesProDisplayName: "Owner Example",
          status: "published",
          attentionReason: null,
          createdAt: new Date("2026-08-29T12:00:00Z"),
          updatedAt: new Date("2026-08-29T12:30:00Z"),
          publishedAt: new Date("2026-08-29T12:30:00Z"),
          unpublishedAt: null,
        },
      ])
      .mockResolvedValueOnce([
        {
          id: "offering-2",
          customerId: "customer-1",
          itemId: "item-1",
          title: "Legacy",
          description: "Fallback",
          cloudShareSalesExperienceId: null,
          externalId: null,
          start: "2026-09-01T09:00",
          end: "2026-09-02T09:00",
          timeZone: "UTC",
          salesProEmail: "owner@example.test",
          salesProDisplayName: null,
          status: "legacy_state",
          attentionReason: null,
          createdAt: new Date("2026-08-29T12:00:00Z"),
          updatedAt: new Date("2026-08-29T12:00:00Z"),
          publishedAt: null,
          unpublishedAt: null,
        },
      ]);
    const repository = createPrismaSalesTrialOfferingRepository({
      salesTrialOffering: { findMany },
    } as never);

    await expect(repository.listPublishedByCustomerId("customer-1")).resolves.toMatchObject([
      { id: "offering-1", status: "published" },
    ]);
    await expect(repository.listByCustomerId("customer-1")).resolves.toMatchObject([
      { id: "offering-2", status: "draft" },
    ]);
  });

  it("persists a minimal fail-closed needs-attention marker after provider create", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const repository = createPrismaSalesTrialOfferingRepository({
      salesTrialOffering: { updateMany },
    } as never);

    await expect(
      repository.markPublishNeedsAttention!("customer-1", "offering-1", {
        cloudShareSalesExperienceId: "sales-1",
        externalId: "opaque-1",
        salesProDisplayName: "Owner Example",
        updatedAt: new Date("2026-08-30T00:05:00Z"),
        publishedAt: new Date("2026-08-30T00:05:00Z"),
        attentionReason: "Remote create succeeded but local persistence failed.",
      }),
    ).resolves.toBe(true);

    expect(updateMany).toHaveBeenCalledWith({
      where: { customerId: "customer-1", id: "offering-1" },
      data: expect.objectContaining({
        cloudShareSalesExperienceId: "sales-1",
        externalId: "opaque-1",
        status: "needs_attention",
        attentionReason: "Remote create succeeded but local persistence failed.",
      }),
    });
  });

  it("preserves null provider correlation for ambiguous unresolved fallback state", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const repository = createPrismaSalesTrialOfferingRepository({
      salesTrialOffering: { updateMany },
    } as never);

    await expect(
      repository.markPublishNeedsAttention!("customer-1", "offering-1", {
        cloudShareSalesExperienceId: null,
        externalId: "opaque-1",
        salesProDisplayName: null,
        updatedAt: new Date("2026-08-30T00:10:00Z"),
        publishedAt: new Date("2026-08-30T00:10:00Z"),
        attentionReason: "Remote outcome is ambiguous.",
      }),
    ).resolves.toBe(true);

    expect(updateMany).toHaveBeenCalledWith({
      where: { customerId: "customer-1", id: "offering-1" },
      data: expect.objectContaining({
        cloudShareSalesExperienceId: null,
        externalId: "opaque-1",
        status: "needs_attention",
        attentionReason: "Remote outcome is ambiguous.",
      }),
    });
  });

  it("persists an end-trial needs-attention marker after provider close succeeds but local unpublish save fails", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const repository = createPrismaSalesTrialOfferingRepository({
      salesTrialOffering: { updateMany },
    } as never);

    await expect(
      repository.markEndNeedsAttention!("customer-1", "offering-1", {
        end: "2026-08-30T12:32",
        updatedAt: new Date("2026-08-30T12:30:00Z"),
        unpublishedAt: new Date("2026-08-30T12:30:00Z"),
        attentionReason:
          "CloudShare ended the Sales Trial Offering, but Certalis could not durably unpublish it locally.",
      }),
    ).resolves.toBe(true);

    expect(updateMany).toHaveBeenCalledWith({
      where: { customerId: "customer-1", id: "offering-1" },
      data: expect.objectContaining({
        end: "2026-08-30T12:32",
        status: "needs_attention",
        unpublishedAt: new Date("2026-08-30T12:30:00Z"),
        attentionReason:
          "CloudShare ended the Sales Trial Offering, but Certalis could not durably unpublish it locally.",
      }),
    });
  });

  it("atomically transitions and leases one Offering reconciliation across competing triggers", async () => {
    const updateMany = vi.fn().mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
    const repository = createPrismaSalesTrialOfferingRepository({ salesTrialOffering: { updateMany } } as never);
    const now = new Date("2026-08-31T12:00:00Z");
    const expiresAt = new Date("2026-08-31T12:04:00Z");
    await expect(repository.reserveEndingReconciliation!("customer-1", "offering-1", "lease-a", now, expiresAt, now)).resolves.toBe(true);
    await expect(repository.reserveEndingReconciliation!("customer-1", "offering-1", "lease-b", now, expiresAt, now)).resolves.toBe(false);
    expect(updateMany).toHaveBeenNthCalledWith(1, {
      where: { customerId: "customer-1", id: "offering-1", status: { in: ["published", "ending"] }, OR: [
        { endingLeaseToken: null }, { endingLeaseExpiresAt: null }, { endingLeaseExpiresAt: { lte: now } },
      ] },
      data: expect.objectContaining({ status: "ending", unpublishedAt: now, endingLeaseToken: "lease-a", endingLeaseExpiresAt: expiresAt }),
    });
  });
});
