/** A Sales Enablement Session's CloudShare classification, chosen at delivery time. */
export type SalesExperienceType = "demo" | "poc" | "pov" | "trial";

export const salesExperienceTypes: readonly SalesExperienceType[] = ["demo", "poc", "pov", "trial"];

export function isSalesExperienceType(value: unknown): value is SalesExperienceType {
  return typeof value === "string" && salesExperienceTypes.includes(value as SalesExperienceType);
}
