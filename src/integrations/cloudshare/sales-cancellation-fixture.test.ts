import { expect, it } from "vitest";
import { createSalesCancellationFixture } from "./sales-cancellation-fixture";
it("retains archive and End state and isolates exact synthetic IDs", async () => {
  const send = createSalesCancellationFixture();
  expect(await send({ method: "GET", url: "https://fixture/v4/sales/real-id" })).toBeNull();
  const env = "qa351-active-environment";
  expect((await send({ method: "PUT", url: `https://fixture/api/v3/envs/actions/archive?envId=${env}` }))?.status).toBe(200);
  expect(JSON.parse((await send({ method: "GET", url: `https://fixture/api/v3/envs/actions/getextended?envId=${env}` }))!.body).statusCode).toBe(4);
  await send({ method: "PUT", url: "https://fixture/v4/sales/qa351-active-sales-experience", body: JSON.stringify({ end: "2026-09-19T14:00", labels: ["certalis:cancelled"] }) });
  expect(JSON.parse((await send({ method: "GET", url: "https://fixture/v4/sales/qa351-active-sales-experience" }))!.body)).toMatchObject({ end: "2026-09-19T14:00", labels: ["certalis:cancelled"] });
});
it("makes ambiguous archive reconciliation and unattempted retry observable", async () => {
  const send = createSalesCancellationFixture();
  const url = "https://fixture/api/v3/envs/actions/";
  expect((await send({ method: "PUT", url: url + "archive?envId=qa351-ambiguous-environment" }))?.status).toBe(503);
  expect((await send({ method: "GET", url: url + "getextended?envId=qa351-ambiguous-environment" }))?.status).toBe(503);
  expect(JSON.parse((await send({ method: "GET", url: url + "getextended?envId=qa351-ambiguous-environment" }))!.body).statusCode).toBe(4);
  const list = "https://fixture/api/v3/envs?ownerEmail=qa351-retry@certalis.invalid";
  expect((await send({ method: "GET", url: list }))?.status).toBe(200);
  expect((await send({ method: "GET", url: list }))?.status).toBe(503);
  expect((await send({ method: "GET", url: list }))?.status).toBe(200);
});
