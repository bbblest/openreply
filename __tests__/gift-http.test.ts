import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { giftRequestBody } from "@/lib/gifts/http";
import { GET as getContacts } from "@/app/api/contacts/route";
import { csvCell } from "@/lib/gifts/csv";

const { context, contactQuery, pendingQuery } = vi.hoisted(() => ({ context: vi.fn(), contactQuery: vi.fn(), pendingQuery: vi.fn() }));
vi.mock("@/lib/workspace-access", () => ({ getCurrentWorkspaceContext: context, canManageWorkspace: (role: string) => role === "OWNER" || role === "ADMIN" }));
vi.mock("@/lib/db/client", () => ({ prisma: { giftContact: { findMany: contactQuery }, giftClaim: { findMany: pendingQuery } } }));

describe("gift requests and private contacts", () => {
  beforeEach(() => { vi.stubEnv("NEXTAUTH_URL", "https://gift.example.test"); vi.clearAllMocks(); contactQuery.mockResolvedValue([]); pendingQuery.mockResolvedValue([]); });
  afterEach(() => vi.unstubAllEnvs());
  it("rejects cross-origin mutations and oversized inputs", async () => {
    await expect(giftRequestBody(new NextRequest("https://gift.example.test/api", { method: "POST", headers: { origin: "https://evil.test" }, body: "{}" }))).rejects.toMatchObject({ status: 403 });
    await expect(giftRequestBody(new NextRequest("https://gift.example.test/api", { method: "POST", body: JSON.stringify({ text: "a".repeat(5000) }) }))).rejects.toMatchObject({ status: 413 });
  });
  it("blocks anonymous users and non-admin members before any email lookup", async () => {
    context.mockResolvedValue(null);
    expect((await getContacts(new NextRequest("https://gift.example.test/api/contacts"))).status).toBe(401);
    context.mockResolvedValue({ workspaceId: "one", role: "MEMBER" });
    expect((await getContacts(new NextRequest("https://gift.example.test/api/contacts"))).status).toBe(403);
    expect(contactQuery).not.toHaveBeenCalled();
  });
  it("scopes both verified and waiting email queries to the authenticated workspace", async () => {
    context.mockResolvedValue({ workspaceId: "one", role: "OWNER" });
    const res = await getContacts(new NextRequest("https://gift.example.test/api/contacts"));
    expect(res.status).toBe(200);
    expect(contactQuery.mock.calls[0][0].where).toEqual({ workspaceId: "one" });
    expect(pendingQuery.mock.calls[0][0].where.workspaceId).toBe("one");
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
  it("escapes Excel formula injection, embedded quotes and newlines in exports", () => {
    expect(csvCell("=HYPERLINK(\"bad\")")).toBe('"\'=HYPERLINK(""bad"")"');
    expect(csvCell(" +cmd")).toBe('"\' +cmd"');
    expect(csvCell("safe@example.test")).toBe('"safe@example.test"');
  });
});
