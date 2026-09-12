export type RosterReadResult<T> = { readonly ok: true; readonly data: T } | { readonly ok: false; readonly error: string; readonly lastSafe?: T };

export type SalesParticipantRosterReader<T> = {
  read(input: { readonly sessionId: string; readonly query: string; readonly page: number; readonly pageSize: number; readonly signal?: AbortSignal }): Promise<RosterReadResult<T>>;
  retry(): Promise<RosterReadResult<T>>;
};

export function createSalesParticipantRosterReader<T>(deps: {
  readonly fetch: (url: string, init: RequestInit) => Promise<Response>;
  readonly route: (sessionId: string) => string;
  readonly decode: (response: Response) => Promise<T>;
}) {
  let generation = 0;
  let lastSafe: T | undefined;
  let latestInput: { sessionId: string; query: string; page: number; pageSize: number } | undefined;
  const read = async (input: { sessionId: string; query: string; page: number; pageSize: number; signal?: AbortSignal }): Promise<RosterReadResult<T>> => {
    latestInput = { sessionId: input.sessionId, query: input.query, page: input.page, pageSize: input.pageSize };
    const mine = ++generation;
    const params = new URLSearchParams();
    if (input.query.trim()) params.set("participantQuery", input.query.trim());
    if (input.page) params.set("participantPage", String(input.page));
    params.set("participantPageSize", String(input.pageSize));
    try {
      const response = await deps.fetch(`${deps.route(encodeURIComponent(input.sessionId))}${params.toString() ? `?${params}` : ""}`, { cache: "no-store", signal: input.signal });
      const data = await deps.decode(response);
      if (!response.ok) throw new Error("Sales Participant roster could not be loaded.");
      if (mine !== generation) return { ok: false, error: "Superseded roster read.", ...(lastSafe === undefined ? {} : { lastSafe }) };
      lastSafe = data;
      return { ok: true, data };
    } catch (error) {
      if (mine !== generation) return { ok: false, error: "Superseded roster read.", ...(lastSafe === undefined ? {} : { lastSafe }) };
      return { ok: false, error: error instanceof Error ? error.message : "Sales Participant roster could not be loaded.", ...(lastSafe === undefined ? {} : { lastSafe }) };
    }
  };
  const retry = (): Promise<RosterReadResult<T>> => latestInput ? read(latestInput) : Promise.resolve({ ok: false, error: "No roster read is available to retry." });
  return { read, retry };
}
