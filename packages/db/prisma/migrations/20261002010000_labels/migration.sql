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
