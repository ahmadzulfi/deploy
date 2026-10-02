-- Skema database claudewa untuk Supabase
-- Dibuat dari 12 migrasi Prisma oleh tools/supabase-export.mjs
-- pada 2026-10-02T03:19:12.225Z.
--
-- Cara pakai: tempel seluruh isi file ini ke Supabase -> SQL Editor -> Run,
-- atau: psql "<connection string Supabase>" -f claudewa-schema.sql
-- Jalankan di database yang masih kosong (skema public belum berisi tabel ini).

BEGIN;

SET search_path TO public;

-- ============================================================
-- Migrasi: 20260920005944_init
-- ============================================================
-- CreateEnum
CREATE TYPE "Provider" AS ENUM ('CLOUD_API', 'BAILEYS');

-- CreateEnum
CREATE TYPE "ChannelStatus" AS ENUM ('CONNECTED', 'DISCONNECTED', 'FLAGGED', 'PAUSED');

-- CreateEnum
CREATE TYPE "QualityRating" AS ENUM ('GREEN', 'YELLOW', 'RED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "OptInStatus" AS ENUM ('UNKNOWN', 'OPTED_IN', 'OPTED_OUT');

-- CreateEnum
CREATE TYPE "ConversationStatus" AS ENUM ('OPEN', 'PENDING', 'CLOSED');

-- CreateEnum
CREATE TYPE "Direction" AS ENUM ('IN', 'OUT');

-- CreateEnum
CREATE TYPE "MessageStatus" AS ENUM ('QUEUED', 'SENT', 'DELIVERED', 'READ', 'FAILED');

-- CreateEnum
CREATE TYPE "TemplateStatus" AS ENUM ('DRAFT', 'PENDING', 'APPROVED', 'REJECTED', 'PAUSED', 'DISABLED');

-- CreateEnum
CREATE TYPE "FlowStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "SessionStatus" AS ENUM ('ACTIVE', 'WAITING', 'COMPLETED', 'EXPIRED', 'FAILED');

-- CreateEnum
CREATE TYPE "TriggerType" AS ENUM ('KEYWORD', 'EXACT', 'REGEX', 'NEW_CONVERSATION', 'BUTTON_PAYLOAD', 'API', 'SCHEDULE');

-- CreateEnum
CREATE TYPE "CampaignStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'RUNNING', 'PAUSED', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "RecipientStatus" AS ENUM ('PENDING', 'SENT', 'DELIVERED', 'READ', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('OWNER', 'ADMIN', 'SUPERVISOR', 'AGENT', 'VIEWER');

-- CreateTable
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Jakarta',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'AGENT',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChannelAccess" (
    "userId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,

    CONSTRAINT "ChannelAccess_pkey" PRIMARY KEY ("userId","channelId")
);

