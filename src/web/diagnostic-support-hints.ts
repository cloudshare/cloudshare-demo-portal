export interface SupportDiagnosticEntry {
  readonly id: string;
  readonly occurredAt: string;
  readonly level: "debug" | "info" | "warn" | "error";
  readonly source: string;
  readonly operation: string;
  readonly outcome: "success" | "failure";
  readonly customerId: string | null;
  readonly actor: { type: string; id?: string | null; email?: string | null } | null;
  readonly subject: { type: string; id?: string | null } | null;
  readonly message: string;
  readonly correlationId: string | null;
  readonly candidateEmail: string | null;
  readonly examId: string | null;
  readonly examAttemptId: string | null;
  readonly externalIds?: Record<string, string> | null;
  readonly request?: Record<string, unknown> | null;
  readonly response?: Record<string, unknown> | null;
  readonly details?: Record<string, unknown> | null;
}

export interface DiagnosticSupportHint {
  readonly title: string;
  readonly body: string;
}

export interface DiagnosticQuickFact {
  readonly label: string;
  readonly value: string;
}

export function deriveDiagnosticSupportHints(
  entry: SupportDiagnosticEntry,
): readonly DiagnosticSupportHint[] {
  if (entry.outcome !== "failure") {
    return [];
  }

  if (isMissingWebhookSignature(entry)) {
    return [
      {
        title: "Webhook request was not verifiable",
        body:
          "The CloudShare signature header was missing, so this request was not verifiable as CloudShare-originated. Check the webhook sender, tunnel/proxy behavior, and header forwarding before trusting the payload.",
      },
    ];
  }

  if (entry.operation === "cloudshare.webhook.verify_signature") {
    return [
      {
        title: "Webhook signature mismatch",
        body:
          "Verify the stored CloudShare Connection webhook secret first. If an external HMAC over the exact raw body matches the received signature, the stored CloudShare Connection webhook secret is wrong; if it does not, the request body or signing process changed before verification.",
      },
    ];
  }

  if (entry.operation === "exam_attempt.score.correlate_environment") {
    const path = readString(entry.details, "path");
    const failureMode = readString(entry.details, "failureMode");
    const participantEmail = readString(entry.details, "participantEmail");
    const trainingId = readString(entry.details, "trainingId");

    if (failureMode === "missing_participant_id" && (!trainingId || !participantEmail)) {
      return [
        {
          title: "Guided Journey correlation data is incomplete",
          body:
            "The lab launch does not have enough CloudShare correlation data to resolve a participant. Check the ExamAttempt launch anchors, especially trainingId and participant email, before retrying score retrieval.",
        },
      ];
    }

    if (failureMode === "missing_participant_id" || ((path?.includes("/students") ?? false) && failureMode === "unknown")) {
      return [
        {
          title: "Guided Journey participant could not be correlated",
          body:
            "The portal could not map this ExamAttempt to a CloudShare training participant. Check the training roster, participant email, and stored CloudShare IDs before retrying score retrieval.",
        },
      ];
    }

    if (failureMode === "unexpected_response") {
      return [
        {
          title: "CloudShare participant lookup returned an unexpected payload",
          body:
            "CloudShare responded to the participant-list request, but the payload could not be normalized into a participant correlation result. Review the raw response below and use the correlation ID to trace the request.",
        },
      ];
    }

    if (failureMode === "http_status" || failureMode === "transport") {
      return [
        {
          title: "CloudShare participant lookup failed",
          body:
            "The participant-list request failed at the CloudShare boundary before the portal could resolve a participant. Use the quick facts below to confirm the method/path, failure mode, response status, and correlation ID.",
        },
      ];
    }

    return [
      {
        title: "Guided Journey correlation failed",
        body:
          "The portal could not complete Guided Journey participant correlation for this ExamAttempt. Use the quick facts and raw evidence below to confirm which CloudShare lookup failed and why.",
      },
    ];
  }

  if (entry.operation === "exam_attempt.score.retrieve") {
    if (readString(entry.details, "failureMode") === "unexpected_response") {
      return [
        {
          title: "Guided Journey returned an unexpected payload",
          body:
            "CloudShare responded, but the payload could not be normalized into a score result. Review the raw response below and use the correlation ID to trace the request on both sides.",
        },
      ];
    }

    return [
      {
        title: "Guided Journey score retrieval failed",
        body:
          "The Guided Journey score request failed at the CloudShare boundary. Use the quick facts below to confirm the operation, surface, method/path, failure mode, response status, and correlation ID before retrying.",
      },
    ];
  }

  if (entry.operation === "exam_attempt.enter") {
    const attemptStatus = readString(entry.details, "attemptStatus") ?? readString(entry.details, "currentStatus");
    const scheduledFor = readString(entry.details, "scheduledFor");
    if (attemptStatus) {
      return [
        {
          title: "Exam entry is blocked by attempt status",
          body: `ExamAttempt ${entry.examAttemptId ?? "unknown"} is currently ${attemptStatus}. Confirm the attempt lifecycle before sending the candidate back into the lab.`,
        },
      ];
    }
    if (scheduledFor) {
      return [
        {
          title: "Exam entry was attempted too early",
          body: `ExamAttempt ${entry.examAttemptId ?? "unknown"} is not enterable before ${scheduledFor}. Confirm the portal clock and scheduled start time.`,
        },
      ];
    }
    return [
      {
        title: "Exam entry has no correlated CloudShare launch",
        body: `ExamAttempt ${entry.examAttemptId ?? "unknown"} does not currently have a launch row that can redirect into CloudShare. Check the provisioning and correlation diagnostics for the same attempt.`,
      },
    ];
  }

  if (
    entry.operation === "exam_attempt.suspend" ||
    entry.operation === "exam_attempt.resume" ||
    entry.operation === "exam_attempt.heartbeat_auto_suspend"
  ) {
    if (readString(entry.details, "failureMode") === "invalid_status") {
      return [
        {
          title: "Attempt status blocked the transition",
          body: `ExamAttempt ${entry.examAttemptId ?? "unknown"} is in ${readString(entry.details, "currentStatus") ?? "an unexpected status"} instead of ${readString(entry.details, "expectedStatus") ?? "the required status"}. Confirm the current lifecycle state before retrying.`,
        },
      ];
    }

    if (readString(entry.details, "failureMode") === "not_correlated_yet") {
      return [
        {
          title: "No CloudShare environment is correlated yet",
          body:
            "The portal could not find a confirmed CloudShare environment for this ExamAttempt. Check the training participants response and the stored environment correlation before retrying suspend or resume.",
        },
      ];
    }

    return [
      {
        title: "CloudShare environment transition failed",
        body:
          "Suspend or resume reached the CloudShare boundary and failed. Use the quick facts below to confirm the ExamAttempt, integration surface, method/path, failure mode, environment state, and correlation ID.",
      },
    ];
  }

  if (hasCloudShareFailureShape(entry)) {
    return [
      {
        title: "CloudShare request failed",
        body:
          "This diagnostic row already has the support anchors needed to investigate the external failure. Use the quick facts below to confirm the operation, surface, method/path, failure mode, response status, and correlation ID.",
      },
    ];
  }

  return [];
}

