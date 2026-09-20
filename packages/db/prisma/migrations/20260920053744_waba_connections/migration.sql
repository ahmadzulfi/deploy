-- AlterTable
ALTER TABLE "Channel" ADD COLUMN     "connectionId" TEXT;

-- CreateTable
CREATE TABLE "WabaConnection" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "metaAppId" TEXT,
    "wabaId" TEXT NOT NULL,
    "appSecretEnc" TEXT NOT NULL,
    "accessTokenEnc" TEXT NOT NULL,
    "verifyToken" TEXT NOT NULL,
    "graphVersion" TEXT NOT NULL DEFAULT 'v21.0',
    "status" "ChannelStatus" NOT NULL DEFAULT 'DISCONNECTED',
    "lastSyncAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WabaConnection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WabaConnection_orgId_idx" ON "WabaConnection"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "WabaConnection_orgId_wabaId_key" ON "WabaConnection"("orgId", "wabaId");

-- CreateIndex
CREATE INDEX "Channel_connectionId_idx" ON "Channel"("connectionId");

-- AddForeignKey
ALTER TABLE "Channel" ADD CONSTRAINT "Channel_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "WabaConnection"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WabaConnection" ADD CONSTRAINT "WabaConnection_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
