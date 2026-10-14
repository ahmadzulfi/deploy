-- CreateEnum
CREATE TYPE "RouteOutcome" AS ENUM ('JUMPED', 'ASKED', 'PICKED', 'OTHER', 'UNSURE', 'ERROR', 'SKIPPED');

-- CreateEnum
CREATE TYPE "RouteReview" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "RouteDecision" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "flowId" TEXT NOT NULL,
    "flowVersionId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "endpointId" TEXT NOT NULL,
    "question" TEXT,
    "outcome" "RouteOutcome" NOT NULL,
    "destinationId" TEXT,
    "destinationPath" TEXT,
    "score" DOUBLE PRECISION NOT NULL,
    "candidates" JSONB NOT NULL DEFAULT '[]',
    "offered" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "reviewStatus" "RouteReview" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "RouteDecision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RouteDecision_orgId_flowId_outcome_createdAt_idx" ON "RouteDecision"("orgId", "flowId", "outcome", "createdAt");

-- CreateIndex
CREATE INDEX "RouteDecision_createdAt_idx" ON "RouteDecision"("createdAt");

-- AddForeignKey
ALTER TABLE "RouteDecision" ADD CONSTRAINT "RouteDecision_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RouteDecision" ADD CONSTRAINT "RouteDecision_flowId_fkey" FOREIGN KEY ("flowId") REFERENCES "Flow"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RouteDecision" ADD CONSTRAINT "RouteDecision_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

