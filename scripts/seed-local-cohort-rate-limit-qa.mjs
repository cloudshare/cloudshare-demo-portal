import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";

// Local-only data used with PORTAL_LOCAL_QA_SCENARIO=cohort-participant-429.
if (!process.env.DATABASE_URL) {
  const match = readFileSync(".env", "utf8").match(/^DATABASE_URL=(.+)$/m);
  if (match) process.env.DATABASE_URL = match[1].replace(/^['"]|['"]$/g, "");
}
const prisma = new PrismaClient();
const examId = "local-qa-cohort-rate-limit-exam";
const sessionId = "local-qa-cohort-rate-limit-session";
const candidateId = "local-qa-cohort-rate-limit-candidate";
const attemptId = "local-qa-cohort-rate-limit-attempt";
const now = new Date();

try {
  const customer = await prisma.customer.findUnique({ where: { slug: "helios-cx" } });
  if (!customer) throw new Error("Helios CX is not seeded. Start the portal once and log in as the seeded admin first.");
  await prisma.user.upsert({
    where: { id: candidateId }, update: { customerId: customer.id },
    create: { id: candidateId, customerId: customer.id, email: "local-rate-limit-fixture@helios-cx.invalid", firstName: "Local", lastName: "Fixture", passwordHash: "local-qa-fixture-not-for-login", role: "candidate" },
  });
  await prisma.exam.upsert({
    where: { id: examId }, update: { customerId: customer.id, status: "published", publishedAt: now, updatedAt: now },
    create: { id: examId, customerId: customer.id, title: "Local 429 Monitoring Fixture", description: "Local-only QA data.", timeLimitMinutes: 10, storageLeaseMinutes: 60, openPeriodMinutes: 30, scoreRetrievalEnabled: false, status: "published", publishedAt: now, createdAt: now, updatedAt: now, projectId: "local-qa-project", projectName: "Local QA", blueprintId: "local-qa-blueprint", blueprintName: "Local QA Blueprint", snapshotId: "local-qa-snapshot", snapshotName: "Local QA Snapshot", allowedRegionsJson: JSON.stringify(["US East (Miami)"]), policyId: "local-qa-policy", policyName: "Local QA Policy", instructorId: "local-qa-instructor", instructorName: "Local QA Instructor", deliveryAvailability: "cohort" },
  });
  await prisma.cohortExamSession.upsert({
    where: { id: sessionId }, update: { customerId: customer.id, status: "published", cloudShareTrainingId: "EXlocalRateLimit429", cloudShareExperienceId: "EXlocalRateLimit429", updatedAt: now },
    create: { id: sessionId, customerId: customer.id, examId, name: "Local 429 Fixture Session", admissionStartsAt: now, status: "published", cloudShareTrainingId: "EXlocalRateLimit429", cloudShareExperienceId: "EXlocalRateLimit429", publishedAt: now, createdAt: now, updatedAt: now },
  });
  await prisma.examAttempt.upsert({ where: { id: attemptId }, update: { customerId: customer.id, candidateId, examId, cohortSessionId: sessionId, status: "suspended" }, create: { id: attemptId, customerId: customer.id, candidateId, examId, cohortSessionId: sessionId, status: "suspended", createdAt: now } });
  console.log(`Local 429 QA fixture ready: /admin?tab=support&supportTab=session-monitoring&examId=${examId}&sessionId=${sessionId}`);
} finally { await prisma.$disconnect(); }
