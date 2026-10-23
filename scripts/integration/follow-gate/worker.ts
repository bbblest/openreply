import { createDMWorker } from '@/lib/queue/dm-worker';
import { getRedisConnection, getDMQueue } from '@/lib/queue/client';
import { prisma } from '@/lib/db/client';

const redis = getRedisConnection();
// A real Redis commit followed by a stopped reply simulates death precisely
// between lease persistence and watchdog enqueue. No Redis result is fabricated.
if (process.env.TEST_PAUSE_AFTER_BEGIN_KEY) {
  const originalEval = redis.eval.bind(redis);
  redis.eval = (async (...args: Parameters<typeof originalEval>) => {
    const result = await originalEval(...args);
    if (result === 1 && args[2] === process.env.TEST_PAUSE_AFTER_BEGIN_KEY) {
      const next = JSON.parse(String(args[4]));
      if (next.state === 'checking') {
        process.send?.({ type: 'lease-persisted', pid: process.pid, key: args[2] });
        await new Promise(() => {});
      }
    }
    return result;
  }) as typeof redis.eval;
}
const worker = createDMWorker();
await worker.waitUntilReady();
process.send?.({ type: 'ready', pid: process.pid, concurrency: worker.opts.concurrency,
  lockDuration: worker.opts.lockDuration, stalledInterval: worker.opts.stalledInterval });
worker.on('completed', job => process.send?.({ type: 'completed', pid: process.pid, id: job.id }));
worker.on('failed', (job, error) => process.send?.({ type: 'failed', pid: process.pid, id: job?.id, error: error.message }));
worker.on('stalled', id => process.send?.({ type: 'stalled', pid: process.pid, id }));
process.on('message', async message => {
  if (message !== 'stop') return;
  await worker.close();
  await getDMQueue().close();
  await prisma.$disconnect();
  await redis.quit();
  process.exit(0);
});
