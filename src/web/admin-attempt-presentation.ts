export type AdminAttemptStatus =
  | "scheduled"
  | "ready"
  | "in_progress"
  | "suspended"
  | "completed"
  | "expired";

export function formatAdminUtcTimestamp(value: string | null | undefined): string {
  if (!value) return "-";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
}

export function formatAdminAttemptStatus(status: AdminAttemptStatus): string {
  switch (status) {
    case "scheduled": return "Scheduled";
    case "ready": return "Ready";
    case "in_progress": return "In progress";
    case "suspended": return "Suspended";
    case "completed": return "Completed";
    case "expired": return "Expired";
  }
}
