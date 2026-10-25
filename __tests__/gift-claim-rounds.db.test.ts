import { randomBytes } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { Client } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "../app/generated/prisma/client";

const mocks = vi.hoisted(() => ({
  db: undefined as unknown as import("../app/generated/prisma/client").PrismaClient,
  verification: vi.fn(), delivery: vi.fn(), instagram: vi.fn(), follow: vi.fn(), queue: vi.fn(),
}));
vi.mock("@/lib/db/client", () => ({ get prisma() { return mocks.db; } }));
vi.mock("@/lib/instagram/provider", () => ({
  createInstagramContext: () => ({ provider: "META", accessToken: "local-only" }),
  getUserFollowStatus: mocks.follow, hasInstagramCredentials: () => true,
}));
vi.mock("@/lib/queue/client", () => ({
  GIFT_JOB_NAME: "gift", getDMQueue: () => ({ add: mocks.queue }),
  getRedisConnection: () => ({ eval: async () => 1 }),
}));
vi.mock("@/lib/gifts/mailer", () => ({
  getGiftMailConfiguration: () => ({ ready: true }),
  sendGiftVerificationEmail: mocks.verification, sendGiftDeliveryEmail: mocks.delivery,
  GiftMailError: class extends Error {},
}));
vi.mock("@/lib/gifts/mail-relay", () => ({ isGiftMailRelayConfigured: () => false }));

import { confirmGiftEmail, createGiftClaim, getGiftClaimView, processGiftDelivery, requestGiftVerification } from "../lib/gifts/claims";

const databaseUrl = process.env.TEST_DATABASE_URL;
const schema = `gift_rounds_${randomBytes(6).toString("hex")}`;
const migrationName = "20261025220000_gift_claim_rounds";
let sql: Client;
let migratedHistory: Record<string, unknown>;
let recipient: string;
const newClient = () => new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl, max: 8 }, { schema }) });
const revisit = () => createGiftClaim({ automationId: "automation", recipientId: recipient,
  recipientName: "本機虛構測試", followConfirmedAt: new Date() });
const deliver = (id: string) => processGiftDelivery(id, { sendInstagramGift: mocks.instagram });
const tokenFrom = (url: string) => new URL(url).searchParams.get("token")!;

