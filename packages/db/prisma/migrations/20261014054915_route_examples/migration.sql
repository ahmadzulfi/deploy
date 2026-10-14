-- CreateTable
CREATE TABLE "RouteExample" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "flowId" TEXT NOT NULL,
    "destinationId" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "sourceDecisionId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RouteExample_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RouteExample_orgId_flowId_destinationId_idx" ON "RouteExample"("orgId", "flowId", "destinationId");

-- CreateIndex
CREATE UNIQUE INDEX "RouteExample_flowId_question_key" ON "RouteExample"("flowId", "question");

-- AddForeignKey
ALTER TABLE "RouteExample" ADD CONSTRAINT "RouteExample_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RouteExample" ADD CONSTRAINT "RouteExample_flowId_fkey" FOREIGN KEY ("flowId") REFERENCES "Flow"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RouteExample" ADD CONSTRAINT "RouteExample_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
