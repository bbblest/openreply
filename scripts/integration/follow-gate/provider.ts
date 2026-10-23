// Only Instagram's network boundary is substituted. Queue, Redis, DB, claims,
// follow state and retry timers are the unmodified application implementations.
export { MetaApiError, RateLimitError, TokenExpiredError, PermissionError } from '@/lib/meta/client';
export type { InstagramContext } from '@/lib/instagram/context';
type Args = { userId?: string; recipientId?: string; signal?: AbortSignal; [key: string]: unknown };
export function hasInstagramCredentials() { return true; }
export async function createInstagramContext() { return { provider: 'META' as const, accessToken: 'local-test-only' }; }
async function request(kind: string, args: Args) {
  const base = new URL(process.env.TEST_SINK_URL!);
  if (base.origin !== 'http://127.0.0.1:26480') throw new Error('Not the local test sink');
  const { signal } = args;
  const body = { ...args };
  delete body.signal;
  delete body.context;
  const result = await fetch(new URL('/' + kind, base), {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...body, pid: process.pid }), signal,
  });
  if (!result.ok) throw new Error(`Local sink HTTP ${result.status}`);
  return result.json();
}
export async function getUserFollowStatus(args: Args): Promise<boolean | null> {
  return (await request('read', args)).follows;
}
export const sendDirectMessage = (args: Args) => request('text', args);
export const sendDirectMessageWithButton = (args: Args) => request('button', args);
export const sendDirectMessageWithLinkButton = (args: Args) => request('link', args);
export const sendPrivateReplyWithButton = (args: Args) => request('private-button', args);
export const sendPrivateReplyWithLinkButton = (args: Args) => request('private-link', args);
export const sendPrivateReply = (args: Args) => request('private-text', args);
export const sendCommentReply = (args: Args) => request('comment', args);
