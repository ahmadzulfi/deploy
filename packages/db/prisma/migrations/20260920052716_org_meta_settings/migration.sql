-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "metaAppSecretEnc" TEXT,
ADD COLUMN     "metaGraphVersion" TEXT NOT NULL DEFAULT 'v21.0',
ADD COLUMN     "webhookVerifyToken" TEXT;
