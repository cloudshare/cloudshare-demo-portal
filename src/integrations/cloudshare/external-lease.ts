import { z } from "zod";
import type { CloudShareClient } from "./client";
import {
  CloudShareRequestError,
  CloudShareResponseError,
  CloudShareTransportError,
} from "./errors";
import { mapCloudShareEnvironmentStatus } from "./environment";

const v3EnvironmentSchema = z
  .object({
    status: z.string().min(1).optional(),
    envStatus: z.string().min(1).optional(),
  })
  .refine((value) => typeof value.status === "string" || typeof value.envStatus === "string", {
    message: "Expected CloudShare environment status field",
  });

const v4TrainingSchema = z.object({
  id: z.string().min(1),
  end: z.string().datetime().optional(),
  End: z.string().datetime().optional(),
  status: z.string().min(1).optional(),
  Status: z.string().min(1).optional(),
});

const v4ExperienceSchema = z.object({
  id: z.string().min(1),
  end: z.string().datetime().optional(),
  End: z.string().datetime().optional(),
  expiresAt: z.string().datetime().optional(),
  ExpiresAt: z.string().datetime().optional(),
  status: z.string().min(1).optional(),
  Status: z.string().min(1).optional(),
});

type LeaseTarget = "environment" | "training" | "experience";
type LeaseFailureMode = "http_status" | "transport" | "unexpected_response" | "unknown";
type LeaseReason = "not_found" | "status_terminal" | "end_elapsed";
type LeaseAttemptedOperation = "get_environment" | "get_training" | "get_experience";

interface LeaseEvidenceBase {
  readonly target: LeaseTarget;
  readonly attemptedOperation: LeaseAttemptedOperation;
  readonly integrationSurface: string;
  readonly method: string;
  readonly path: string;
  readonly host?: string | null;
  readonly request?: Readonly<Record<string, unknown>> | null;
  readonly response?: Readonly<Record<string, unknown>> | null;
  readonly environmentStatus?: string | null;
  readonly leaseEndsAt?: string | null;
  readonly responseStatus?: number | null;
  readonly failureMode?: LeaseFailureMode;
  readonly error?: string | null;
  readonly reason?: LeaseReason;
}

export interface ActiveCloudShareExternalLease extends LeaseEvidenceBase {
  readonly kind: "active";
}

export interface ExpiredCloudShareExternalLease extends LeaseEvidenceBase {
  readonly kind: "expired";
}

export interface UnknownCloudShareExternalLease extends LeaseEvidenceBase {
  readonly kind: "unknown";
}

export type CloudShareExternalLease =
  | ActiveCloudShareExternalLease
  | ExpiredCloudShareExternalLease
  | UnknownCloudShareExternalLease;

export async function inspectCloudShareEnvironmentLease(
  client: CloudShareClient,
  environmentExternalId: string,
): Promise<CloudShareExternalLease> {
  try {
    const detailed = client.requestV3Detailed
      ? await client.requestV3Detailed({
          method: "GET",
          path: `/envs/${environmentExternalId}`,
          schema: v3EnvironmentSchema,
        })
      : null;
    const payload = detailed
      ? detailed.data
      : await client.requestV3({
          method: "GET",
          path: `/envs/${environmentExternalId}`,
          schema: v3EnvironmentSchema,
        });
    const environmentStatus = mapCloudShareEnvironmentStatus(
      payload.envStatus ?? payload.status ?? "unknown",
    );
    const base = {
      target: "environment" as const,
      attemptedOperation: "get_environment" as const,
      integrationSurface: detailed?.integrationSurface ?? "cloudshare.v3.env.get",
      method: detailed?.request.method ?? "GET",
      path: detailed?.request.path ?? `/v3/envs/${environmentExternalId}`,
      host: detailed?.host ?? null,
      request: detailed?.request ?? null,
      response: detailed?.response ?? null,
      environmentStatus,
    };

    if (environmentStatus === "archived" || environmentStatus === "deleted") {
      return {
        kind: "expired",
        ...base,
        reason: "status_terminal",
        responseStatus: detailed?.response.status ?? null,
      };
    }

    return {
      kind: "active",
      ...base,
      responseStatus: detailed?.response.status ?? null,
    };
  } catch (error) {
    return mapLeaseFailure({
      target: "environment",
      attemptedOperation: "get_environment",
      integrationSurface: "cloudshare.v3.env.get",
      fallbackPath: `/v3/envs/${environmentExternalId}`,
      error,
      notFoundStatus: "deleted",
    });
  }
}

