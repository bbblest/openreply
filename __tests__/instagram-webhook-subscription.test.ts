import { afterEach, expect, it, vi } from "vitest";
import { subscribeInstagramAccountToWebhooks } from "../lib/meta/client";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

it("subscribes the connected account to the distinct Meta events used by the gift flow", async () => {
  vi.stubEnv("META_GRAPH_API_VERSION", "v25.0");
  const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: true })));
  vi.stubGlobal("fetch", fetchMock);

  await expect(subscribeInstagramAccountToWebhooks("ig_account", "test_token"))
    .resolves.toEqual({ success: true });

  const [url, request] = fetchMock.mock.calls[0];
  expect(url).toBe("https://graph.instagram.com/v25.0/ig_account/subscribed_apps");
  expect(request.method).toBe("POST");
  expect(request.headers.Authorization).toBe("Bearer test_token");
  // Meta delivers these independently: messages alone cannot trigger a
  // follow-confirmation postback or the existing read-receipt fallback.
  expect(JSON.parse(request.body).subscribed_fields).toEqual(expect.arrayContaining([
    "comments", "messages", "messaging_postbacks", "messaging_seen",
  ]));
});
