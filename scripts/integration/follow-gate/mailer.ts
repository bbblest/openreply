export class GiftMailError extends Error {
  constructor(message: string, public readonly deliveryUnconfirmed: boolean) { super(message); }
}
export function getGiftMailConfiguration() {
  return { ready: true, from: 'test@openreply.test', transport: 'smtp', missing: [] };
}
async function record(kind: string, body: unknown) {
  const response = await fetch('http://127.0.0.1:26480/' + kind, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error('Local mail sink failed');
  return { messageId: 'local-only' };
}
export const sendGiftVerificationEmail = (args: unknown) => record('verification-email', args);
export const sendGiftDeliveryEmail = (args: unknown) => record('gift-email', args);
