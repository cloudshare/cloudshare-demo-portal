/** Sales vocabulary is deliberately distinct from Certification's runtime state. */
export type SalesEnvironmentState = "ready" | "suspended" | "archived" | "deleted" | "taking_snapshot" | "preparing" | "creation_failed" | "unknown";

/** Protected exchange evidence; never an ordinary response/browser projection. */
export interface EnvironmentExchange {
  readonly request: { readonly method: string; readonly path: string; readonly query?: Readonly<Record<string, unknown>>; readonly headers?: Readonly<Record<string, unknown>>; readonly body?: unknown };
  readonly response: { readonly status: number; readonly headers?: Readonly<Record<string, unknown>>; readonly body?: unknown };
}

export interface SalesEnvironmentReading {
  readonly environmentId: string;
  readonly state: SalesEnvironmentState;
  /** Existing persistence projection; Snapshot deliberately has no Trial label. */
  readonly persistedStatus: string | null;
  readonly expiry: {
    readonly raw: string;
    /** Session accepts ISO offsets/Z and RFC GMT only. */
    readonly session: Date | null;
    /** Trial retains its existing JavaScript Date acceptance. */
    readonly trial: Date | null;
  };
  readonly exchanges: readonly EnvironmentExchange[];
}

export interface SalesEnvironmentModule {
  observe(input: { readonly ownerEmail: string; readonly projectId: string }): Promise<SalesEnvironmentReading>;
  observeById?(environmentId: string): Promise<SalesEnvironmentReading>;
  extendById?(environmentId: string): Promise<{ readonly environmentId: string; readonly exchange: EnvironmentExchange }>;
}
