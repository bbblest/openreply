/** One bounded read; a provider ignoring AbortSignal cannot occupy a worker forever. */
export async function boundedFollowRead(
  read: (signal: AbortSignal) => Promise<boolean | null>,
): Promise<boolean | null> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve().then(() => read(controller.signal)).then(
        value => typeof value === "boolean" ? value : null,
        () => null,
      ),
      new Promise<null>(resolve => {
        timer = setTimeout(() => { controller.abort(); resolve(null); }, 8_000);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Only unavailable reads retry. A definite false is a final result. */
export async function checkFollowWithRetry(
  read: (signal: AbortSignal) => Promise<boolean | null>,
): Promise<{ follows: boolean | null; attempts: number }> {
  const first = await boundedFollowRead(read);
  if (first !== null) return { follows: first, attempts: 1 };
  await new Promise(resolve => setTimeout(resolve, 2_000));
  return { follows: await boundedFollowRead(read), attempts: 2 };
}
