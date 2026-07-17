import { z } from "zod";

const bodySchema = z.object({ name: z.string().trim().min(5).max(100) }).strict();

/**
 * CloudShare documents Sales PUT but does not guarantee a lossless GET-to-PUT
 * model or a name-only update. Keep this authenticated route deliberately
 * closed until CloudShare publishes a supported round-trip contract.
 */
export async function handleUpdateSalesSession(_deps: unknown, request: { customerId: string; sessionId: string; actor: unknown; body: unknown }) {
  const parsed = bodySchema.safeParse(request.body);
  if (!parsed.success) return { status: 400, body: { error: "Invalid controlled Sales Session edit." } };
  return { status: 409, body: { error: "Sales Session updates are deferred until CloudShare publishes a supported round-trip update contract." } };
}
