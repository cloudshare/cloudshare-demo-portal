import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getServices } from "@/composition";
import { getPortalAdminSession } from "@/auth/portal-session";
import { PORTAL_SESSION_COOKIE } from "@/api/portal-auth";
import { createPrismaSalesDemoSessionRepository } from "@/persistence/prisma-sales-demo-session-repository";
import { createPrismaSalesRecordRepository } from "@/persistence/prisma-sales-record-repository";
import { createPrismaSalesSessionParticipantRepository } from "@/persistence/prisma-sales-session-participant-repository";
import { createPrismaSalesParticipantLaunchLinkRepository } from "@/persistence/prisma-sales-participant-launch-link-repository";
import { handleCreateSalesParticipantLaunchLink, handleRevokeSalesParticipantLaunchLink } from "@/api/sales-participant-launch";
async function context() { const services = getServices(); await services.ensurePortalSeeded(); const session = await getPortalAdminSession(services, (await cookies()).get(PORTAL_SESSION_COOKIE)?.value); return { services, session: session?.workspace === "sales" ? session : null }; }
const launchDeps = (services: ReturnType<typeof getServices>) => ({ sessions: { findById: createPrismaSalesDemoSessionRepository(services.prisma).findById! }, participants: createPrismaSalesSessionParticipantRepository(services.prisma), records: createPrismaSalesRecordRepository(services.prisma), links: createPrismaSalesParticipantLaunchLinkRepository(services.prisma), connections: services.cloudshareConnections, cloudshare: services.cloudshareClientFactory, diagnostics: services.diagnosticRecorder, audit: services.audit });
const noStore = { "Cache-Control": "no-store" };
export async function POST(_: Request, { params }: { params: Promise<{ sessionId: string; participantId: string }> }) { const { services, session } = await context(); if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: noStore }); const p = await params; const result = await handleCreateSalesParticipantLaunchLink(launchDeps(services), { customerId: session.customerId, sessionId: p.sessionId, participantId: p.participantId, actor: { type: "admin", id: session.userId, email: session.email } }); return NextResponse.json(result.body, { status: result.status, headers: noStore }); }
export async function DELETE(_: Request, { params }: { params: Promise<{ sessionId: string; participantId: string }> }) { const { services, session } = await context(); if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: noStore }); const p = await params; const result = await handleRevokeSalesParticipantLaunchLink(launchDeps(services), { customerId: session.customerId, sessionId: p.sessionId, participantId: p.participantId, actor: { type: "admin", id: session.userId, email: session.email } }); return NextResponse.json(result.body, { status: result.status, headers: noStore }); }
