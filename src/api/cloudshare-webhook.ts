import { createHash } from "node:crypto";
import type { Logger } from "@/observability/logger";
import {
  receiveWebhook,
  type RawWebhookRequest,
} from "@/integrations/cloudshare/webhook-receiver";
import {
  CLOUDSHARE_WEBHOOK_SIGNATURE_HEADER,
  type CloudShareEnvironmentEvent,
} from "@/integrations/cloudshare/webhooks";
import type { WebhookIdempotencyStore } from "@/domain/webhook";
import type { EventLogRepository } from "@/domain/event-log";
import type { DiagnosticRecorder, DiagnosticLogEntryInput } from "@/domain/diagnostic-log";
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
  readonly resolveCorrelation?: (
    connection: CloudShareConnectionRecord,
    event: CloudShareEnvironmentEvent,
  ) => Promise<WebhookEventCorrelation | null>;
  /** Trigger the authoritative poll-and-reconcile for one environment. */
  readonly reconcile: (
    connection: CloudShareConnectionRecord,
    environmentExternalId: string,
    event: CloudShareEnvironmentEvent,
  ) => Promise<unknown>;
  readonly logger: Logger;
  readonly eventLog: EventLogRepository;
  readonly diagnostics?: DiagnosticRecorder;
  readonly now?: () => Date;
  readonly newEventId?: () => string;
}

export interface WebhookEventCorrelation {
  readonly customerId?: string | null;
  readonly examAttemptId?: string | null;
  readonly examId?: string | null;
  readonly candidateEmail?: string | null;
}

export interface CloudShareWebhookResponse {
  readonly status: number;
  readonly body: Record<string, unknown>;
}

