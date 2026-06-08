/**
 * A CloudShare `Lab` environment as the portal tracks it. CloudShare emits webhook
 * events about an environment's lifecycle, but those are treated only as *hints*:
 * the authoritative state is whatever a `GET environment` poll reports. This module
 * defines the provider-agnostic domain model and the two ports the reconcile flow
 * depends on — implemented by the CloudShare integration (the poll) and the
 * persistence layer (the stored record).
 *
 * Correlation back to the originating {@link LabLaunch} is by `environmentExternalId`,
 * the id the portal sets at experience creation and persists on the launch.
 */

/**
 * The portal's normalised view of an environment's lifecycle. CloudShare's own
 * status vocabulary is mapped onto this small, stable set at the integration seam;
 * `unknown` is the deliberate fallback for a status we don't recognise (logged,
 * never silently coerced).
 */
export type EnvironmentStatus =
  | "created"
  | "running"
  | "suspended"
  | "archived"
  | "deleted"
  | "unknown";

/** The persisted, reconciled view of one environment. */
export interface EnvironmentRecord {
  readonly environmentExternalId: string;
  readonly status: EnvironmentStatus;
  /** When the authoritative poll that produced this status was taken. */
  readonly observedAt: Date;
}

/** Persistence port for {@link EnvironmentRecord}s. Implemented in the persistence layer. */
export interface EnvironmentRepository {
  findByExternalId(environmentExternalId: string): Promise<EnvironmentRecord | null>;
  save(record: EnvironmentRecord): Promise<void>;
}

/** A point-in-time reading of an environment's authoritative state. */
export interface EnvironmentStateSnapshot {
  readonly environmentExternalId: string;
  readonly status: EnvironmentStatus;
}

/**
 * The authoritative source of truth: a `GET environment` poll. Implemented by the
 * CloudShare integration (live) and by the environment simulator (demo). Returns
 * `null` when the environment does not (or no longer) exists.
 */
export interface EnvironmentStateSource {
  getEnvironmentState(
    environmentExternalId: string,
  ): Promise<EnvironmentStateSnapshot | null>;
}
