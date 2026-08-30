import { z } from "zod";
import type { CloudShareClient, CloudShareRequestDiagnostics, CloudShareResponseDiagnostics } from "./client";

export interface CloudShareProjectMember {
  readonly email: string;
  readonly displayName: string;
}

export interface CloudShareProjectMemberRead {
  readonly members: readonly CloudShareProjectMember[];
  readonly request: CloudShareRequestDiagnostics;
  readonly response: CloudShareResponseDiagnostics;
  readonly integrationSurface: "cloudshare.v3.project_members_gui";
}

export interface CloudShareProjectMemberSource {
  /**
   * This is intentionally a fresh read. The CloudShare GUI contract is
   * undocumented and no result is cached or retained as Item configuration.
   */
  listActiveProjectMembers(projectId: string): Promise<CloudShareProjectMemberRead>;
}

const memberSchema = z.object({
  email: z.string().trim().email(),
  displayName: z.string().trim().min(1),
});

const memberListSchema = z.preprocess(normalizeMemberListPayload, z.array(memberSchema));

/** Typed adapter for the currently undocumented classic GUI member lookup.
 * It is the only module that knows the query parameters and response aliases. */
export function createCloudShareProjectMemberSource(client: CloudShareClient): CloudShareProjectMemberSource {
  return {
    async listActiveProjectMembers(projectId) {
      const detailed = client.requestV3Detailed
        ? await client.requestV3Detailed({
            method: "GET",
            path: "/users",
            query: { projectUsers: "true", status: "active", loggedIn: "ever", projectId, getRows: "true" },
            schema: memberListSchema,
          })
        : await fallbackDetailed(client, projectId);
      return {
        members: detailed.data,
        request: detailed.request,
        response: detailed.response,
        integrationSurface: "cloudshare.v3.project_members_gui",
      };
    },
  };
}

async function fallbackDetailed(client: CloudShareClient, projectId: string) {
  const query = { projectUsers: "true", status: "active", loggedIn: "ever", projectId, getRows: "true" };
  const data = await client.requestV3({ method: "GET", path: "/users", query, schema: memberListSchema });
  return { data, request: { method: "GET" as const, path: "/users", query }, response: { status: 200, body: data } };
}

function normalizeMemberListPayload(value: unknown): unknown {
  const rows = Array.isArray(value)
    ? value
    : value && typeof value === "object"
      ? readArray(value as Record<string, unknown>, "Rows", "rows", "Data", "data", "Users", "users")
      : undefined;
  if (!rows) return value;
  return rows.map((row) => normalizeMember(row));
}

function normalizeMember(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  const row = value as Record<string, unknown>;
  const email = readString(row, "email", "Email", "userEmail", "UserEmail");
  const explicitName = readString(row, "displayName", "DisplayName", "fullName", "FullName", "name", "Name");
  const firstName = readString(row, "firstName", "FirstName");
  const lastName = readString(row, "lastName", "LastName");
  const displayName = explicitName ?? ([firstName, lastName].filter(Boolean).join(" ") || email);
  return { email, displayName };
}

function readArray(record: Record<string, unknown>, ...keys: string[]): unknown[] | undefined {
  for (const key of keys) if (Array.isArray(record[key])) return record[key];
  return undefined;
}

function readString(record: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) if (typeof record[key] === "string" && record[key].trim()) return record[key] as string;
  return undefined;
}
