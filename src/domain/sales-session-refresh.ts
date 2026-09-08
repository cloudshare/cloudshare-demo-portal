import type { CloudShareSalesExperienceStatus } from "./sales-session-status";
import { SALES_EXPERIENCE_OBSERVATION_FRESHNESS_MS } from "./sales-session-status";

type Delivery = {
  listSessions(input: { readonly field?: string; readonly offset: number; readonly limit: number }): Promise<{ readonly sessions: readonly { readonly id: string; readonly status: CloudShareSalesExperienceStatus }[]; readonly total: number }>;
  readSession(id: string): Promise<{ readonly id: string; readonly status: CloudShareSalesExperienceStatus }>;
};
type Session = { readonly id: string; readonly customerId: string; readonly cloudShareSalesExperienceId: string; readonly operationalStatus?: string };
type Sessions = { findById(customerId: string, id: string): Promise<Session | null>; updateOperationalState(customerId: string, id: string, state: { readonly operationalStatus: "active"; readonly experienceStatus: CloudShareSalesExperienceStatus; readonly experienceStatusObservedAt: Date }): Promise<void> };
export function createSalesSessionRefresh(deps: { readonly listSessions: Delivery["listSessions"]; readonly readSession?: Delivery["readSession"]; readonly sessions: Sessions; readonly now?: () => Date }) {
  const now = deps.now ?? (() => new Date());
  return {
    async refreshQueue(input: { readonly customerId: string; readonly mode: "automatic" | "manual"; readonly offset: number; readonly limit: number }) {
      const result = await deps.listSessions({ offset: input.offset, limit: Math.min(input.limit, 100) });
      return { rows: result.sessions, total: result.total, mode: input.mode, progress: { state: "complete" as const, message: "Sales Session status refreshed." } };
    },
    async verify(input: { readonly customerId: string; readonly sessionId: string }) {
      if (!deps.readSession) throw new Error("Sales Session verification is unavailable.");
      const session = await deps.sessions.findById(input.customerId, input.sessionId);
      if (!session || session.customerId !== input.customerId) throw new Error("Sales Session was not found.");
      if (!session.cloudShareSalesExperienceId || session.cloudShareSalesExperienceId.startsWith("pending:")) throw new Error("Sales Session has no verifiable CloudShare Experience.");
      const observedAt = now();
      const result = await deps.readSession(session.cloudShareSalesExperienceId);
      await deps.sessions.updateOperationalState(input.customerId, input.sessionId, { operationalStatus: "active", experienceStatus: result.status, experienceStatusObservedAt: observedAt });
      return { observation: { status: result.status, observedAt: observedAt.toISOString(), freshness: "fresh" as const, expiresAt: new Date(observedAt.getTime() + SALES_EXPERIENCE_OBSERVATION_FRESHNESS_MS).toISOString() } };
    },
  };
}
