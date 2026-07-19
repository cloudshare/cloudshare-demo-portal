import { z } from "zod";

const draftSchema = z.object({
  version: z.literal(1),
  accountId: z.string().max(200),
  opportunityId: z.string().max(200),
  itemId: z.string().max(200),
  salesProEmail: z.string().email().max(200).or(z.literal("")),
  startMode: z.enum(["now", "scheduled"]),
  start: z.string().max(40),
  end: z.string().max(40),
  endHasManualOverride: z.boolean(),
  timeZone: z.string().max(200),
  type: z.enum(["demo", "poc", "pov", "trial"]),
  sessionNameTemplate: z.string().max(300),
}).strict();

export type SalesSessionProvisionDraft = z.infer<typeof draftSchema>;

export function salesSessionProvisionDraftKey(email: string): string {
  return `certalis:sales-session-provision:v1:${encodeURIComponent(email.trim().toLowerCase())}`;
}

export function parseSalesSessionProvisionDraft(value: string | null): SalesSessionProvisionDraft | null {
  if (!value) return null;
  try {
    const parsed = draftSchema.safeParse(JSON.parse(value));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
