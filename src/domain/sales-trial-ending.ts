import { cloudShareWallClockToInstant, formatCloudShareWallClock } from "./cloudshare-wall-clock";
import type { SalesEnvironmentObservation } from "@/integrations/cloudshare/sales-environment";

export function calculateSalesTrialEnding(input: {
  readonly observations: readonly Pick<SalesEnvironmentObservation, "statusCode" | "expirationTime">[];
  readonly now: Date;
  readonly timeZone: string;
  readonly providerEnd?: string | null;
}) {
  const active = input.observations.filter(({ statusCode }) => statusCode !== 5 && statusCode !== 9);
  const latestExpiry = active.reduce<Date | null>((latest, observation) => {
    const parsed = new Date(observation.expirationTime);
    if (Number.isNaN(parsed.getTime())) throw new Error("CloudShare returned an invalid Environment expirationTime.");
    return latest === null || parsed > latest ? parsed : latest;
  }, null);
  const rawDesired = latestExpiry
    ? new Date(latestExpiry.getTime() + 5 * 60_000)
    : new Date(input.now.getTime() + 2 * 60_000);
  // The Sales API wall clock has minute precision. Round upward so truncation
  // can never end access before the promised buffer has fully elapsed.
  const desiredInstant = new Date(Math.ceil(rawDesired.getTime() / 60_000) * 60_000);
  const desiredEnd = formatCloudShareWallClock(desiredInstant, input.timeZone);
  if (!desiredEnd) throw new Error("End trial requires a supported CloudShare timezone.");
  const providerEndInstant = input.providerEnd
    ? cloudShareWallClockToInstant(input.providerEnd.slice(0, 16), input.timeZone)
    : null;
  const shouldUpdate = providerEndInstant === null || (active.length > 0 && desiredInstant > providerEndInstant);
  return {
    activeCount: active.length,
    calculatedEnd: desiredEnd,
    effectiveEnd: shouldUpdate ? desiredEnd : input.providerEnd!.slice(0, 16),
    shouldUpdate,
  };
}
