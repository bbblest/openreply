-- CreateEnum
CREATE TYPE "GiftDeliveryStatus" AS ENUM ('PENDING', 'SENDING', 'SENT', 'FAILED', 'UNCONFIRMED');

-- AlterTable
ALTER TABLE "Automation" ADD COLUMN     "requireEmail" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "GiftContact" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "emailVerifiedAt" TIMESTAMP(3) NOT NULL,
    "marketingConsentAt" TIMESTAMP(3),
    "unsubscribedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GiftContact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GiftClaim" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "automationId" TEXT NOT NULL,
    "recipientId" TEXT NOT NULL,
    "recipientName" TEXT,
    "followConfirmedAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "email" TEXT,
    "emailVersion" INTEGER NOT NULL DEFAULT 0,
    "verificationTokenHash" TEXT,
    "verificationExpiresAt" TIMESTAMP(3),
    "verificationSentAt" TIMESTAMP(3),
    "verificationCount" INTEGER NOT NULL DEFAULT 0,
    "verificationWindowStart" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "verificationStatus" "GiftDeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "emailVerifiedAt" TIMESTAMP(3),
    "marketingConsent" BOOLEAN NOT NULL DEFAULT false,
    "contactId" TEXT,
    "igStatus" "GiftDeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "emailStatus" "GiftDeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "igSentAt" TIMESTAMP(3),
    "emailSentAt" TIMESTAMP(3),
    "igAttempts" INTEGER NOT NULL DEFAULT 0,
    "emailAttempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leaseId" TEXT,
    "leaseUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GiftClaim_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GiftContact_workspaceId_email_key" ON "GiftContact"("workspaceId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "GiftClaim_verificationTokenHash_key" ON "GiftClaim"("verificationTokenHash");

-- CreateIndex
CREATE INDEX "GiftClaim_workspaceId_createdAt_idx" ON "GiftClaim"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "GiftClaim_nextAttemptAt_idx" ON "GiftClaim"("nextAttemptAt");

-- CreateIndex
CREATE UNIQUE INDEX "GiftClaim_automationId_recipientId_key" ON "GiftClaim"("automationId", "recipientId");

-- AddForeignKey
ALTER TABLE "GiftContact" ADD CONSTRAINT "GiftContact_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GiftClaim" ADD CONSTRAINT "GiftClaim_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GiftClaim" ADD CONSTRAINT "GiftClaim_automationId_fkey" FOREIGN KEY ("automationId") REFERENCES "Automation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GiftClaim" ADD CONSTRAINT "GiftClaim_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "GiftContact"("id") ON DELETE SET NULL ON UPDATE CASCADE;
