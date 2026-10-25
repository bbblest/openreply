-- Keep every historical claim as round 1. No verification or send data is reset.
ALTER TABLE "GiftClaim" ADD COLUMN "round" INTEGER NOT NULL DEFAULT 1;
CREATE UNIQUE INDEX "GiftClaim_automationId_recipientId_round_key" ON "GiftClaim"("automationId", "recipientId", "round");
DROP INDEX "GiftClaim_automationId_recipientId_key";
