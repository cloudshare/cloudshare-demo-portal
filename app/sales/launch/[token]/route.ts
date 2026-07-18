import { NextResponse } from "next/server";
import { getServices } from "@/composition";
import { createPrismaSalesDemoSessionRepository } from "@/persistence/prisma-sales-demo-session-repository";
import { createPrismaSalesRecordRepository } from "@/persistence/prisma-sales-record-repository";
import { createPrismaSalesSessionParticipantRepository } from "@/persistence/prisma-sales-session-participant-repository";
import { createPrismaSalesParticipantLaunchLinkRepository } from "@/persistence/prisma-sales-participant-launch-link-repository";
import { handleSalesParticipantLaunch } from "@/api/sales-participant-launch";
export async function GET(_: Request, { params }: { params: Promise<{ token: string }> }) { const services = getServices(); const result = await handleSalesParticipantLaunch({ sessions: { findById: createPrismaSalesDemoSessionRepository(services.prisma).findById! }, participants: createPrismaSalesSessionParticipantRepository(services.prisma), records: createPrismaSalesRecordRepository(services.prisma), links: createPrismaSalesParticipantLaunchLinkRepository(services.prisma), connections: services.cloudshareConnections, cloudshare: services.cloudshareClientFactory, diagnostics: services.diagnosticRecorder, audit: services.audit }, (await params).token); return result.redirect ? NextResponse.redirect(result.redirect, 302) : NextResponse.json(result.body, { status: result.status }); }
