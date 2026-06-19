import type { Logger } from "@/observability/logger";
import {
  receiveWebhook,
  type RawWebhookRequest,
} from "@/integrations/cloudshare/webhook-receiver";
import type { WebhookIdempotencyStore } from "@/domain/webhook";
import type { EventLogRepository } from "@/domain/event-log";
import type {
  CloudShareConnectionRecord,
  CloudShareConnectionRepository,
} from "@/domain/cloudshare-connection";

/**
 * Framework-agnostic handler for the inbound CloudShare webhook endpoint. It owns
 * the policy — verify, validate, dedupe, then trigger the authoritative poll — and
 * returns a plain `{ status, body }` the Next.js route serialises. Keeping it free
 * of request/response framework types makes the whole policy unit-testable.
 *
 * HTTP contract:
 *  - 401 invalid signature   — rejected before the payload is trusted
 *  - 400 invalid payload     — failed Zod validation (logged with issues)
 *  - 200 duplicate           — replayed event, acknowledged but not reprocessed
 *  - 202 accepted            — event taken; a `GET environment` reconcile is triggered
 *
 * A reconcile failure is logged but still returns 202: the webhook is only a hint,
 * and the next event or poll re-reads the authoritative state, so a transient poll
 * failure must not make CloudShare retry against a request we already accepted.
 *
 * Any *unexpected* failure before the reconcile step (e.g. a backing idempotency
 * store throwing) is caught and turned into a deliberate 500 `internal_error` —
 * logged without webhook content or secrets — rather than escaping as a bare 500.
 */

export interface CloudShareWebhookDeps {
  readonly connections: CloudShareConnectionRepository;
  readonly idempotency: WebhookIdempotencyStore;
  /** Trigger the authoritative poll-and-reconcile for one environment. */
  readonly reconcile: (
    connection: CloudShareConnectionRecord,
    environmentExternalId: string,
  ) => Promise<unknown>;
  readonly logger: Logger;
  readonly eventLog: EventLogRepository;
  readonly now?: () => Date;
  readonly newEventId?: () => string;
}

export interface CloudShareWebhookResponse {
  readonly status: number;
  readonly body: Record<string, unknown>;
}

export async function handleCloudShareWebhook(
  deps: CloudShareWebhookDeps,
  request: RawWebhookRequest & { readonly webhookPathToken: string },
): Promise<CloudShareWebhookResponse> {
  try {
    const connection = await deps.connections.findByWebhookPathToken(request.webhookPathToken);
    if (!connection) {
      deps.logger.warn("cloudshare webhook rejected: unknown webhook target", {
        webhookPathToken: request.webhookPathToken,
      });
      await appendWebhookEvent(deps, {
        type: "cloudshare.webhook.unknown_target",
        payload: {
          webhookPathToken: request.webhookPathToken,
        },
      });
      return { status: 404, body: { status: "unknown_target" } };
    }

    const outcome = await receiveWebhook(
      { secret: connection.webhookSecret, idempotency: deps.idempotency },
      request,
    );

    switch (outcome.kind) {
      case "invalid_signature":
        deps.logger.warn("cloudshare webhook rejected: invalid signature", {
          customerId: connection.customerId,
          webhookPathToken: connection.webhookPathToken,
        });
        await appendWebhookEvent(deps, {
          type: "cloudshare.webhook.invalid_signature",
          payload: {
            customerId: connection.customerId,
            webhookPathToken: connection.webhookPathToken,
          },
        });
        return { status: 401, body: { status: "invalid_signature" } };

      case "invalid_payload":
        deps.logger.warn("cloudshare webhook rejected: invalid payload", {
          customerId: connection.customerId,
          webhookPathToken: connection.webhookPathToken,
          issues: outcome.issues,
        });
        await appendWebhookEvent(deps, {
          type: "cloudshare.webhook.invalid_payload",
          payload: {
            customerId: connection.customerId,
            webhookPathToken: connection.webhookPathToken,
            issues: outcome.issues,
          },
        });
        return { status: 400, body: { status: "invalid_payload" } };

      case "duplicate":
        deps.logger.info("cloudshare webhook ignored: duplicate event", {
          customerId: connection.customerId,
          webhookPathToken: connection.webhookPathToken,
          idempotencyKey: outcome.idempotencyKey,
        });
        await appendWebhookEvent(deps, {
          type: "cloudshare.webhook.duplicate",
          payload: {
            customerId: connection.customerId,
            webhookPathToken: connection.webhookPathToken,
            idempotencyKey: outcome.idempotencyKey,
          },
        });
        return { status: 200, body: { status: "duplicate" } };

      case "accepted": {
        const { event, idempotencyKey } = outcome;
        deps.logger.info("cloudshare webhook accepted", {
          customerId: connection.customerId,
          webhookPathToken: connection.webhookPathToken,
          event: event.event,
          environmentExternalId: event.environmentExternalId,
          idempotencyKey,
        });
        await appendWebhookEvent(deps, {
          type: "cloudshare.webhook.accepted",
          payload: {
            customerId: connection.customerId,
            webhookPathToken: connection.webhookPathToken,
            event: event.event,
            environmentExternalId: event.environmentExternalId,
            idempotencyKey,
          },
        });
        // The webhook is only a hint; the poll is the source of truth. Best-effort:
        // a failure here is logged, not surfaced, because the next event/poll recovers.
        try {
          await deps.reconcile(connection, event.environmentExternalId);
        } catch (err) {
          deps.logger.error("cloudshare environment reconcile failed", {
            customerId: connection.customerId,
            webhookPathToken: connection.webhookPathToken,
            environmentExternalId: event.environmentExternalId,
            error: err instanceof Error ? err.message : String(err),
          });
          await appendWebhookEvent(deps, {
            type: "cloudshare.webhook.reconcile_failed",
            payload: {
              customerId: connection.customerId,
              webhookPathToken: connection.webhookPathToken,
              event: event.event,
              environmentExternalId: event.environmentExternalId,
              idempotencyKey,
              error: err instanceof Error ? err.message : String(err),
            },
          });
        }
        return { status: 202, body: { status: "accepted" } };
      }
    }
  } catch (err) {
    // An unexpected failure before reconcile (e.g. a backing store throwing). Log
    // the message only — never webhook content or secrets — and return a deliberate
    // 500 rather than letting a bare exception become an opaque framework 500.
    deps.logger.error("cloudshare webhook handler errored", {
      error: err instanceof Error ? err.message : String(err),
    });
    return { status: 500, body: { status: "internal_error" } };
  }
}

async function appendWebhookEvent(
  deps: Pick<CloudShareWebhookDeps, "eventLog" | "newEventId" | "now">,
  input: { readonly type: string; readonly payload: Record<string, unknown> },
): Promise<void> {
  await deps.eventLog.append({
    eventId: deps.newEventId?.() ?? `${input.type}:${Date.now()}`,
    type: input.type,
    occurredAt: deps.now?.() ?? new Date(),
    payload: input.payload,
  });
}
