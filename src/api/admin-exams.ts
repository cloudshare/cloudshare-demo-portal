import type {
  CloudShareClientFactory,
  CloudShareConnectionRepository,
} from "@/domain/cloudshare-connection";
import type { Logger } from "@/observability/logger";
import type {
  DiagnosticActor,
  DiagnosticLogEntryInput,
  DiagnosticRecorder,
} from "@/domain/diagnostic-log";
import {
  ExamNotFoundError,
  unpublishExam,
  type ExamRepository,
} from "@/domain/exam-catalog";
import type { ExamAuthoringCacheRepository } from "@/persistence/exam-authoring-cache-repository";
import {
  getBlueprintDetailRuntime,
  getExamAuthoringBootstrapRuntime,
  getProjectResourcesRuntime,
} from "./admin-exam-authoring-runtime";
import {
  createAdminDraftExamRuntime,
  updateAdminDraftExamRuntime,
  type AdminExamDraftRuntimeDeps,
} from "./admin-exam-draft-runtime";
import {
  publishAdminExamRuntime,
  type AdminExamPublishRuntimeDeps,
} from "./admin-exam-publish-runtime";

interface AdminExamResponse {
  readonly status: number;
  readonly body: Record<string, unknown>;
}

interface CustomerRequest {
  readonly customerId: string;
  readonly actor?: DiagnosticActor | null;
}

interface ResourceRequest extends CustomerRequest {
  readonly refresh: boolean;
}

interface ProjectRequest extends ResourceRequest {
  readonly projectId: string;
}

interface BlueprintRequest extends ProjectRequest {
  readonly blueprintId: string;
}

interface AdminExamAuthoringDeps {
  readonly connections: CloudShareConnectionRepository;
  readonly cloudshare: CloudShareClientFactory;
  readonly cache: ExamAuthoringCacheRepository;
  readonly diagnostics?: DiagnosticRecorder;
  readonly logger: Logger;
  readonly now?: () => Date;
  readonly newCorrelationId?: () => string;
}

interface AdminExamCatalogDeps extends AdminExamDraftRuntimeDeps {
  readonly repository: ExamRepository;
  readonly cache: ExamAuthoringCacheRepository;
  readonly instructor:
    | {
        readonly id: string;
        readonly name: string;
      }
    | null;
  readonly diagnostics?: DiagnosticRecorder;
  readonly logger: Logger;
  readonly now?: () => Date;
  readonly newId?: () => string;
}

type AdminExamPublishDeps = AdminExamPublishRuntimeDeps;

export async function handleGetExamAuthoringBootstrap(
  deps: AdminExamAuthoringDeps,
  request: ResourceRequest,
): Promise<AdminExamResponse> {
  return getExamAuthoringBootstrapRuntime(deps, request);
}

export async function handleGetProjectResources(
  deps: AdminExamAuthoringDeps,
  request: ProjectRequest,
): Promise<AdminExamResponse> {
  return getProjectResourcesRuntime(deps, request);
}

export async function handleGetBlueprintDetail(
  deps: AdminExamAuthoringDeps,
  request: BlueprintRequest,
): Promise<AdminExamResponse> {
  return getBlueprintDetailRuntime(deps, request);
}

export async function handleGetExamCatalog(
  deps: Pick<AdminExamCatalogDeps, "repository" | "logger">,
  request: CustomerRequest,
): Promise<AdminExamResponse> {
  const exams = await deps.repository.listByCustomerId(request.customerId);
  return { status: 200, body: { exams } };
}

export async function handleCreateDraftExam(
  deps: AdminExamCatalogDeps,
  request: CustomerRequest & { readonly body?: unknown },
): Promise<AdminExamResponse> {
  return createAdminDraftExamRuntime(deps, request);
}

export async function handlePublishExam(
  deps: AdminExamPublishDeps,
  request: CustomerRequest & { readonly examId: string },
): Promise<AdminExamResponse> {
  return publishAdminExamRuntime(deps, request);
}

export async function handleUpdateDraftExam(
  deps: Pick<AdminExamCatalogDeps, "repository" | "cache" | "diagnostics" | "logger" | "now">,
  request: CustomerRequest & { readonly examId: string; readonly body?: unknown },
): Promise<AdminExamResponse> {
  return updateAdminDraftExamRuntime(deps, request);
}

export async function handleUnpublishExam(
  deps: Pick<AdminExamCatalogDeps, "repository" | "diagnostics" | "logger" | "now">,
  request: CustomerRequest & { readonly examId: string },
): Promise<AdminExamResponse> {
  try {
    const exam = await unpublishExam(
      { repository: deps.repository, now: deps.now },
      { customerId: request.customerId, examId: request.examId },
    );
    await safeRecordDiagnostic(deps, {
      source: "admin-exams",
      customerId: request.customerId,
      actor: request.actor ?? null,
      subject: { type: "exam", id: exam.id },
      examId: exam.id,
      level: "info",
      operation: "exam.unpublish",
      outcome: "success",
      message: "Exam unpublished",
      details: { changedFields: ["status", "publishedAt"] },
    });
    return { status: 200, body: { exam } };
  } catch (error) {
    if (error instanceof ExamNotFoundError) {
      return { status: 404, body: { error: error.message } };
    }
    throw error;
  }
}

async function safeRecordDiagnostic(
  deps: { readonly diagnostics?: DiagnosticRecorder; readonly logger: Logger },
  entry: DiagnosticLogEntryInput,
): Promise<void> {
  if (!deps.diagnostics) {
    return;
  }

  try {
    await deps.diagnostics.record(entry);
  } catch (error) {
    deps.logger.warn("admin exam diagnostic recording failed", {
      operation: entry.operation,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
