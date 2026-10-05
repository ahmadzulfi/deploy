-- CreateEnum
CREATE TYPE "AiEndpointKind" AS ENUM ('ANSWER', 'ROUTE');

-- AlterTable
ALTER TABLE "AiEndpoint" ADD COLUMN     "kind" "AiEndpointKind" NOT NULL DEFAULT 'ANSWER';