export async function handleCloudShareWebhook(
  deps: CloudShareWebhookDeps,
  request: RawWebhookRequest & { readonly webhookPathToken: string },
): Promise<CloudShareWebhookResponse> {
  const path = "/api/webhooks/cloudshare/{webhookPathToken}";
  const requestBodyBytes = Buffer.byteLength(request.rawBody, "utf8");
  const rawBodySha256 = hashRawBody(request.rawBody);
  const requestBodySummary = summariseWebhookBody(request.rawBody);
  const signatureHeader = summariseSignatureHeader(request.signature);
  const webhookPathFingerprint = fingerprintWebhookPathToken(request.webhookPathToken);
  let resolvedCustomerId: string | null = null;
  try {
    if (!canResolveWebhookConnection(deps.connections)) {
      deps.logger.error("cloudshare webhook handler misconfigured", {
        operation: "receive_webhook",
        integrationSurface: "cloudshare.v3.webhook",
        webhookPathFingerprint,
        error: "connections.findByWebhookPathToken is unavailable",
      });
      await recordDiagnostic(deps.diagnostics, {
        source: "cloudshare-webhook",
        level: "error",
        operation: "cloudshare.webhook.receive",
        outcome: "failure",
        customerId: null,
        message: "CloudShare webhook handler misconfigured",
        externalIds: { webhookPathFingerprint },
        request: {
          method: "POST",
          path,
          requestBodyBytes,
          rawBodySha256,
        },
        details: {
          signaturePresent: signatureHeader.present,
          signatureHeader,
          trustGateOutcome: "internal_error",
          reason: "connections.findByWebhookPathToken is unavailable",
        },
      });
      return { status: 500, body: { status: "internal_error" } };
    }

    const connection = await deps.connections.findByWebhookPathToken(request.webhookPathToken);
    if (!connection) {
      deps.logger.warn("cloudshare webhook rejected: unknown webhook target", {
        operation: "receive_webhook",
        integrationSurface: "cloudshare.v3.webhook",
        method: "POST",
        path,
        webhookPathFingerprint,
        requestBodyBytes,
        rawBodySha256,
        signaturePresent: Boolean(request.signature),
      });
      await recordDiagnostic(deps.diagnostics, {
        source: "cloudshare-webhook",
        level: "warn",
        operation: "cloudshare.webhook.receive",
        outcome: "failure",
        customerId: null,
        message: "CloudShare webhook rejected: unknown target",
        externalIds: { webhookPathFingerprint },
        request: {
          method: "POST",
          path,
          requestBodyBytes,
          rawBodySha256,
        },
        details: {
          signaturePresent: signatureHeader.present,
          signatureHeader,
          webhookSummary: requestBodySummary,
          trustGateOutcome: "unknown_target",
        },
      });
      await appendWebhookEvent(deps, {
        type: "cloudshare.webhook.unknown_target",
        payload: {
          webhookPathFingerprint,
        },
      });
      return { status: 404, body: { status: "unknown_target" } };
    }
    resolvedCustomerId = connection.customerId;

    const outcome = await receiveWebhook(
      {
        secret: connection.webhookSecret,
        idempotencyScope: connection.customerId,
        idempotency: deps.idempotency,
      },
      request,
    );

    if (outcome.kind === "missing_signature") {
      deps.logger.warn("cloudshare webhook rejected: missing signature", {
        operation: "receive_webhook",
        integrationSurface: "cloudshare.v3.webhook",
        method: "POST",
        path,
        customerId: connection.customerId,
        webhookPathFingerprint,
        requestHeaders: {
          [CLOUDSHARE_WEBHOOK_SIGNATURE_HEADER]: null,
        },
        requestBodyBytes,
        rawBodySha256,
        signaturePresent: false,
        trustGateReason:
          `CloudShare signature header ${CLOUDSHARE_WEBHOOK_SIGNATURE_HEADER} was absent.`,
      });
      await recordDiagnostic(deps.diagnostics, {
        source: "cloudshare-webhook",
        level: "warn",
        operation: "cloudshare.webhook.receive",
        outcome: "failure",
        customerId: connection.customerId,
        message: "CloudShare webhook rejected: missing signature",
        externalIds: { webhookPathFingerprint },
        request: {
          method: "POST",
          path,
          requestBodyBytes,
          rawBodySha256,
        },
        details: {
          signaturePresent: false,
          signatureHeader,
          webhookSummary: requestBodySummary,
          trustGateOutcome: "missing_signature",
        },
      });
      await recordDiagnostic(deps.diagnostics, {
        source: "cloudshare-webhook",
        level: "warn",
        operation: "cloudshare.webhook.verify_signature",
        outcome: "failure",
        customerId: connection.customerId,
        message: "CloudShare webhook signature missing",
        externalIds: { webhookPathFingerprint },
        details: {
          signaturePresent: false,
          signatureMatched: false,
          signatureScheme: "HMAC-SHA256 base64 over exact raw request body",
          storedWebhookSecretLength: connection.webhookSecret.length,
          signatureHeader,
          rawBodySha256,
        },
      });
      await appendWebhookEvent(deps, {
        type: "cloudshare.webhook.missing_signature",
        payload: {
          customerId: connection.customerId,
          webhookPathFingerprint,
        },
      });
      return { status: 401, body: { status: "missing_signature" } };
    }

    const webhookFields = isWebhookBodySummary(requestBodySummary)
      ? flattenWebhookDiagnosticFields(requestBodySummary)
      : {};
    deps.logger.info("cloudshare webhook received", {
      operation: "receive_webhook",
      integrationSurface: "cloudshare.v3.webhook",
      method: "POST",
      path,
      customerId: connection.customerId,
      webhookPathFingerprint,
      requestBodySummary,
      ...webhookFields,
      ...(isWebhookBodySummary(requestBodySummary)
        ? {
            webhookEnvelope: requestBodySummary.envelope,
            webhookPayload: requestBodySummary.payload,
          }
        : {}),
      requestBodyBytes,
      rawBodySha256,
      signaturePresent: true,
    });

    deps.logger.info("cloudshare webhook signature diagnostic", {
      operation: "receive_webhook",
      integrationSurface: "cloudshare.v3.webhook",
      customerId: connection.customerId,
      webhookPathFingerprint,
      signatureScheme: "HMAC-SHA256 base64 over exact raw request body",
      rawBodySha256,
      storedWebhookSecretLength: connection.webhookSecret.length,
      signatureMatched: outcome.kind !== "invalid_signature",
      ...(outcome.kind === "invalid_signature"
        ? {
            signatureFailureHint:
              "Expected signature is computed from the portal-stored webhook secret. If an external HMAC tool using the CloudShare secret returns the received signature, update the stored CloudShare Connection webhook secret.",
          }
        : {}),
    });

    switch (outcome.kind) {
      case "invalid_signature":
        await recordDiagnostic(deps.diagnostics, {
          source: "cloudshare-webhook",
          level: "warn",
          operation: "cloudshare.webhook.receive",
          outcome: "failure",
          customerId: connection.customerId,
          message: "CloudShare webhook rejected: invalid signature",
          externalIds: { webhookPathFingerprint },
          request: {
            method: "POST",
            path,
            requestBodyBytes,
            rawBodySha256,
          },
          details: {
            signaturePresent: true,
            signatureHeader,
            webhookSummary: requestBodySummary,
            trustGateOutcome: "invalid_signature",
          },
        });
        await recordDiagnostic(deps.diagnostics, {
          source: "cloudshare-webhook",
          level: "warn",
          operation: "cloudshare.webhook.verify_signature",
          outcome: "failure",
          customerId: connection.customerId,
          message: "CloudShare webhook signature did not match",
          externalIds: { webhookPathFingerprint },
          details: {
            signaturePresent: true,
            signatureMatched: false,
            signatureScheme: "HMAC-SHA256 base64 over exact raw request body",
            storedWebhookSecretLength: connection.webhookSecret.length,
            signatureHeader,
            rawBodySha256,
          },
        });
        deps.logger.warn("cloudshare webhook rejected: invalid signature", {
          customerId: connection.customerId,
          webhookPathFingerprint,
        });
        await appendWebhookEvent(deps, {
          type: "cloudshare.webhook.invalid_signature",
          payload: {
            customerId: connection.customerId,
            webhookPathFingerprint,
          },
        });
        return { status: 401, body: { status: "invalid_signature" } };

      case "invalid_payload":
        await recordDiagnostic(deps.diagnostics, {
          source: "cloudshare-webhook",
          operation: "cloudshare.webhook.verify_signature",
          outcome: "success",
          customerId: connection.customerId,
          message: "CloudShare webhook signature verified",
          externalIds: { webhookPathFingerprint },
          details: {
            signaturePresent: true,
            signatureMatched: true,
            signatureScheme: "HMAC-SHA256 base64 over exact raw request body",
            storedWebhookSecretLength: connection.webhookSecret.length,
            signatureHeader,
            rawBodySha256,
          },
        });
        await recordDiagnostic(deps.diagnostics, {
          source: "cloudshare-webhook",
          level: "warn",
          operation: "cloudshare.webhook.receive",
          outcome: "failure",
          customerId: connection.customerId,
          message: "CloudShare webhook rejected: invalid payload",
          externalIds: {
            webhookPathFingerprint,
            ...(webhookFields.webhookEnvironmentExternalId
              ? { environmentExternalId: String(webhookFields.webhookEnvironmentExternalId) }
              : {}),
          },
          request: {
            method: "POST",
            path,
            requestBodyBytes,
            rawBodySha256,
          },
          details: {
            eventType: isWebhookBodySummary(requestBodySummary)
              ? requestBodySummary.envelope.Event
              : null,
            signaturePresent: true,
            signatureHeader,
            webhookSummary: requestBodySummary,
            trustGateOutcome: "invalid_payload",
            issues: outcome.issues,
          },
        });
        deps.logger.warn("cloudshare webhook rejected: invalid payload", {
          customerId: connection.customerId,
          webhookPathFingerprint,
          issues: outcome.issues,
        });
        await appendWebhookEvent(deps, {
          type: "cloudshare.webhook.invalid_payload",
          payload: {
            customerId: connection.customerId,
            webhookPathFingerprint,
            issues: outcome.issues,
          },
        });
        return { status: 400, body: { status: "invalid_payload" } };

      case "duplicate":
        await recordDiagnostic(deps.diagnostics, {
          source: "cloudshare-webhook",
          operation: "cloudshare.webhook.verify_signature",
          outcome: "success",
          customerId: connection.customerId,
          message: "CloudShare webhook signature verified",
          externalIds: { webhookPathFingerprint },
          details: {
            signaturePresent: true,
            signatureMatched: true,
            signatureScheme: "HMAC-SHA256 base64 over exact raw request body",
            storedWebhookSecretLength: connection.webhookSecret.length,
            signatureHeader,
            rawBodySha256,
          },
        });
        await recordDiagnostic(deps.diagnostics, {
          source: "cloudshare-webhook",
          level: "warn",
          operation: "cloudshare.webhook.receive",
          outcome: "failure",
          customerId: connection.customerId,
          message: "CloudShare webhook ignored: duplicate event",
          externalIds: {
            webhookPathFingerprint,
            ...(isWebhookBodySummary(requestBodySummary) &&
            typeof requestBodySummary.payload?.EnvironmentExternalId === "string"
              ? {
                  environmentExternalId: requestBodySummary.payload.EnvironmentExternalId,
                }
              : {}),
            idempotencyKey: outcome.idempotencyKey,
          },
          request: {
            method: "POST",
            path,
            requestBodyBytes,
            rawBodySha256,
          },
          details: {
            eventType: isWebhookBodySummary(requestBodySummary)
              ? requestBodySummary.envelope.Event
              : null,
            signaturePresent: true,
            signatureHeader,
            webhookSummary: requestBodySummary,
            trustGateOutcome: "duplicate",
          },
        });
        deps.logger.info("cloudshare webhook ignored: duplicate event", {
          customerId: connection.customerId,
          webhookPathFingerprint,
          idempotencyKey: outcome.idempotencyKey,
        });
        await appendWebhookEvent(deps, {
          type: "cloudshare.webhook.duplicate",
          payload: {
            customerId: connection.customerId,
            webhookPathFingerprint,
            idempotencyKey: outcome.idempotencyKey,
          },
        });
        return { status: 200, body: { status: "duplicate" } };

      case "accepted": {
        const { event, idempotencyKey } = outcome;
        const eventCorrelation =
          (await deps.resolveCorrelation?.(connection, event)) ?? null;
        await recordDiagnostic(deps.diagnostics, {
          source: "cloudshare-webhook",
          operation: "cloudshare.webhook.verify_signature",
          outcome: "success",
          customerId: eventCorrelation?.customerId ?? connection.customerId,
          candidateEmail: eventCorrelation?.candidateEmail ?? null,
          examId: eventCorrelation?.examId ?? null,
          examAttemptId: eventCorrelation?.examAttemptId ?? null,
          subject: eventCorrelation?.examAttemptId
            ? { type: "exam_attempt", id: eventCorrelation.examAttemptId }
            : null,
          message: "CloudShare webhook signature verified",
          externalIds: {
            webhookPathFingerprint,
            environmentExternalId: event.environmentExternalId,
          },
          details: {
            signaturePresent: true,
            signatureMatched: true,
            signatureScheme: "HMAC-SHA256 base64 over exact raw request body",
            storedWebhookSecretLength: connection.webhookSecret.length,
            signatureHeader,
            rawBodySha256,
          },
        });
        await recordDiagnostic(deps.diagnostics, {
          source: "cloudshare-webhook",
          operation: "cloudshare.webhook.receive",
          outcome: "success",
          customerId: eventCorrelation?.customerId ?? connection.customerId,
          candidateEmail: eventCorrelation?.candidateEmail ?? null,
          examId: eventCorrelation?.examId ?? null,
          examAttemptId: eventCorrelation?.examAttemptId ?? null,
          subject: eventCorrelation?.examAttemptId
            ? { type: "exam_attempt", id: eventCorrelation.examAttemptId }
            : null,
          message: "CloudShare webhook accepted",
          externalIds: {
            webhookPathFingerprint,
            environmentExternalId: event.environmentExternalId,
            idempotencyKey,
          },
          request: {
            method: "POST",
            path,
            requestBodyBytes,
            rawBodySha256,
          },
          details: {
            eventType: event.event,
            signaturePresent: true,
            signatureHeader,
            webhookSummary: requestBodySummary,
            trustGateOutcome: "accepted",
          },
        });
        deps.logger.info("cloudshare webhook accepted", {
          customerId: connection.customerId,
          webhookPathFingerprint,
          event: event.event,
          environmentExternalId: event.environmentExternalId,
          idempotencyKey,
        });
        await appendWebhookEvent(deps, {
          type: "cloudshare.webhook.accepted",
          payload: {
            customerId: connection.customerId,
            webhookPathFingerprint,
            event: event.event,
            environmentExternalId: event.environmentExternalId,
            idempotencyKey,
          },
        });
        // The webhook is only a hint; the poll is the source of truth. Best-effort:
        // a failure here is logged, not surfaced, because the next event/poll recovers.
        try {
          const reconcileResult = await deps.reconcile(connection, event.environmentExternalId, event);
          const reconcileDiagnostic = asWebhookReconcileDiagnostic(reconcileResult);
          await recordDiagnostic(deps.diagnostics, {
            source: "cloudshare-webhook",
            operation: "cloudshare.webhook.reconcile",
            outcome: "success",
            customerId: reconcileDiagnostic?.correlation?.customerId ?? connection.customerId,
            candidateEmail: reconcileDiagnostic?.correlation?.candidateEmail ?? null,
            examId: reconcileDiagnostic?.correlation?.examId ?? null,
            examAttemptId: reconcileDiagnostic?.correlation?.examAttemptId ?? null,
            subject: reconcileDiagnostic?.correlation?.examAttemptId
              ? { type: "exam_attempt", id: reconcileDiagnostic.correlation.examAttemptId }
              : null,
            message: reconcileDiagnostic?.correlation?.examAttemptId
              ? "CloudShare webhook reconcile correlated to ExamAttempt"
              : "CloudShare webhook reconcile completed",
            externalIds: {
              webhookPathFingerprint,
              environmentExternalId:
                reconcileDiagnostic?.environmentExternalId ?? event.environmentExternalId,
              ...(reconcileDiagnostic?.status ? { environmentStatus: reconcileDiagnostic.status } : {}),
            },
            details: {
              eventType: event.event,
              reconciled: true,
            },
          });
        } catch (err) {
          deps.logger.error("cloudshare environment reconcile failed", {
            customerId: connection.customerId,
            webhookPathFingerprint,
            environmentExternalId: event.environmentExternalId,
            error: err instanceof Error ? err.message : String(err),
          });
          await recordDiagnostic(deps.diagnostics, {
            source: "cloudshare-webhook",
            level: "error",
            operation: "cloudshare.webhook.reconcile",
            outcome: "failure",
            customerId: connection.customerId,
            message: "CloudShare webhook reconcile failed",
            externalIds: {
              webhookPathFingerprint,
              environmentExternalId: event.environmentExternalId,
            },
            details: {
              eventType: event.event,
              error: err instanceof Error ? err.message : String(err),
            },
          });
          await appendWebhookEvent(deps, {
            type: "cloudshare.webhook.reconcile_failed",
            payload: {
              customerId: connection.customerId,
              webhookPathFingerprint,
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
    await recordDiagnostic(deps.diagnostics, {
      source: "cloudshare-webhook",
      level: "error",
      operation: "cloudshare.webhook.receive",
      outcome: "failure",
      customerId: resolvedCustomerId,
      message: "CloudShare webhook handler errored",
      externalIds: { webhookPathFingerprint },
      request: {
        method: "POST",
        path,
        requestBodyBytes,
        rawBodySha256,
      },
      details: {
        signaturePresent: signatureHeader.present,
        signatureHeader,
        trustGateOutcome: "internal_error",
        error: err instanceof Error ? err.message : String(err),
      },
    });
    return { status: 500, body: { status: "internal_error" } };
  }
}

function canResolveWebhookConnection(
  connections: CloudShareWebhookDeps["connections"],
): connections is CloudShareWebhookDeps["connections"] {
  return typeof connections.findByWebhookPathToken === "function";
}

interface WebhookBodySummary {
  readonly parseStatus: "ok";
  readonly envelope: Record<string, unknown>;
  readonly payload: Record<string, unknown> | null;
}

function summariseWebhookBody(rawBody: string): WebhookBodySummary | { readonly parseStatus: string } {
  try {
    const parsed = JSON.parse(rawBody) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { parseStatus: "non_object_json" };
    }
    const envelope = parsed as Record<string, unknown>;
    const payload = summariseWebhookPayload(envelope.Payload);
    return {
      parseStatus: "ok",
      envelope: {
        Event: stringOrNull(envelope.Event),
        CreatedAt: stringOrNull(envelope.CreatedAt),
        CreatedById: stringOrNull(envelope.CreatedById),
        CreatedByEmail: stringOrNull(envelope.CreatedByEmail),
        Attempt: typeof envelope.Attempt === "number" ? envelope.Attempt : null,
      },
      payload,
    };
  } catch {
    return { parseStatus: "invalid_json" };
  }
}

function isWebhookBodySummary(summary: unknown): summary is WebhookBodySummary {
  return (
    Boolean(summary) &&
    typeof summary === "object" &&
    !Array.isArray(summary) &&
    (summary as { parseStatus?: unknown }).parseStatus === "ok"
  );
}

function flattenWebhookDiagnosticFields(summary: WebhookBodySummary): Record<string, unknown> {
  return {
    webhookEvent: summary.envelope.Event,
    webhookCreatedAt: summary.envelope.CreatedAt,
    webhookCreatedById: summary.envelope.CreatedById,
    webhookCreatedByEmail: summary.envelope.CreatedByEmail,
    webhookAttempt: summary.envelope.Attempt,
    webhookEnvironmentId: summary.payload?.EnvironmentId ?? null,
    webhookEnvironmentExternalId: summary.payload?.EnvironmentExternalId ?? null,
    webhookEnvironmentName: summary.payload?.EnvironmentName ?? null,
    webhookBlueprintId: summary.payload?.BlueprintId ?? null,
    webhookBlueprintName: summary.payload?.BlueprintName ?? null,
    webhookPolicyId: summary.payload?.PolicyId ?? null,
    webhookPolicyName: summary.payload?.PolicyName ?? null,
    webhookOwnerEmail: summary.payload?.OwnerEmail ?? null,
    webhookCloud: summary.payload?.Cloud ?? null,
    webhookRegionId: summary.payload?.RegionId ?? null,
  };
}

function summariseWebhookPayload(payload: unknown): Record<string, unknown> | null {
  const parsedPayload = typeof payload === "string" ? parsePayloadJson(payload) : payload;
  if (!parsedPayload || typeof parsedPayload !== "object" || Array.isArray(parsedPayload)) {
    return null;
  }
  const fields = parsedPayload as Record<string, unknown>;
  return {
    EnvironmentId: stringOrNull(fields.EnvironmentId ?? fields.environmentId),
    EnvironmentExternalId: stringOrNull(
      fields.EnvironmentExternalId ?? fields.environmentExternalId,
    ),
    EnvironmentName: stringOrNull(fields.EnvironmentName ?? fields.environmentName),
    BlueprintId: stringOrNull(fields.BlueprintId ?? fields.blueprintId),
    BlueprintName: stringOrNull(fields.BlueprintName ?? fields.blueprintName),
    PolicyId: stringOrNull(fields.PolicyId ?? fields.policyId),
    PolicyName: stringOrNull(fields.PolicyName ?? fields.policyName),
    OwnerEmail: stringOrNull(fields.OwnerEmail ?? fields.ownerEmail),
    Cloud: Array.isArray(fields.Cloud) ? fields.Cloud.filter((item) => typeof item === "string") : null,
    RegionId: stringOrNull(fields.RegionId ?? fields.regionId),
  };
}

function parsePayloadJson(payload: string): unknown {
  try {
    return JSON.parse(payload) as unknown;
  } catch {
    return null;
  }
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function hashRawBody(rawBody: string): string {
  return createHash("sha256").update(rawBody, "utf8").digest("hex");
}

function hashValueFingerprint(value: string): string {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex").slice(0, 16)}`;
}

function fingerprintWebhookPathToken(webhookPathToken: string): string {
  return hashValueFingerprint(webhookPathToken);
}

function summariseSignatureHeader(signature: string | null | undefined): {
  readonly name: string;
  readonly present: boolean;
  readonly scheme: string;
  readonly length: number;
  readonly fingerprint: string | null;
} {
  return {
    name: CLOUDSHARE_WEBHOOK_SIGNATURE_HEADER,
    present: typeof signature === "string" && signature.length > 0,
    scheme: "hmac-sha256-base64",
    length: typeof signature === "string" ? signature.length : 0,
    fingerprint:
      typeof signature === "string" && signature.length > 0
        ? hashValueFingerprint(signature)
        : null,
  };
}

interface WebhookReconcileDiagnostic {
  readonly environmentExternalId?: string;
  readonly status?: string;
  readonly correlation?: {
    readonly customerId?: string | null;
    readonly examAttemptId?: string | null;
    readonly examId?: string | null;
    readonly candidateEmail?: string | null;
  };
}

function asWebhookReconcileDiagnostic(value: unknown): WebhookReconcileDiagnostic | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const candidate = value as {
    environmentExternalId?: unknown;
    status?: unknown;
    correlation?: {
      customerId?: unknown;
      examAttemptId?: unknown;
      examId?: unknown;
      candidateEmail?: unknown;
    };
  };
  return {
    environmentExternalId:
      typeof candidate.environmentExternalId === "string"
        ? candidate.environmentExternalId
        : undefined,
    status: typeof candidate.status === "string" ? candidate.status : undefined,
    correlation: candidate.correlation
      ? {
          customerId:
            typeof candidate.correlation.customerId === "string"
              ? candidate.correlation.customerId
              : null,
          examAttemptId:
            typeof candidate.correlation.examAttemptId === "string"
              ? candidate.correlation.examAttemptId
              : null,
          examId:
            typeof candidate.correlation.examId === "string" ? candidate.correlation.examId : null,
          candidateEmail:
            typeof candidate.correlation.candidateEmail === "string"
              ? candidate.correlation.candidateEmail
              : null,
        }
      : undefined,
  };
}

async function recordDiagnostic(
  diagnostics: DiagnosticRecorder | undefined,
  input: DiagnosticLogEntryInput,
): Promise<void> {
  if (!diagnostics) {
    return;
  }
  try {
    await diagnostics.record(input);
  } catch {
    // Diagnostic recording is support-only evidence and must never alter webhook behavior.
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