-- CreateTable
CREATE TABLE "Channel" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "provider" "Provider" NOT NULL DEFAULT 'CLOUD_API',
    "wabaId" TEXT,
    "phoneNumberId" TEXT,
    "displayPhone" TEXT,
    "accessTokenEnc" TEXT,
    "status" "ChannelStatus" NOT NULL DEFAULT 'DISCONNECTED',
    "qualityRating" "QualityRating" NOT NULL DEFAULT 'UNKNOWN',
    "messagingTier" TEXT NOT NULL DEFAULT 'TIER_250',
    "throughputPerSec" INTEGER NOT NULL DEFAULT 80,
    "sendingPaused" BOOLEAN NOT NULL DEFAULT false,
    "pausedReason" TEXT,
    "lastHealthCheck" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Channel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Contact" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "waId" TEXT NOT NULL,
    "name" TEXT,
    "attributes" JSONB NOT NULL DEFAULT '{}',
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "optInStatus" "OptInStatus" NOT NULL DEFAULT 'UNKNOWN',
    "optInSource" TEXT,
    "optInAt" TIMESTAMP(3),
    "optOutAt" TIMESTAMP(3),
    "lastSeenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Contact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Conversation" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "status" "ConversationStatus" NOT NULL DEFAULT 'OPEN',
    "assigneeId" TEXT,
    "windowExpiresAt" TIMESTAMP(3),
    "botPaused" BOOLEAN NOT NULL DEFAULT false,
    "lastMessageAt" TIMESTAMP(3),
    "unreadCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Conversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "direction" "Direction" NOT NULL,
    "waMessageId" TEXT,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "MessageStatus" NOT NULL DEFAULT 'QUEUED',
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "sentBy" TEXT,
    "sentByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "readAt" TIMESTAMP(3),

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Template" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "wabaId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "components" JSONB NOT NULL,
    "metaTemplateId" TEXT,
    "metaStatus" "TemplateStatus" NOT NULL DEFAULT 'DRAFT',
    "rejectionReason" TEXT,
    "syncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Template_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Flow" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "FlowStatus" NOT NULL DEFAULT 'DRAFT',
    "publishedVersionId" TEXT,
    "draftGraph" JSONB NOT NULL DEFAULT '{"nodes":[],"edges":[]}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Flow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FlowVersion" (
    "id" TEXT NOT NULL,
    "flowId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "graph" JSONB NOT NULL,
    "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedBy" TEXT,

    CONSTRAINT "FlowVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FlowSession" (
    "id" TEXT NOT NULL,
    "flowVersionId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "conversationId" TEXT,
    "currentNodeId" TEXT,
    "variables" JSONB NOT NULL DEFAULT '{}',
    "status" "SessionStatus" NOT NULL DEFAULT 'ACTIVE',
    "stepCount" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FlowSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Trigger" (
    "id" TEXT NOT NULL,
    "flowId" TEXT NOT NULL,
    "channelId" TEXT,
    "type" "TriggerType" NOT NULL,
    "config" JSONB NOT NULL DEFAULT '{}',
    "priority" INTEGER NOT NULL DEFAULT 0,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Trigger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Campaign" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "audienceQuery" JSONB NOT NULL DEFAULT '{}',
    "variableMap" JSONB NOT NULL DEFAULT '{}',
    "scheduleAt" TIMESTAMP(3),
    "throttlePerMin" INTEGER NOT NULL DEFAULT 60,
    "status" "CampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "totalCount" INTEGER NOT NULL DEFAULT 0,
    "sentCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "skippedCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampaignRecipient" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "status" "RecipientStatus" NOT NULL DEFAULT 'PENDING',
    "messageId" TEXT,
    "error" TEXT,
    "sentAt" TIMESTAMP(3),

    CONSTRAINT "CampaignRecipient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookEvent" (
    "id" TEXT NOT NULL,
    "channelId" TEXT,
    "rawPayload" JSONB NOT NULL,
    "signatureOk" BOOLEAN NOT NULL DEFAULT false,
    "processedAt" TIMESTAMP(3),
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "resourceType" TEXT NOT NULL,
    "resourceId" TEXT,
    "diff" JSONB,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApiKey" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "hashedKey" TEXT NOT NULL,
    "scopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApiKey_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_orgId_idx" ON "User"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "Channel_phoneNumberId_key" ON "Channel"("phoneNumberId");

-- CreateIndex
CREATE INDEX "Channel_orgId_idx" ON "Channel"("orgId");

-- CreateIndex
CREATE INDEX "Channel_wabaId_idx" ON "Channel"("wabaId");

-- CreateIndex
CREATE INDEX "Contact_orgId_optInStatus_idx" ON "Contact"("orgId", "optInStatus");

-- CreateIndex
CREATE INDEX "Contact_tags_idx" ON "Contact"("tags");

-- CreateIndex
CREATE UNIQUE INDEX "Contact_orgId_waId_key" ON "Contact"("orgId", "waId");

-- CreateIndex
CREATE INDEX "Conversation_channelId_status_lastMessageAt_idx" ON "Conversation"("channelId", "status", "lastMessageAt");

-- CreateIndex
CREATE INDEX "Conversation_assigneeId_status_idx" ON "Conversation"("assigneeId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Conversation_channelId_contactId_key" ON "Conversation"("channelId", "contactId");

-- CreateIndex
CREATE UNIQUE INDEX "Message_waMessageId_key" ON "Message"("waMessageId");

-- CreateIndex
CREATE INDEX "Message_conversationId_createdAt_idx" ON "Message"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "Message_status_idx" ON "Message"("status");

-- CreateIndex
CREATE INDEX "Template_channelId_metaStatus_idx" ON "Template"("channelId", "metaStatus");

-- CreateIndex
CREATE UNIQUE INDEX "Template_wabaId_name_language_key" ON "Template"("wabaId", "name", "language");

-- CreateIndex
CREATE UNIQUE INDEX "Flow_publishedVersionId_key" ON "Flow"("publishedVersionId");

-- CreateIndex
CREATE INDEX "Flow_orgId_status_idx" ON "Flow"("orgId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "FlowVersion_flowId_version_key" ON "FlowVersion"("flowId", "version");

-- CreateIndex
CREATE INDEX "FlowSession_contactId_status_idx" ON "FlowSession"("contactId", "status");

-- CreateIndex
CREATE INDEX "FlowSession_conversationId_status_idx" ON "FlowSession"("conversationId", "status");

-- CreateIndex
CREATE INDEX "FlowSession_status_expiresAt_idx" ON "FlowSession"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "Trigger_channelId_enabled_priority_idx" ON "Trigger"("channelId", "enabled", "priority");

-- CreateIndex
CREATE INDEX "Campaign_orgId_status_idx" ON "Campaign"("orgId", "status");

-- CreateIndex
CREATE INDEX "CampaignRecipient_campaignId_status_idx" ON "CampaignRecipient"("campaignId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "CampaignRecipient_campaignId_contactId_key" ON "CampaignRecipient"("campaignId", "contactId");

-- CreateIndex
CREATE INDEX "WebhookEvent_channelId_createdAt_idx" ON "WebhookEvent"("channelId", "createdAt");

-- CreateIndex
CREATE INDEX "WebhookEvent_processedAt_idx" ON "WebhookEvent"("processedAt");

-- CreateIndex
CREATE INDEX "AuditLog_orgId_createdAt_idx" ON "AuditLog"("orgId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_resourceType_resourceId_idx" ON "AuditLog"("resourceType", "resourceId");

-- CreateIndex
CREATE UNIQUE INDEX "ApiKey_hashedKey_key" ON "ApiKey"("hashedKey");

-- CreateIndex
CREATE INDEX "ApiKey_orgId_idx" ON "ApiKey"("orgId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChannelAccess" ADD CONSTRAINT "ChannelAccess_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChannelAccess" ADD CONSTRAINT "ChannelAccess_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Channel" ADD CONSTRAINT "Channel_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contact" ADD CONSTRAINT "Contact_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_sentByUserId_fkey" FOREIGN KEY ("sentByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Template" ADD CONSTRAINT "Template_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Flow" ADD CONSTRAINT "Flow_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Flow" ADD CONSTRAINT "Flow_publishedVersionId_fkey" FOREIGN KEY ("publishedVersionId") REFERENCES "FlowVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FlowVersion" ADD CONSTRAINT "FlowVersion_flowId_fkey" FOREIGN KEY ("flowId") REFERENCES "Flow"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FlowSession" ADD CONSTRAINT "FlowSession_flowVersionId_fkey" FOREIGN KEY ("flowVersionId") REFERENCES "FlowVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FlowSession" ADD CONSTRAINT "FlowSession_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FlowSession" ADD CONSTRAINT "FlowSession_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FlowSession" ADD CONSTRAINT "FlowSession_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trigger" ADD CONSTRAINT "Trigger_flowId_fkey" FOREIGN KEY ("flowId") REFERENCES "Flow"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trigger" ADD CONSTRAINT "Trigger_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "Template"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignRecipient" ADD CONSTRAINT "CampaignRecipient_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignRecipient" ADD CONSTRAINT "CampaignRecipient_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebhookEvent" ADD CONSTRAINT "WebhookEvent_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApiKey" ADD CONSTRAINT "ApiKey_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ============================================================
-- Migrasi: 20260920014311_add_user_password
-- ============================================================
-- AlterTable
ALTER TABLE "User" ADD COLUMN     "passwordHash" TEXT;

-- ============================================================
-- Migrasi: 20260920052716_org_meta_settings
-- ============================================================
-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "metaAppSecretEnc" TEXT,
ADD COLUMN     "metaGraphVersion" TEXT NOT NULL DEFAULT 'v21.0',
ADD COLUMN     "webhookVerifyToken" TEXT;

-- ============================================================
-- Migrasi: 20260920053744_waba_connections
-- ============================================================
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

-- ============================================================
-- Migrasi: 20260920063256_flow_enabled
-- ============================================================
-- AlterTable
ALTER TABLE "Flow" ADD COLUMN     "enabled" BOOLEAN NOT NULL DEFAULT true;

-- ============================================================
-- Migrasi: 20260921115821_bot_auto_resume
-- ============================================================
-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN     "botPausedAt" TIMESTAMP(3);

-- ============================================================
-- Migrasi: 20260922225500_outgoing_webhooks
-- ============================================================
-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED');

-- CreateTable
CREATE TABLE "WebhookEndpoint" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "secretEnc" TEXT NOT NULL,
    "events" TEXT[],
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastSuccessAt" TIMESTAMP(3),
    "lastFailureAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WebhookEndpoint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookDelivery" (
    "id" TEXT NOT NULL,
    "endpointId" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "status" "DeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "responseStatus" INTEGER,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deliveredAt" TIMESTAMP(3),

    CONSTRAINT "WebhookDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WebhookEndpoint_orgId_idx" ON "WebhookEndpoint"("orgId");

-- CreateIndex
CREATE INDEX "WebhookDelivery_status_nextAttemptAt_idx" ON "WebhookDelivery"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "WebhookDelivery_endpointId_createdAt_idx" ON "WebhookDelivery"("endpointId", "createdAt");

-- AddForeignKey
ALTER TABLE "WebhookEndpoint" ADD CONSTRAINT "WebhookEndpoint_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebhookDelivery" ADD CONSTRAINT "WebhookDelivery_endpointId_fkey" FOREIGN KEY ("endpointId") REFERENCES "WebhookEndpoint"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ============================================================
-- Migrasi: 20260923010000_message_request_id
-- ============================================================
-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "requestId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Message_requestId_key" ON "Message"("requestId");

-- ============================================================
-- Migrasi: 20260923020000_campaign_runner_and_key_channels
-- ============================================================
-- AlterTable
ALTER TABLE "ApiKey" ADD COLUMN     "channelIds" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "Campaign" ADD COLUMN     "completedAt" TIMESTAMP(3),
ADD COLUMN     "createdById" TEXT,
ADD COLUMN     "lastTickAt" TIMESTAMP(3),
ADD COLUMN     "startedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "CampaignRecipient_messageId_idx" ON "CampaignRecipient"("messageId");

-- ============================================================
-- Migrasi: 20260923021000_campaign_error
-- ============================================================
-- AlterTable
ALTER TABLE "Campaign" ADD COLUMN     "error" TEXT;

-- ============================================================
-- Migrasi: 20260930020000_ai_endpoints
-- ============================================================
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

-- ============================================================
-- Migrasi: 20261002010000_labels
-- ============================================================
-- CreateTable
CREATE TABLE "Label" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "color" TEXT NOT NULL DEFAULT 'gray',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Label_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConversationLabel" (
    "conversationId" TEXT NOT NULL,
    "labelId" TEXT NOT NULL,
    "addedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConversationLabel_pkey" PRIMARY KEY ("conversationId","labelId")
);

-- CreateIndex
CREATE UNIQUE INDEX "Label_orgId_name_key" ON "Label"("orgId", "name");

-- CreateIndex
CREATE INDEX "ConversationLabel_labelId_idx" ON "ConversationLabel"("labelId");

-- AddForeignKey
ALTER TABLE "Label" ADD CONSTRAINT "Label_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationLabel" ADD CONSTRAINT "ConversationLabel_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationLabel" ADD CONSTRAINT "ConversationLabel_labelId_fkey" FOREIGN KEY ("labelId") REFERENCES "Label"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationLabel" ADD CONSTRAINT "ConversationLabel_addedById_fkey" FOREIGN KEY ("addedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ============================================================
-- Riwayat migrasi Prisma, supaya `prisma migrate deploy` tidak
-- mencoba membuat ulang tabel yang sudah ada.
-- ============================================================
CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
    "id"                  VARCHAR(36) PRIMARY KEY NOT NULL,
    "checksum"            VARCHAR(64) NOT NULL,
    "finished_at"         TIMESTAMPTZ,
    "migration_name"      VARCHAR(255) NOT NULL,
    "logs"                TEXT,
    "rolled_back_at"      TIMESTAMPTZ,
    "started_at"          TIMESTAMPTZ NOT NULL DEFAULT now(),
    "applied_steps_count" INTEGER NOT NULL DEFAULT 0
);

INSERT INTO "_prisma_migrations" ("id", "checksum", "finished_at", "migration_name", "applied_steps_count") VALUES
    ('aca49001-6794-4bac-bbb7-6c8a3e39cdf2', 'c2c14a4781b6e08f88dd77c8192dee9fa9bd321533b171986d9dc5cf560c6977', now(), '20260920005944_init', 1),
    ('1773c0ae-02fa-4522-94ac-af51adf189a0', '6d02d276c4ff326d4c5b3d0f138f5903d2f958c3ad0da904d3544b5db9ca2148', now(), '20260920014311_add_user_password', 1),
    ('4a507d3e-23e5-4159-8c10-a4679e3a1299', '1c0e646c61c420e7193bc188cc88d3df67f8e04b560e1ab349a6003e5823e518', now(), '20260920052716_org_meta_settings', 1),
    ('4719f87a-2282-4da1-a41f-5897ca9bd108', '3d1e96ede5e80f3d86ec24edc7019dff732bf38758748d6c82c7272a8cc781dd', now(), '20260920053744_waba_connections', 1),
    ('e90ab149-d250-4e6e-a476-b681ec948e08', '2732d26c87de84668705846672a7afe0c691ec5c33646efe9eea591db9b3c7ba', now(), '20260920063256_flow_enabled', 1),
    ('3e1e043b-773d-4cf2-bd3d-2d43170196a2', '2b192dce7598af70fb3e5c9f7dd7e787e4c7b22950e34d8927444cb848b2a31e', now(), '20260921115821_bot_auto_resume', 1),
    ('bae32f09-7416-4e53-9760-8cac46424e6e', 'dab4954d21e719a4043e29c7e82e0a51f78a1c836bcafa66146fad1a6a615780', now(), '20260922225500_outgoing_webhooks', 1),
    ('1aee89c8-a0e8-4c8a-99b3-53a5dd1eda40', '43843da7a79c3cb3d7fcb1e8227142edb1894ad440e9f9efa18df2ad45631f85', now(), '20260923010000_message_request_id', 1),
    ('70ad3a23-d3ab-4cf0-b35a-765b3648d8d3', '4bd570fe04c52e41e49e2184939233502c37c35e8e1c28fbdcfc1e47592aaac1', now(), '20260923020000_campaign_runner_and_key_channels', 1),
    ('63309e85-70e1-45d9-a800-7e10b8ef5f58', '08704fc009e78d167f7c8f1b0e15308bdcb711d0983ea480fa6c78fbab0b2deb', now(), '20260923021000_campaign_error', 1),
    ('b8a25ff7-472c-4c0c-9807-35491f4bf3ff', 'd7b59928e39754bcdcf5816f01023701b64ea9cbcfd9387163531864f154dbdd', now(), '20260930020000_ai_endpoints', 1),
    ('2837328e-7a74-4850-a93e-14dee032fa68', '118abcb0c7381b448de1319c8decf30d573b50a1ba62a76e6305c7e8fdbcf9a8', now(), '20261002010000_labels', 1);

-- ============================================================
-- Kunci Data API Supabase: RLS aktif tanpa policy = anon/authenticated
-- tidak bisa baca/tulis. Prisma (role postgres, pemilik tabel) tidak terpengaruh.
-- ============================================================
ALTER TABLE "Organization" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "User" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ChannelAccess" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Channel" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Contact" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Conversation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Message" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Template" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Flow" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FlowVersion" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FlowSession" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Trigger" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Campaign" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CampaignRecipient" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "WebhookEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AuditLog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ApiKey" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "WabaConnection" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "WebhookEndpoint" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "WebhookDelivery" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AiEndpoint" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Label" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ConversationLabel" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "_prisma_migrations" ENABLE ROW LEVEL SECURITY;

COMMIT;