export async function inspectCloudShareTrainingLease(
  client: CloudShareClient,
  trainingId: string,
  input: { readonly now: Date },
): Promise<CloudShareExternalLease> {
  try {
    const detailed = client.requestV4Detailed
      ? await client.requestV4Detailed({
          method: "GET",
          path: `/trainings/${trainingId}`,
          schema: v4TrainingSchema,
        })
      : null;
    const payload = detailed
      ? detailed.data
      : await client.requestV4({
          method: "GET",
          path: `/trainings/${trainingId}`,
          schema: v4TrainingSchema,
        });
    return mapTimedLeaseSuccess({
      target: "training",
      attemptedOperation: "get_training",
      integrationSurface: detailed?.integrationSurface ?? "cloudshare.v4.training.get",
      fallbackPath: `/v4/trainings/${trainingId}`,
      host: detailed?.host ?? null,
      request: detailed?.request ?? null,
      response: detailed?.response ?? null,
      status: payload.status ?? payload.Status ?? null,
      leaseEndsAt: payload.end ?? payload.End ?? null,
      now: input.now,
    });
  } catch (error) {
    return mapLeaseFailure({
      target: "training",
      attemptedOperation: "get_training",
      integrationSurface: "cloudshare.v4.training.get",
      fallbackPath: `/v4/trainings/${trainingId}`,
      error,
      notFoundStatus: "deleted",
    });
  }
}

export async function inspectCloudShareExperienceLease(
  client: CloudShareClient,
  experienceId: string,
  input: { readonly now: Date },
): Promise<CloudShareExternalLease> {
  try {
    const detailed = client.requestV4Detailed
      ? await client.requestV4Detailed({
          method: "GET",
          path: `/experiences/${experienceId}`,
          schema: v4ExperienceSchema,
        })
      : null;
    const payload = detailed
      ? detailed.data
      : await client.requestV4({
          method: "GET",
          path: `/experiences/${experienceId}`,
          schema: v4ExperienceSchema,
        });
    return mapTimedLeaseSuccess({
      target: "experience",
      attemptedOperation: "get_experience",
      integrationSurface: detailed?.integrationSurface ?? "cloudshare.v4.experience.get",
      fallbackPath: `/v4/experiences/${experienceId}`,
      host: detailed?.host ?? null,
      request: detailed?.request ?? null,
      response: detailed?.response ?? null,
      status: payload.status ?? payload.Status ?? null,
      leaseEndsAt:
        payload.end ?? payload.End ?? payload.expiresAt ?? payload.ExpiresAt ?? null,
      now: input.now,
    });
  } catch (error) {
    return mapLeaseFailure({
      target: "experience",
      attemptedOperation: "get_experience",
      integrationSurface: "cloudshare.v4.experience.get",
      fallbackPath: `/v4/experiences/${experienceId}`,
      error,
      notFoundStatus: "deleted",
    });
  }
}

function mapTimedLeaseSuccess(input: {
  readonly target: LeaseTarget;
  readonly attemptedOperation: LeaseAttemptedOperation;
  readonly integrationSurface: string;
  readonly fallbackPath: string;
  readonly host: string | null;
  readonly request: Readonly<Record<string, unknown>> | null;
  readonly response: Readonly<Record<string, unknown>> | null;
  readonly status: string | null;
  readonly leaseEndsAt: string | null;
  readonly now: Date;
}): CloudShareExternalLease {
  const normalizedStatus = normalizeTimedLeaseStatus(input.status);
  const base = {
    target: input.target,
    attemptedOperation: input.attemptedOperation,
    integrationSurface: input.integrationSurface,
    method: asString(input.request?.method) ?? "GET",
    path: asString(input.request?.path) ?? input.fallbackPath,
    host: input.host,
    request: input.request,
    response: input.response,
    environmentStatus: normalizedStatus,
    leaseEndsAt: input.leaseEndsAt,
    responseStatus: asNumber(input.response?.status) ?? null,
  };

  if (isTerminalTimedLeaseStatus(normalizedStatus)) {
    return {
      kind: "expired",
      ...base,
      reason: "status_terminal",
    };
  }

  const leaseEndDate = parseDate(input.leaseEndsAt);
  if (leaseEndDate && leaseEndDate.getTime() <= input.now.getTime()) {
    return {
      kind: "expired",
      ...base,
      reason: "end_elapsed",
    };
  }

  return {
    kind: "active",
    ...base,
  };
}

