import type {
  CloudShareClientFactory,
  CloudShareConnectionRepository,
} from "@/domain/cloudshare-connection";
import type { Logger } from "@/observability/logger";
import type {
  DiagnosticActor,
  DiagnosticRecorder,
} from "@/domain/diagnostic-log";
import type { ExamRepository } from "@/domain/exam-catalog";
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
import {
  unpublishAdminExamRuntime,
  type AdminExamUnpublishRuntimeDeps,
} from "./admin-exam-unpublish-runtime";

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
type AdminExamUnpublishDeps = AdminExamUnpublishRuntimeDeps;

export interface AdminExamCatalogListServices {
  readonly exams: ExamRepository;
  readonly logger: Logger;
}

export interface AdminExamDraftServices extends AdminExamCatalogListServices {
  readonly examAuthoringCache: ExamAuthoringCacheRepository;
  readonly config: {
    readonly seed: {
      readonly heliosInstructor:
        | {
            readonly id: string;
            readonly name: string;
          }
        | null;
    };
  };
  readonly diagnosticRecorder?: DiagnosticRecorder;
}

export interface AdminExamDraftUpdateServices extends AdminExamCatalogListServices {
  readonly examAuthoringCache: ExamAuthoringCacheRepository;
  readonly diagnosticRecorder?: DiagnosticRecorder;
}

export interface AdminExamPublishServices extends AdminExamDraftUpdateServices {
  readonly cloudshareConnections: CloudShareConnectionRepository;
  readonly cloudshareClientFactory: CloudShareClientFactory;
}

export interface AdminExamUnpublishServices extends AdminExamCatalogListServices {
  readonly diagnosticRecorder?: DiagnosticRecorder;
}

export function buildAdminExamCatalogListDeps(
  services: AdminExamCatalogListServices,
): Pick<AdminExamCatalogDeps, "repository" | "logger"> {
  return {
    repository: services.exams,
    logger: services.logger,
  };
}

export function buildAdminDraftExamDeps(
  services: AdminExamDraftServices,
): AdminExamCatalogDeps {
  return {
    repository: services.exams,
    cache: services.examAuthoringCache,
    instructor: services.config.seed.heliosInstructor,
    diagnostics: services.diagnosticRecorder,
    logger: services.logger,
  };
}

export function buildAdminDraftExamUpdateDeps(
  services: AdminExamDraftUpdateServices,
): Pick<AdminExamCatalogDeps, "repository" | "cache" | "diagnostics" | "logger" | "now"> {
  return {
    repository: services.exams,
    cache: services.examAuthoringCache,
    diagnostics: services.diagnosticRecorder,
    logger: services.logger,
  };
}

export function buildAdminExamPublishDeps(
  services: AdminExamPublishServices,
): AdminExamPublishDeps {
  return {
    repository: services.exams,
    connections: services.cloudshareConnections,
    cloudshare: services.cloudshareClientFactory,
    cache: services.examAuthoringCache,
    diagnostics: services.diagnosticRecorder,
    logger: services.logger,
  };
}

export function buildAdminExamUnpublishDeps(
  services: AdminExamUnpublishServices,
): AdminExamUnpublishDeps {
  return {
    repository: services.exams,
    diagnostics: services.diagnosticRecorder,
    logger: services.logger,
  };
}

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
  deps: AdminExamUnpublishDeps,
  request: CustomerRequest & { readonly examId: string },
): Promise<AdminExamResponse> {
  return unpublishAdminExamRuntime(deps, request);
}
