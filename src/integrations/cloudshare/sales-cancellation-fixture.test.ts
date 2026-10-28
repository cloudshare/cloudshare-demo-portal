import { expect, it } from "vitest";
import { createSalesCancellationFixture } from "./sales-cancellation-fixture";
it("models future deletion, lost response reconciliation and final Start crossover", async () => {
  const send = createSalesCancellationFixture();
  const url = (kind: string) => `https://fixture/v4/sales/qa351-${kind}-sales-experience`;
  expect((await send({ method: "DELETE", url: url("future-delete") }))?.status).toBe(204);
  expect((await send({ method: "GET", url: url("future-delete") }))?.status).toBe(404);
  expect((await send({ method: "DELETE", url: url("future-delete-ambiguous") }))?.status).toBe(503);
  expect((await send({ method: "GET", url: url("future-delete-ambiguous") }))?.status).toBe(503);
  expect((await send({ method: "GET", url: url("future-delete-ambiguous") }))?.status).toBe(404);
  const first = JSON.parse((await send({ method: "GET", url: url("future-delete-crossover") }))!.body);
  const second = JSON.parse((await send({ method: "GET", url: url("future-delete-crossover") }))!.body);
  expect(Date.parse(first.start + "Z")).toBeGreaterThan(Date.now());
  expect(Date.parse(second.start + "Z")).toBeLessThanOrEqual(Date.now());
});
it("retains archive and End state and isolates exact synthetic IDs", async () => {
  const send = createSalesCancellationFixture();
  expect(await send({ method: "GET", url: "https://fixture/v4/sales/real-id" })).toBeNull();
  const env = "qa351-active-environment";
  expect((await send({ method: "PUT", url: `https://fixture/api/v3/envs/actions/archive?envId=${env}` }))?.status).toBe(200);
  expect(JSON.parse((await send({ method: "GET", url: `https://fixture/v4/environments/${env}` }))!.body).status).toBe("archived");
  await send({ method: "PUT", url: "https://fixture/v4/sales/qa351-active-sales-experience", body: JSON.stringify({ end: "2026-09-19T14:00", labels: ["certalis:cancelled"] }) });
  expect(JSON.parse((await send({ method: "GET", url: "https://fixture/v4/sales/qa351-active-sales-experience" }))!.body)).toMatchObject({ end: "2026-09-19T14:00", labels: ["certalis:cancelled"] });
});
it("makes ambiguous archive reconciliation and unattempted retry observable", async () => {
  const send = createSalesCancellationFixture();
  const url = "https://fixture/api/v3/envs/actions/";
  expect((await send({ method: "PUT", url: url + "archive?envId=qa351-ambiguous-environment" }))?.status).toBe(503);
  expect((await send({ method: "GET", url: "https://fixture/v4/environments/qa351-ambiguous-environment" }))?.status).toBe(503);
  expect(JSON.parse((await send({ method: "GET", url: "https://fixture/v4/environments/qa351-ambiguous-environment" }))!.body).status).toBe("archived");
  const list = "https://fixture/v4/environments?OwnerEmail=qa351-retry@certalis.invalid";
  expect((await send({ method: "GET", url: list }))?.status).toBe(200);
  expect((await send({ method: "GET", url: list }))?.status).toBe(503);
  expect((await send({ method: "GET", url: list }))?.status).toBe(200);
});