function mapLeaseFailure(input: {
  readonly target: LeaseTarget;
  readonly attemptedOperation: LeaseAttemptedOperation;
  readonly integrationSurface: string;
  readonly fallbackPath: string;
  readonly error: unknown;
  readonly notFoundStatus: string;
}): CloudShareExternalLease {
  if (input.error instanceof CloudShareRequestError) {
    const request = requestEvidenceFromContext(input.error.context, input.fallbackPath);
    const response = responseEvidenceFromContext(input.error.status, input.error.context);
    if (input.error.status === 404) {
      return {
        kind: "expired",
        target: input.target,
        attemptedOperation: input.attemptedOperation,
        integrationSurface: asString(input.error.context?.integrationSurface) ?? input.integrationSurface,
        method: asString(request?.method) ?? "GET",
        path: asString(request?.path) ?? input.fallbackPath,
        host: asString(input.error.context?.host) ?? null,
        request,
        response,
        environmentStatus: input.notFoundStatus,
        responseStatus: input.error.status,
        failureMode: "http_status",
        error: input.error.message,
        reason: "not_found",
      };
    }
    return {
      kind: "unknown",
      target: input.target,
      attemptedOperation: input.attemptedOperation,
      integrationSurface: asString(input.error.context?.integrationSurface) ?? input.integrationSurface,
      method: asString(request?.method) ?? "GET",
      path: asString(request?.path) ?? input.fallbackPath,
      host: asString(input.error.context?.host) ?? null,
      request,
      response,
      responseStatus: input.error.status,
      failureMode: "http_status",
      error: input.error.message,
    };
  }

  if (input.error instanceof CloudShareTransportError) {
    const request = requestEvidenceFromContext(input.error.context, input.fallbackPath);
    return {
      kind: "unknown",
      target: input.target,
      attemptedOperation: input.attemptedOperation,
      integrationSurface: asString(input.error.context?.integrationSurface) ?? input.integrationSurface,
      method: asString(request?.method) ?? "GET",
      path: asString(request?.path) ?? input.fallbackPath,
      host: asString(input.error.context?.host) ?? null,
      request,
      response: null,
      failureMode: "transport",
      error: input.error.message,
    };
  }

  if (input.error instanceof CloudShareResponseError) {
    const request = requestEvidenceFromContext(input.error.context, input.fallbackPath);
    const response = responseEvidenceFromContext(
      asNumber(input.error.context?.status) ?? undefined,
      input.error.context,
    );
    return {
      kind: "unknown",
      target: input.target,
      attemptedOperation: input.attemptedOperation,
      integrationSurface: asString(input.error.context?.integrationSurface) ?? input.integrationSurface,
      method: asString(request?.method) ?? "GET",
      path: asString(request?.path) ?? input.fallbackPath,
      host: asString(input.error.context?.host) ?? null,
      request,
      response,
      responseStatus: asNumber(input.error.context?.status) ?? null,
      failureMode: "unexpected_response",
      error: input.error.message,
    };
  }

  return {
    kind: "unknown",
    target: input.target,
    attemptedOperation: input.attemptedOperation,
    integrationSurface: input.integrationSurface,
    method: "GET",
    path: input.fallbackPath,
    request: {
      method: "GET",
      path: input.fallbackPath,
    },
    response: null,
    failureMode: "unknown",
    error: input.error instanceof Error ? input.error.message : String(input.error),
  };
}

function requestEvidenceFromContext(
  context: Record<string, unknown> | undefined,
  fallbackPath: string,
): Readonly<Record<string, unknown>> | null {
  if (!context) {
    return {
      method: "GET",
      path: fallbackPath,
    };
  }
  return {
    method: asString(context.method) ?? "GET",
    path: asString(context.path) ?? fallbackPath,
    ...(isRecord(context.requestQuery) ? { query: context.requestQuery } : {}),
    ...(isRecord(context.requestHeaders) ? { headers: context.requestHeaders } : {}),
    ...(context.requestBody !== undefined ? { body: context.requestBody } : {}),
  };
}

function responseEvidenceFromContext(
  status: number | undefined,
  context: Record<string, unknown> | undefined,
): Readonly<Record<string, unknown>> | null {
  if (status === undefined && !context) {
    return null;
  }
  return {
    ...(typeof status === "number" ? { status } : {}),
    ...(isRecord(context?.responseHeaders) ? { headers: context?.responseHeaders } : {}),
    ...(context?.responseBody !== undefined ? { body: context.responseBody } : {}),
    ...(isRecord(context?.network) ? { network: context.network } : {}),
    ...(isRecord(context?.tls) ? { tls: context.tls } : {}),
  };
}

function normalizeTimedLeaseStatus(status: string | null): string | null {
  return typeof status === "string" && status.trim().length > 0
    ? status.trim().toLowerCase()
    : null;
}

function isTerminalTimedLeaseStatus(status: string | null): boolean {
  return (
    status === "archived" ||
    status === "deleted" ||
    status === "expired" ||
    status === "completed" ||
    status === "closed" ||
    status === "ended"
  );
}

function parseDate(value: string | null): Date | null {
  if (!value) {
    return null;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
