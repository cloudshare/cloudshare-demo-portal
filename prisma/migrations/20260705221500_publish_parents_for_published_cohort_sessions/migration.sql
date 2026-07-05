-- Published Cohort Exam Sessions are candidate-admission surfaces. Their
-- parent cohort-capable Exam must be published so the Candidate catalog can
-- render the Exam-first card that exposes those sessions.
UPDATE "Exam"
SET
  "status" = 'published',
  "publishedAt" = COALESCE(
    "publishedAt",
    (
      SELECT MIN("CohortExamSession"."publishedAt")
      FROM "CohortExamSession"
      WHERE
        "CohortExamSession"."examId" = "Exam"."id"
        AND "CohortExamSession"."customerId" = "Exam"."customerId"
        AND "CohortExamSession"."status" = 'published'
    ),
    CURRENT_TIMESTAMP
  ),
  "updatedAt" = CURRENT_TIMESTAMP
WHERE
  "status" <> 'published'
  AND "deliveryAvailability" IN ('cohort', 'both')
  AND EXISTS (
    SELECT 1
    FROM "CohortExamSession"
    WHERE
      "CohortExamSession"."examId" = "Exam"."id"
      AND "CohortExamSession"."customerId" = "Exam"."customerId"
      AND "CohortExamSession"."status" = 'published'
  );
