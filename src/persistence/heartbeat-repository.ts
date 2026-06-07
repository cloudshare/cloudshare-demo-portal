import type { PrismaClient } from "@prisma/client";

/**
 * Persistence is accessed only through repository interfaces, never by touching
 * the ORM directly from other layers. This keeps the database provider swappable
 * (SQLite for the demo, PostgreSQL for the cloud future) behind a stable seam.
 *
 * `Heartbeat` is the walking-skeleton tracer entity; real domain repositories
 * (candidates, exam attempts, audit records, ...) follow the same shape.
 */

export interface Heartbeat {
  readonly id: string;
  readonly source: string;
  readonly createdAt: Date;
}

export interface HeartbeatRepository {
  /** Persist a heartbeat from the given source and return the stored record. */
  record(source: string): Promise<Heartbeat>;
  /** Look up a heartbeat by id, or null if none exists. */
  findById(id: string): Promise<Heartbeat | null>;
}

export function createHeartbeatRepository(
  prisma: PrismaClient,
): HeartbeatRepository {
  return {
    async record(source: string): Promise<Heartbeat> {
      return prisma.heartbeat.create({ data: { source } });
    },
    async findById(id: string): Promise<Heartbeat | null> {
      return prisma.heartbeat.findUnique({ where: { id } });
    },
  };
}
