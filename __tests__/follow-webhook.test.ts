import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({
  add: vi.fn(), create: vi.fn(), update: vi.fn(),
}));
vi.mock("@/lib/queue/client", () => ({ getDMQueue: () => ({ add: m.add }), POSTBACK_JOB_NAME: "process-postback", MESSAGE_JOB_NAME: "process-message" }));
vi.mock("@/lib/db/client", () => ({ prisma: {
  instagramAccount: { findMany: async () => [{ id: "connection-test", instagramId: "owner-test", workspaceId: "workspace-test" }] },
  webhookEvent: { create: m.create, update: m.update },
} }));
import { parsePostbackEvents, parseMessageEvents } from "@/lib/meta/webhook";
import { processInstagramWebhook } from "@/lib/queue/process-webhook";

const time = 1792800000000;
function payload(mid?: string, timestamp = time, quick = false) {
  return { object: "instagram", entry: [{ id: "owner-test", time: timestamp / 1000, messaging: [{
    sender: { id: "person-test" }, timestamp,
    ...(quick ? { message: { mid, text: "禮物", quick_reply: { payload: "followcheck:campaign-test" } } }
      : { postback: { mid, payload: "followcheck:campaign-test" } }),
  }] }] };
}
beforeEach(() => { vi.resetAllMocks(); m.create.mockResolvedValue({ id: "webhook-test" }); m.update.mockResolvedValue({}); m.add.mockResolvedValue({}); });

describe("follow button event identity and durable enqueue", () => {
  it("handles quick replies once, without also triggering a keyword response", async () => {
    const event = payload("mid:test", time, true);
    expect(parseMessageEvents(event)).toHaveLength(0);
    expect(parsePostbackEvents(event)).toEqual([{ instagramAccountId: "owner-test", userId: "person-test", payload: "followcheck:campaign-test", mid: "mid:test", eventAt: time }]);
    await processInstagramWebhook({ payload: event, provider: "META" });
    expect(m.add).toHaveBeenCalledTimes(1);
  });

  it("identifies redelivery stably and distinguishes new mid-less taps by source time", async () => {
    for (const event of [payload(undefined), payload(undefined), payload(undefined, time + 500)]) {
      await processInstagramWebhook({ payload: event, provider: "META" });
    }
    const calls = m.add.mock.calls;
    expect(calls[0][2].jobId).toBe(calls[1][2].jobId);
    expect(calls[0][2].jobId).not.toBe(calls[2][2].jobId);
    expect(calls[0][2].jobId).not.toContain(":");
  });

  it("does not collapse distinct message ids after colon replacement", async () => {
    await processInstagramWebhook({ payload: payload("a:b"), provider: "META" });
    await processInstagramWebhook({ payload: payload("a_b"), provider: "META" });
    expect(m.add.mock.calls[0][2].jobId).not.toBe(m.add.mock.calls[1][2].jobId);
  });

  it("propagates queue failure so the HTTP caller cannot acknowledge lost work", async () => {
    m.add.mockRejectedValue(new Error("mock queue down"));
    await expect(processInstagramWebhook({ payload: payload("q"), provider: "META" })).rejects.toThrow("mock queue down");
    expect(m.update).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "FAILED" }) }));
  });

  it("uses source timestamps in seconds or milliseconds and suppresses own quick replies", () => {
    const seconds = payload("s"); delete (seconds.entry[0].messaging[0] as { timestamp?: number }).timestamp;
    expect(parsePostbackEvents(seconds)[0].eventAt).toBe(time);
    seconds.entry[0].time = time;
    expect(parsePostbackEvents(seconds)[0].eventAt).toBe(time);
    const own = payload("echo", time, true);
    own.entry[0].messaging[0].sender.id = "owner-test";
    expect(parsePostbackEvents(own)).toHaveLength(0);
  });
});
