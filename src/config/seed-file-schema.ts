import { z } from "zod";

const seedConnectionSchema = z.object({
  apiId: z.string().optional(),
  apiKey: z.string().optional(),
  webhookSecret: z.string().optional(),
}).nullable().default(null);

// Shared with the offline instance operator CLI; importing this never seeds state.
export const seedFileSchema = z.object({
  heliosAdminEmail: z.string().email(),
  heliosAdminPassword: z.string().min(8),
  heliosCloudShareConnection: seedConnectionSchema,
  certalisSalesCloudShareConnection: seedConnectionSchema.optional(),
  certalisSalesShareConnection: seedConnectionSchema.optional(),
  heliosInstructor: z.object({ id: z.string().min(1), name: z.string().min(1) }),
  certalisSalesAdminEmail: z.string().email().optional().default("sales-admin@certalis.demo"),
  certalisSalesAdminPassword: z.string().min(8),
});
