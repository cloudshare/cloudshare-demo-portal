export interface CohortExamSessionPortalAttemptSnapshot {
  readonly id: string;
  readonly candidateEmail: string;
  readonly status: "scheduled" | "ready" | "in_progress" | "suspended" | "completed" | "expired";
}

export interface CohortExamSessionCloudParticipantSnapshot {
  readonly email: string;
  readonly matchedExamAttemptId: string | null;
  readonly studentId: string | null;
  readonly environmentId: string | null;
  readonly participationStatus: string | null;
  readonly environmentStatus: string | null;
}

export interface CohortExamSessionMonitoringSummary {
  readonly activeCount: number;
  readonly inProgressCount: number;
  readonly completedCount: number;
  readonly problemCount: number;
  readonly portalAttemptCount: number;
  readonly cloudShareParticipantCount: number;
  readonly derivedFrom: "portal_and_cloudshare";
}

export interface CohortExamSessionReconciliationRow {
  readonly portal?: CohortExamSessionPortalAttemptSnapshot;
  readonly cloud?: CohortExamSessionCloudParticipantSnapshot;
  readonly problemReasons: readonly string[];
}

export function deriveCohortExamSessionReconciliationRows(
  portalAttempts: readonly CohortExamSessionPortalAttemptSnapshot[],
  participants: readonly CohortExamSessionCloudParticipantSnapshot[],
): readonly CohortExamSessionReconciliationRow[] {
  const attemptKeyByEmail = new Map<string, string>();
  const rowsByKey = new Map<
    string,
    {
      portal?: CohortExamSessionPortalAttemptSnapshot;
      cloud?: CohortExamSessionCloudParticipantSnapshot;
    }
  >();

  for (const attempt of portalAttempts) {
    const key = `attempt:${attempt.id}`;
    attemptKeyByEmail.set(attempt.candidateEmail.trim().toLowerCase(), key);
    rowsByKey.set(key, { ...(rowsByKey.get(key) ?? {}), portal: attempt });
  }

  for (const participant of participants) {
    const key = participant.matchedExamAttemptId
      ? `attempt:${participant.matchedExamAttemptId}`
      : (attemptKeyByEmail.get(participant.email.trim().toLowerCase()) ??
        `email:${participant.email.trim().toLowerCase()}`);
    rowsByKey.set(key, { ...(rowsByKey.get(key) ?? {}), cloud: participant });
  }

  return Array.from(rowsByKey.values(), (row) => ({
    ...row,
    problemReasons: deriveProblemReasons(row.portal, row.cloud),
  }));
}

export function deriveCohortExamSessionMonitoringSummary(
  rows: readonly CohortExamSessionReconciliationRow[],
  cloudShareStatus: "available" | "unavailable" | "not_published",
): CohortExamSessionMonitoringSummary {
  let activeCount = 0;
  let inProgressCount = 0;
  let completedCount = 0;
  let problemCount = cloudShareStatus === "unavailable" ? 1 : 0;

  for (const row of rows) {
    const portalActive = isPortalActive(row.portal?.status);
    const cloudActive = isCloudActive(row.cloud);
    const portalCompleted = isPortalCompleted(row.portal?.status);
    const cloudCompleted = isCloudCompleted(row.cloud);
    const portalInProgress = row.portal?.status === "in_progress";
    const cloudInProgress = isCloudInProgress(row.cloud);

    if (portalActive || cloudActive) activeCount += 1;
    if (portalInProgress || cloudInProgress) inProgressCount += 1;
    if (portalCompleted || cloudCompleted) completedCount += 1;
    if (row.problemReasons.length > 0) problemCount += 1;
  }

  return {
    activeCount,
    inProgressCount,
    completedCount,
    problemCount,
    portalAttemptCount: rows.filter((row) => row.portal).length,
    cloudShareParticipantCount: rows.filter((row) => row.cloud).length,
    derivedFrom: "portal_and_cloudshare",
  };
}

function deriveProblemReasons(
  portal: CohortExamSessionPortalAttemptSnapshot | undefined,
  cloud: CohortExamSessionCloudParticipantSnapshot | undefined,
): readonly string[] {
  const reasons: string[] = [];
  if (portal && !cloud && isPortalActive(portal.status)) {
    reasons.push("Portal has an attempt but no matching CloudShare participant.");
  }
  if (cloud && !portal) {
    reasons.push("CloudShare participant has no matching portal attempt.");
  }

  if (isCloudProblemParticipant(cloud)) {
    reasons.push("CloudShare environment is in a non-terminal problem state.");
  }
  if (!portal || !cloud) {
    return reasons;
  }

  if (isPortalCloudRuntimeMismatch(portal, cloud)) {
    reasons.push(`Portal ${formatPortalProblemState(portal.status)}; ${describeCloudRuntimeMismatch(portal, cloud)}.`);
  }
  if (isPortalActive(portal.status) && isCloudCompleted(cloud)) {
    reasons.push(`Portal ${formatPortalProblemState(portal.status)}; ${describeCloudCompletedState(cloud)}.`);
  }
  if (isPortalCompleted(portal.status) && isCloudActive(cloud)) {
    reasons.push(`Portal ${formatPortalProblemState(portal.status)}; ${describeCloudOngoingState(cloud)}.`);
  }
  return reasons;
}

