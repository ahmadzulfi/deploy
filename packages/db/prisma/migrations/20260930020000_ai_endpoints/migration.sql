-- CreateTable
CREATE TABLE "AiEndpoint" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "method" TEXT NOT NULL DEFAULT 'POST',
    "url" TEXT NOT NULL,
    "headersEnc" TEXT,
    "body" TEXT NOT NULL DEFAULT '',
    "answerTemplate" TEXT NOT NULL DEFAULT '',
    "timeoutSeconds" INTEGER NOT NULL DEFAULT 20,
    "lastUsedAt" TIMESTAMP(3),
    "lastErrorAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiEndpoint_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AiEndpoint_orgId_name_key" ON "AiEndpoint"("orgId", "name");

-- AddForeignKey
ALTER TABLE "AiEndpoint" ADD CONSTRAINT "AiEndpoint_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