export function deriveDiagnosticQuickFacts(
  entry: SupportDiagnosticEntry,
): readonly DiagnosticQuickFact[] {
  const facts: DiagnosticQuickFact[] = [];
  const integrationSurface = readString(entry.details, "integrationSurface");
  const method =
    readString(entry.request, "method") ?? readString(entry.details, "method");
  const path = readString(entry.request, "path") ?? readString(entry.details, "path");
  const responseStatus =
    readNumber(entry.response, "status") ?? readNumber(entry.details, "responseStatus");
  const failureMode = readString(entry.details, "failureMode");
  const attemptStatus =
    readString(entry.details, "currentStatus") ?? readString(entry.details, "attemptStatus");
  const environmentStatus = readString(entry.details, "environmentStatus");

  if (entry.examAttemptId) {
    facts.push({ label: "ExamAttempt", value: entry.examAttemptId });
  }
  if (integrationSurface) {
    facts.push({ label: "Surface", value: integrationSurface });
  }
  if (method || path) {
    facts.push({ label: "Request", value: [method, path].filter(Boolean).join(" ") });
  }
  if (responseStatus !== null) {
    facts.push({ label: "HTTP", value: String(responseStatus) });
  }
  if (failureMode) {
    facts.push({ label: "Failure mode", value: failureMode });
  }
  if (attemptStatus) {
    facts.push({ label: "Attempt status", value: attemptStatus });
  }
  if (environmentStatus) {
    facts.push({ label: "Environment state", value: environmentStatus });
  }
  if (entry.correlationId) {
    facts.push({ label: "Correlation", value: entry.correlationId });
  }

  return facts;
}

function hasCloudShareFailureShape(entry: SupportDiagnosticEntry): boolean {
  return Boolean(
    readString(entry.details, "integrationSurface") ||
      readString(entry.details, "failureMode") ||
      readString(entry.details, "method") ||
      readString(entry.details, "path") ||
      readNumber(entry.details, "responseStatus") !== null,
  );
}

function isMissingWebhookSignature(entry: SupportDiagnosticEntry): boolean {
  const trustGateOutcome = readString(entry.details, "trustGateOutcome");
  const signaturePresent = readBoolean(entry.details, "signaturePresent");
  return trustGateOutcome === "missing_signature" || signaturePresent === false;
}

function readString(
  record: Record<string, unknown> | null | undefined,
  key: string,
): string | null {
  return typeof record?.[key] === "string" ? (record[key] as string) : null;
}

function readNumber(
  record: Record<string, unknown> | null | undefined,
  key: string,
): number | null {
  return typeof record?.[key] === "number" ? (record[key] as number) : null;
}

function readBoolean(
  record: Record<string, unknown> | null | undefined,
  key: string,
): boolean | null {
  return typeof record?.[key] === "boolean" ? (record[key] as boolean) : null;
}
