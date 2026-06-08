import type {
  EnvironmentRecord,
  EnvironmentRepository,
  EnvironmentStateSource,
} from "./environment";

/**
 * Reconcile the portal's view of an environment against the authoritative source.
 *
 * Webhooks are only a *hint* that something changed; this is the flow that decides
 * what actually happened. It polls `GET environment` (the {@link EnvironmentStateSource}),
 * and the polled status — never a webhook payload — drives the persisted state. That
 * is what makes the flow safe under duplicate, replayed, and out-of-order events:
 *
 *  - A poll always reflects the *current* truth, so applying it is idempotent.
 *  - `observedAt` is stamped when the poll is taken, and a reading is only written
 *    if it is newer than the stored one — so an earlier-triggered poll that completes
 *    late can never clobber a fresher observation.
 */

export interface ReconcileEnvironmentDeps {
  /** Authoritative `GET environment` poll. */
  readonly source: EnvironmentStateSource;
  readonly environments: EnvironmentRepository;
  /** Clock, injectable for tests. */
  readonly now: () => Date;
}

export async function reconcileEnvironment(
  deps: ReconcileEnvironmentDeps,
  environmentExternalId: string,
): Promise<EnvironmentRecord | null> {
  // Stamp the observation instant up front: this is the time the poll is taken,
  // and the monotonic guard below is keyed on it.
  const observedAt = deps.now();

  const snapshot = await deps.source.getEnvironmentState(environmentExternalId);
  if (!snapshot) {
    // The source says this environment does not (or no longer) exists. Don't
    // invent a transition; leave any prior record untouched.
    return null;
  }

  const existing = await deps.environments.findByExternalId(environmentExternalId);
  if (existing && existing.observedAt.getTime() >= observedAt.getTime()) {
    // A newer (or equally fresh) observation already won. Out-of-order safe.
    return existing;
  }

  const record: EnvironmentRecord = {
    environmentExternalId,
    status: snapshot.status,
    observedAt,
  };
  await deps.environments.save(record);
  return record;
}
