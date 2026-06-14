import type { LogLevel } from "@/observability/logger";

export interface SupportLogRecord {
  readonly timestamp: Date;
  readonly level: LogLevel;
  readonly message: string;
  readonly fields: Record<string, unknown>;
}

export interface SupportLogRepository {
  append(record: SupportLogRecord): Promise<void>;
  listAll(limit?: number): Promise<SupportLogRecord[]>;
}
