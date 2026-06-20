import type { EnvironmentController, EnvironmentStateSource, EnvironmentStatus } from "@/domain/environment";
import {
  computeWebhookSignature,
  type CloudShareEnvironmentEventType,
} from "./webhooks";

/**
 * Demo-mode CloudShare environment. It plays both halves of the live contract from
 * a single source of in-memory truth, so the demo behaves exactly like production:
 *
 *  - `emit(...)` advances the environment's status and returns a webhook request
 *    signed and shaped identically to a real CloudShare delivery — fed into the very
 *    same receiver the tunnel feeds in live mode.
 *  - `getEnvironmentState(...)` answers the authoritative `GET environment` poll from
 *    that same status, so the poll the reconcile flow trusts always agrees with the
 *    events the simulator emitted.
 *
 * Replacing this with the live integration changes nothing upstream: both implement
 * {@link EnvironmentStateSource} and produce the identical wire payload.
 */

export interface SignedWebhook {
  readonly rawBody: string;
  readonly signature: string;
}

export interface EmitEnvironmentEventInput {
  readonly environmentExternalId: string;
  readonly event: CloudShareEnvironmentEventType;
  /** Event timestamp; its ISO string becomes the payload `CreatedAt`. */
  readonly at: Date;
}

/**
 * The demo simulator implements both {@link EnvironmentStateSource} (for polling)
 * and {@link EnvironmentController} (for suspend/resume commands). When a command
 * is issued, the simulator immediately transitions its in-memory state so that the
 * next poll sees the new status — exactly as the real CloudShare API would after
 * the async lifecycle action completes.
 */
export interface CloudShareEnvironmentSimulator
  extends EnvironmentStateSource,
    EnvironmentController {
  emit(input: EmitEnvironmentEventInput): SignedWebhook;
  /** Clear all in-memory environment state for a clean demo reset. */
  reset(): void;
}

/** Resolve the post-event status, preserving the prior status for extensions. */
function statusAfter(
  event: CloudShareEnvironmentEventType,
  prior: EnvironmentStatus | undefined,
): EnvironmentStatus {
  switch (event) {
    case "environment.created":
      return "created";
    case "environment.resumed":
      return "running";
    case "environment.suspended":
      return "suspended";
    case "environment.archived":
      return "archived";
    case "environment.deleted":
      return "deleted";
    case "environment.extended":
      // An extension changes the expiry, not the lifecycle state.
      return prior ?? "running";
  }
}

export function createCloudShareEnvironmentSimulator(opts: {
  readonly secret: string;
}): CloudShareEnvironmentSimulator {
  const statusByExternalId = new Map<string, EnvironmentStatus>();

  return {
    emit({ environmentExternalId, event, at }: EmitEnvironmentEventInput): SignedWebhook {
      statusByExternalId.set(
        environmentExternalId,
        statusAfter(event, statusByExternalId.get(environmentExternalId)),
      );

      // Live CloudShare v3 webhook shape: top-level metadata plus event data
      // nested under Payload as a JSON string.
      const rawBody = JSON.stringify({
        Event: event,
        CreatedAt: at.toISOString(),
        CreatedById: "simulator-user",
        CreatedByEmail: "simulator@certalis.demo",
        Attempt: 1,
        Payload: JSON.stringify({
          EnvironmentId: environmentExternalId,
          EnvironmentExternalId: null,
          EnvironmentName: "Simulated Environment",
          BlueprintId: "bp-sim",
          BlueprintName: "Simulated Blueprint",
          PolicyId: "policy-sim",
          PolicyName: "Simulated Policy",
          OwnerEmail: "candidate@example.com",
          Cloud: ["cloudshare"],
          RegionId: "region-1",
        }),
      });
      return { rawBody, signature: computeWebhookSignature(rawBody, opts.secret) };
    },

    async getEnvironmentState(environmentExternalId: string) {
      const status = statusByExternalId.get(environmentExternalId);
      if (status === undefined) return null;
      return { environmentExternalId, status };
    },

    async suspendEnvironment(environmentExternalId: string): Promise<void> {
      statusByExternalId.set(environmentExternalId, "suspended");
    },

    async resumeEnvironment(environmentExternalId: string): Promise<void> {
      statusByExternalId.set(environmentExternalId, "running");
    },

    reset(): void {
      statusByExternalId.clear();
    },
  };
}
