import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    automation: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    workspace: { findUnique: vi.fn() },
    instagramAccount: { findFirst: vi.fn() },
    dmLog: { groupBy: vi.fn() },
    linkClick: { groupBy: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock("@/lib/db/client", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/auth", () => ({
  getCurrentWorkspaceId: vi.fn().mockResolvedValue("workspace_1"),
}));
vi.mock("@/lib/workspace-access", () => ({
  getCurrentWorkspaceContext: vi.fn().mockResolvedValue({
    workspaceId: "workspace_1",
    role: "OWNER",
  }),
  canManageWorkspace: vi.fn().mockReturnValue(true),
}));
vi.mock("@/lib/instagram-accounts", () => ({
  getWorkspaceInstagramAccount: vi.fn().mockResolvedValue({ id: "account_1" }),
}));
vi.mock("@/lib/campaigns/links", () => ({
  buildInitialCampaignLinks: vi.fn().mockReturnValue([]),
  syncCampaignLinks: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/reports/share", () => ({
  generateReportShareSlug: () => "new_report",
  buildReportUrl: (slug: string) => `https://example.com/reports/${slug}`,
}));
vi.mock("@/lib/tracking/server", () => ({
  generateTrackedLinkSlug: () => "new_link",
}));
vi.mock("@/lib/tracking/message", () => ({
  buildTrackedUrl: (slug: string) => `https://example.com/r/${slug}`,
}));

import { GET, PATCH, POST } from "../app/api/automations/route";
import { POST as importCampaigns } from "../app/api/automations/import/route";
import { duplicateCampaign } from "../lib/campaigns/duplicate";
import { SAFE_FOLLOW_MESSAGES } from "../lib/instagram/follow-policy";

const legacyCampaign = {
  id: "campaign_1",
  workspaceId: "workspace_1",
  instagramAccountId: "account_1",
  name: "Gift",
  postId: "post_1",
  keywords: ["GIFT"],
  dmMessage: "Final gift: https://example.com/private-gift",
  requireFollow: false,
  publicReplyEnabled: true,
  publicReplyMessage: "Public leak: https://example.com/private-gift",
  publicReplyMessages: ["Public leak: GIFT-CODE"],
  openingDmEnabled: true,
  openingDmMessage: "Opening leak: GIFT-CODE",
  openingDmButtonLabel: "GIFT-CODE",
  followPromptMessage: "Prompt leak: GIFT-CODE",
  followPromptButtonLabel: "GIFT-CODE",
  reportShareSlug: "report_1",
  trackedLinks: [],
};

const protectedSettings = {
  requireFollow: true,
  publicReplyMessage: SAFE_FOLLOW_MESSAGES.publicReply,
  publicReplyMessages: [SAFE_FOLLOW_MESSAGES.publicReply],
  openingDmMessage: SAFE_FOLLOW_MESSAGES.opening,
  openingDmButtonLabel: SAFE_FOLLOW_MESSAGES.button,
  followPromptMessage: SAFE_FOLLOW_MESSAGES.prompt,
  followPromptButtonLabel: SAFE_FOLLOW_MESSAGES.button,
};

function request(method: string, body?: unknown) {
  return new NextRequest("http://localhost/api/automations?id=campaign_1", {
    method,
    ...(body === undefined
      ? {}
      : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("REQUIRE_CONFIRMED_FOLLOW", "true");
  mockPrisma.automation.findFirst.mockResolvedValue(legacyCampaign);
  mockPrisma.automation.findMany.mockResolvedValue([legacyCampaign]);
  mockPrisma.automation.create.mockImplementation(async ({ data }) => ({
    id: "new_campaign",
    ...data,
  }));
  mockPrisma.automation.update.mockImplementation(async ({ data }) => ({
    ...legacyCampaign,
    ...data,
  }));
  mockPrisma.workspace.findUnique.mockResolvedValue({ id: "workspace_1" });
  mockPrisma.instagramAccount.findFirst.mockResolvedValue({ id: "account_1" });
  mockPrisma.dmLog.groupBy.mockResolvedValue([]);
  mockPrisma.linkClick.groupBy.mockResolvedValue([]);
  mockPrisma.$transaction.mockImplementation(async (run) => run(mockPrisma));
});

afterEach(() => vi.unstubAllEnvs());

describe("deployment follow policy at campaign boundaries", () => {
  it("returns actual enforced settings for a legacy campaign without altering its gift", async () => {
    const response = await GET(request("GET"));
    expect(response.status).toBe(200);
    const { data } = await response.json();
    expect(data[0]).toMatchObject({ ...protectedSettings, dmMessage: legacyCampaign.dmMessage });
  });

  it("cannot create a campaign that opts out or puts a gift in pre-verification text", async () => {
    const response = await POST(request("POST", legacyCampaign));
    expect(response.status).toBe(201);
    expect(mockPrisma.automation.create.mock.calls[0][0].data).toMatchObject({
      ...protectedSettings,
      publicReplyEnabled: true,
      openingDmEnabled: true,
      dmMessage: legacyCampaign.dmMessage,
    });
  });

  it("cannot patch follow protection away or replace protected messages", async () => {
    const response = await PATCH(request("PATCH", legacyCampaign));
    expect(response.status).toBe(200);
    expect(mockPrisma.automation.update.mock.calls[0][0].data).toMatchObject({
      ...protectedSettings,
      dmMessage: legacyCampaign.dmMessage,
    });
  });

  it("enforces old campaigns on sparse activation patches without changing optional steps", async () => {
    const response = await PATCH(request("PATCH", { isActive: true }));
    expect(response.status).toBe(200);
    const written = mockPrisma.automation.update.mock.calls[0][0].data;
    expect(written).toMatchObject({ ...protectedSettings, isActive: true });
    expect(written).not.toHaveProperty("openingDmEnabled");
    expect(written).not.toHaveProperty("publicReplyEnabled");
    expect(written).not.toHaveProperty("dmMessage");
  });

  it("enforces campaigns created by direct import", async () => {
    mockPrisma.automation.findMany.mockResolvedValue([]);
    const response = await importCampaigns(request("POST", {
      instagramAccountId: "account_1",
      campaigns: [legacyCampaign],
    }));
    expect(response.status).toBe(200);
    expect(mockPrisma.automation.create.mock.calls[0][0].data).toMatchObject({
      ...protectedSettings,
      dmMessage: legacyCampaign.dmMessage,
    });
  });

  it("enforces copied legacy settings and keeps the copy paused", async () => {
    await duplicateCampaign({ automationId: "campaign_1", workspaceId: "workspace_1" });
    expect(mockPrisma.automation.create.mock.calls[0][0].data).toMatchObject({
      ...protectedSettings,
      dmMessage: legacyCampaign.dmMessage,
      isActive: false,
    });
  });

  it("preserves configurable messages on deployments without the forced policy", async () => {
    vi.stubEnv("REQUIRE_CONFIRMED_FOLLOW", "false");
    const response = await POST(request("POST", { ...legacyCampaign, requireFollow: true }));
    expect(response.status).toBe(201);
    expect(mockPrisma.automation.create.mock.calls[0][0].data).toMatchObject({
      requireFollow: true,
      openingDmMessage: legacyCampaign.openingDmMessage,
      followPromptMessage: legacyCampaign.followPromptMessage,
      dmMessage: legacyCampaign.dmMessage,
    });
  });
});