function formatPortalProblemState(
  status: CohortExamSessionPortalAttemptSnapshot["status"],
): string {
  switch (status) {
    case "in_progress":
      return "in progress";
    default:
      return status;
  }
}

function isPortalActive(status: CohortExamSessionPortalAttemptSnapshot["status"] | undefined): boolean {
  return status === "scheduled" || status === "ready" || status === "in_progress" || status === "suspended";
}

function isPortalCompleted(status: CohortExamSessionPortalAttemptSnapshot["status"] | undefined): boolean {
  return status === "completed" || status === "expired";
}

function isCloudActive(participant: CohortExamSessionCloudParticipantSnapshot | undefined): boolean {
  if (!participant) {
    return false;
  }
  if (isCloudProblemParticipant(participant)) {
    return false;
  }
  if (participant.environmentStatus?.trim()) return isCloudInProgress(participant);
  if (isCloudInProgress(participant)) return true;
  const status = participant.participationStatus?.trim().toLowerCase();
  return status === "pending" || status === "registered" || status === "assigned";
}

function isCloudInProgress(participant: CohortExamSessionCloudParticipantSnapshot | undefined): boolean {
  if (!participant) {
    return false;
  }
  if (isCloudProblemParticipant(participant)) {
    return false;
  }
  const environmentStatus = participant.environmentStatus?.trim().toLowerCase();
  if (environmentStatus) {
    return environmentStatus !== "suspended" && isNormalActiveEnvironmentStatus(environmentStatus);
  }
  return participant.participationStatus?.trim().toLowerCase() === "inprogress";
}

function isCloudCompleted(participant: CohortExamSessionCloudParticipantSnapshot | undefined): boolean {
  if (!participant) {
    return false;
  }
  const environmentStatus = participant.environmentStatus?.trim().toLowerCase();
  if (environmentStatus) return isTerminalEnvironmentStatus(environmentStatus);
  return participant.participationStatus?.trim().toLowerCase() === "completed";
}

function isCloudProblemParticipant(participant: CohortExamSessionCloudParticipantSnapshot | undefined): boolean {
  if (!participant) {
    return false;
  }
  const environmentStatus = participant.environmentStatus?.trim().toLowerCase();
  if (environmentStatus) {
    return !isTerminalEnvironmentStatus(environmentStatus) && !isNormalActiveEnvironmentStatus(environmentStatus);
  }
  const participationStatus = participant.participationStatus?.trim().toLowerCase();
  if (
    participationStatus === "failed" ||
    participationStatus === "error" ||
    participationStatus === "aborted" ||
    participationStatus === "denied"
  ) {
    return true;
  }
  return false;
}

function isPortalCloudRuntimeMismatch(
  portal: CohortExamSessionPortalAttemptSnapshot,
  cloud: CohortExamSessionCloudParticipantSnapshot,
): boolean {
  if (portal.status === "suspended") {
    return isCloudInProgress(cloud);
  }
  if (portal.status === "in_progress") {
    return isCloudSuspended(cloud);
  }
  return false;
}

function isCloudSuspended(cloud: CohortExamSessionCloudParticipantSnapshot): boolean {
  const participationStatus = cloud.participationStatus?.trim().toLowerCase();
  if (participationStatus === "suspended") {
    return true;
  }
  const environmentStatus = cloud.environmentStatus?.trim().toLowerCase();
  return environmentStatus === "suspended";
}

function describeCloudOngoingState(cloud: CohortExamSessionCloudParticipantSnapshot): string {
  const environmentStatus = cloud.environmentStatus?.trim();
  if (environmentStatus) {
    return `CloudShare environment is still ${environmentStatus}`;
  }
  const participationStatus = cloud.participationStatus?.trim();
  if (participationStatus) {
    return `CloudShare participation still ${participationStatus}`;
  }
  return "CloudShare participant is still active";
}

function describeCloudRuntimeMismatch(
  portal: CohortExamSessionPortalAttemptSnapshot,
  cloud: CohortExamSessionCloudParticipantSnapshot,
): string {
  if (portal.status === "suspended") {
    const participationStatus = cloud.participationStatus?.trim();
    if (participationStatus) {
      return `CloudShare participation still ${participationStatus}`;
    }
  }
  if (isCloudSuspended(cloud)) {
    const environmentStatus = cloud.environmentStatus?.trim();
    if (environmentStatus) {
      return `CloudShare environment is ${environmentStatus}`;
    }
    const participationStatus = cloud.participationStatus?.trim();
    if (participationStatus) {
      return `CloudShare participation is ${participationStatus}`;
    }
  }
  return describeCloudOngoingState(cloud);
}

function describeCloudCompletedState(cloud: CohortExamSessionCloudParticipantSnapshot): string {
  const participationStatus = cloud.participationStatus?.trim();
  if (participationStatus) {
    return `CloudShare participation is ${participationStatus}`;
  }
  const environmentStatus = cloud.environmentStatus?.trim();
  if (environmentStatus) {
    return `CloudShare environment is ${environmentStatus}`;
  }
  return "CloudShare participant is already complete";
}

function isTerminalEnvironmentStatus(status: string): boolean {
  return status === "archived" || status === "deleted";
}

function isNormalActiveEnvironmentStatus(status: string): boolean {
  return (
    status === "ready" ||
    status === "running" ||
    status === "suspended" ||
    status === "starting" ||
    status === "provisioning" ||
    status === "resuming" ||
    status === "stopping"
  );
}
