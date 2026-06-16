import type { SupportLogRecord, SupportLogRepository } from "@/domain/support-log";
import type { PrismaClient } from "@prisma/client";

export function createInMemorySupportLogRepository(): SupportLogRepository & {
  reset(): void;
} {
  let records: SupportLogRecord[] = [];

  return {
    async append(record: SupportLogRecord): Promise<void> {
      records.push(record);
    },

    async listAll(limit?: number): Promise<SupportLogRecord[]> {
      const sorted = [...records].sort(
        (a, b) => b.timestamp.getTime() - a.timestamp.getTime(),
      );
      return limit !== undefined ? sorted.slice(0, limit) : sorted;
    },

    reset(): void {
      records = [];
    },
  };
}

export function createPrismaSupportLogRepository(prisma: PrismaClient): SupportLogRepository & {
  reset(): Promise<void>;
} {
  return {
    async append(record: SupportLogRecord): Promise<void> {
      await prisma.supportLogEntry.create({
        data: {
          timestamp: record.timestamp,
          level: record.level,
          message: record.message,
          fieldsJson: JSON.stringify(record.fields),
        },
      });
    },

    async listAll(limit?: number): Promise<SupportLogRecord[]> {
      const rows = await prisma.supportLogEntry.findMany({
        orderBy: { timestamp: "desc" },
        ...(limit !== undefined ? { take: limit } : {}),
      });

      return rows.map((row) => ({
        timestamp: row.timestamp,
        level: row.level as SupportLogRecord["level"],
        message: row.message,
        fields: parseFields(row.fieldsJson),
      }));
    },

    async reset(): Promise<void> {
      await prisma.supportLogEntry.deleteMany();
    },
  };
}

function parseFields(fieldsJson: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(fieldsJson) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}