describe.skipIf(!databaseUrl)("repeat claim rounds on isolated Postgres", () => {
  beforeAll(async () => {
    // Never accept a production DB as the integration test target.
    const target = new URL(databaseUrl!);
    if (target.hostname !== "127.0.0.1" || target.port !== "25432" || target.pathname !== "/openreply_integration") {
      throw new Error("Use only the dedicated loopback OpenReply-Test database");
    }
    vi.stubEnv("NEXTAUTH_SECRET", "isolated-rounds-test-secret");
    vi.stubEnv("NEXTAUTH_URL", "https://rounds.invalid");
    vi.stubEnv("REQUIRE_VERIFIED_EMAIL", "true");
    vi.stubEnv("REQUIRE_CONFIRMED_FOLLOW", "true");
    sql = new Client({ connectionString: databaseUrl });
    await sql.connect();
    await sql.query(`CREATE SCHEMA "${schema}"`);
    await sql.query(`SET search_path TO "${schema}"`);
    const root = path.join(__dirname, "..", "prisma", "migrations");
    for (const entry of readdirSync(root, { withFileTypes: true }).filter(e => e.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name === migrationName) continue;
      await sql.query(readFileSync(path.join(root, entry.name, "migration.sql"), "utf8"));
    }
    mocks.db = newClient();
    await mocks.db.user.create({ data: { id: "user", email: "rounds@local.test" } });
    await mocks.db.workspace.create({ data: { id: "workspace", name: "Local rounds", ownerId: "user" } });
    await mocks.db.instagramAccount.create({ data: { id: "account", workspaceId: "workspace",
      instagramId: "local_ig", username: "local_only", accessToken: "not-a-real-token" } });
    await mocks.db.automation.create({ data: { id: "automation", workspaceId: "workspace", instagramAccountId: "account",
      name: "Local", keywords: ["禮物"], dmMessage: "TEST GIFT", requireFollow: true, requireEmail: true } });
    await mocks.db.trackedLink.create({ data: { workspaceId: "workspace", automationId: "automation", slug: "rounds-local-gift",
      destinationUrl: "https://gift.invalid/local-test", label: "測試禮物" } });
    // Seed a genuinely pre-migration row, then compare every original column.
    await sql.query(`INSERT INTO "GiftClaim" ("id", "workspaceId", "automationId", "recipientId", "followConfirmedAt",
      "expiresAt", "email", "emailVersion", "emailVerifiedAt", "igStatus", "emailStatus", "igSentAt", "emailSentAt",
      "igAttempts", "emailAttempts", "updatedAt") VALUES ('history', 'workspace', 'automation', 'historical', now(),
      now() + interval '1 day', 'old@local.test', 2, now(), 'SENT', 'SENT', now(), now(), 1, 1, now())`);
    migratedHistory = (await sql.query('SELECT * FROM "GiftClaim" WHERE id = \'history\'')).rows[0];
    await sql.query(readFileSync(path.join(root, migrationName, "migration.sql"), "utf8"));
  }, 60_000);

  beforeEach(() => {
    recipient = randomBytes(8).toString("hex");
    vi.clearAllMocks();
    mocks.follow.mockResolvedValue(true);
    mocks.verification.mockResolvedValue({ messageId: "local-verification" });
    mocks.delivery.mockResolvedValue({ messageId: "local-delivery" });
    mocks.instagram.mockResolvedValue(undefined);
    mocks.queue.mockResolvedValue(undefined);
  });
  afterAll(async () => {
    await mocks.db?.$disconnect();
    if (sql) {
      await sql.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await sql.end();
    }
    vi.unstubAllEnvs();
  });

  it("migrates completed history to round 1 without changing any old column", async () => {
    const after = (await sql.query('SELECT * FROM "GiftClaim" WHERE id = \'history\'')).rows[0];
    expect(after).toEqual({ ...migratedHistory, round: 1 });
    recipient = "historical";
    const next = await revisit();
    expect(next.stage).toBe("unverified");
    expect(await mocks.db.giftClaim.findUnique({ where: { id: next.claimId } })).toMatchObject({ round: 2, email: null, emailVerifiedAt: null });
    expect((await sql.query('SELECT * FROM "GiftClaim" WHERE id = \'history\'')).rows[0]).toEqual(after);
  });

  it("coalesces 100 simultaneous first claims and resumes the same round after reconnect", async () => {
    const requests = await Promise.all(Array.from({ length: 100 }, revisit));
    expect(new Set(requests.map(r => r.claimId)).size).toBe(1);
    expect(await mocks.db.giftClaim.count({ where: { recipientId: recipient } })).toBe(1);
    await mocks.db.$disconnect();
    mocks.db = newClient();
    expect((await revisit()).claimId).toBe(requests[0].claimId);
    expect(mocks.queue).not.toHaveBeenCalled();
    expect(mocks.verification).not.toHaveBeenCalled();
  }, 30_000);

  it("requires a new email and token for each round, delivers each channel once, and preserves history", async () => {
    const first = await revisit();
    const firstAccess = tokenFrom(first.url);
    await requestGiftVerification({ token: firstAccess, email: "same@local.test", marketingConsent: false });
    const firstVerification = tokenFrom(mocks.verification.mock.calls[0][0].verificationUrl);
    await deliver(first.claimId);
    expect(mocks.instagram).not.toHaveBeenCalled();
    expect(mocks.delivery).not.toHaveBeenCalled();
    await confirmGiftEmail(firstVerification);
    await Promise.all(Array.from({ length: 20 }, () => deliver(first.claimId)));
    const complete = await mocks.db.giftClaim.findUniqueOrThrow({ where: { id: first.claimId } });
    expect(complete).toMatchObject({ round: 1, igStatus: "SENT", emailStatus: "SENT", igAttempts: 1, emailAttempts: 1 });
    expect(mocks.instagram).toHaveBeenCalledTimes(1);
    expect(mocks.delivery).toHaveBeenCalledTimes(1);
    await mocks.db.giftContact.update({ where: { id: complete.contactId! }, data: { unsubscribedAt: new Date() } });

    const requests = await Promise.all(Array.from({ length: 100 }, revisit));
    const second = requests[0];
    expect(new Set(requests.map(r => r.claimId)).size).toBe(1);
    expect(second.claimId).not.toBe(first.claimId);
    expect(requests.every(r => r.stage === "unverified")).toBe(true);
    expect(await mocks.db.giftClaim.findUnique({ where: { id: first.claimId } })).toEqual(complete);
    expect(await mocks.db.giftClaim.findUnique({ where: { id: second.claimId } })).toMatchObject({
      round: 2, email: null, emailVersion: 0, emailVerifiedAt: null, verificationTokenHash: null,
      contactId: null, marketingConsent: false, igStatus: "PENDING", emailStatus: "PENDING", igAttempts: 0, emailAttempts: 0,
    });
    const secondAccess = tokenFrom(second.url);
    expect(await getGiftClaimView(secondAccess)).toMatchObject({ stage: "email", emailMasked: null });
    expect(await getGiftClaimView(firstAccess)).toMatchObject({ stage: "complete" });
    await expect(confirmGiftEmail(firstVerification)).rejects.toThrow();
    await expect(requestGiftVerification({ token: firstAccess, email: "other@local.test", marketingConsent: false })).rejects.toThrow();
    await deliver(second.claimId);
    expect(mocks.instagram).toHaveBeenCalledTimes(1);
    expect(mocks.delivery).toHaveBeenCalledTimes(1);
    await requestGiftVerification({ token: secondAccess, email: "same@local.test", marketingConsent: false });
    const secondVerification = tokenFrom(mocks.verification.mock.calls[1][0].verificationUrl);
    expect(secondVerification).not.toBe(firstVerification);
    await deliver(second.claimId);
    expect(mocks.instagram).toHaveBeenCalledTimes(1);
    await confirmGiftEmail(secondVerification);
    // Follow must still be true at delivery time, even with the newly verified email.
    mocks.follow.mockResolvedValueOnce(false);
    await deliver(second.claimId);
    expect(mocks.instagram).toHaveBeenCalledTimes(1);
    await Promise.all(Array.from({ length: 20 }, () => deliver(second.claimId)));
    await deliver(second.claimId);
    expect(mocks.instagram).toHaveBeenCalledTimes(2);
    expect(mocks.delivery).toHaveBeenCalledTimes(2);
    expect(new Set(mocks.delivery.mock.calls.map(c => c[0].deliveryKey)).size).toBe(2);
    expect(new Set(mocks.verification.mock.calls.map(c => c[0].deliveryKey)).size).toBe(2);
    const secondDone = await mocks.db.giftClaim.findUniqueOrThrow({ where: { id: second.claimId } });
    expect(secondDone).toMatchObject({ round: 2, igStatus: "SENT", emailStatus: "SENT", igAttempts: 1, emailAttempts: 1 });
    expect((await mocks.db.giftContact.findUniqueOrThrow({ where: { id: secondDone.contactId! } })).unsubscribedAt).not.toBeNull();
    expect(await mocks.db.giftClaim.findUnique({ where: { id: first.claimId } })).toEqual(complete);
    const third = await revisit();
    expect(await mocks.db.giftClaim.findUnique({ where: { id: third.claimId } })).toMatchObject({ round: 3, email: null, emailVerifiedAt: null });
  }, 30_000);

  it.each(["PENDING", "FAILED", "SENDING", "UNCONFIRMED"] as const)("keeps incomplete %s delivery in its existing round", async (status) => {
    const first = await revisit();
    await mocks.db.giftClaim.update({ where: { id: first.claimId }, data: {
      igStatus: "SENT", igAttempts: 1, igSentAt: new Date(), emailStatus: status,
      emailAttempts: status === "FAILED" ? 3 : 1, lastError: "preserve audit state",
    } });
    const repeated = await revisit();
    expect(repeated.claimId).toBe(first.claimId);
    expect(await mocks.db.giftClaim.count({ where: { recipientId: recipient } })).toBe(1);
    expect(await mocks.db.giftClaim.findUnique({ where: { id: first.claimId } })).toMatchObject({
      round: 1, igStatus: "SENT", igAttempts: 1, emailStatus: status, lastError: "preserve audit state",
    });
  });
});
