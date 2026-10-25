import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { appendFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { Client } from 'pg';
import { prisma } from '@/lib/db/client';
import { getDMQueue, getRedisConnection, type ProcessPostbackJob } from '@/lib/queue/client';
import { followGateKey, type FollowGateState } from '@/lib/queue/follow-gate-state';
import { SAFE_FOLLOW_MESSAGES } from '@/lib/instagram/follow-policy';

type SinkEvent = { kind: string; user: string; at: number; pid: number; body: Record<string, unknown>; aborted?: boolean; endedAt?: number };
type Behavior = { follows?: boolean | null; delay?: number; hang?: boolean; blockResult?: boolean };
type WorkerRecord = { child: ChildProcess; ready: boolean; auto: boolean; stopped: boolean };
type CaseResult = { name: string; status: 'PASS' | 'FAIL'; durationMs: number; detail: unknown };
const root = process.env.TEST_ROOT!;
const evidence = process.env.TEST_EVIDENCE_DIR!;
const runId = 'it' + Date.now() + randomBytes(3).toString('hex');
const accountId = runId + 'account', campaignId = runId + 'campaign', workspaceId = runId + 'workspace';
const ownerId = runId + 'owner';
const logPath = path.join(evidence, '程序與事件紀錄.md');
mkdirSync(evidence, { recursive: true });
writeFileSync(logPath, `# 獨立整合測試原始事件\n\nRun: ${runId}\n\n`);
const log = (value: string) => appendFileSync(logPath, value + '\n');
const results: CaseResult[] = [], sinkEvents: SinkEvent[] = [], workers: WorkerRecord[] = [];
const behaviors = new Map<string, Behavior>();
const workerEvents: { type: string; pid: number; id?: string; [key: string]: unknown }[] = [];
const outcomes: Record<string, number> = {};
const redis = getRedisConnection();
let queue!: ReturnType<typeof getDMQueue>;
const sql = new Client({ connectionString: process.env.DATABASE_URL });
let closing = false;
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function until(check: () => unknown | Promise<unknown>, description: string, timeout = 30_000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (await check()) return;
    await delay(100);
  }
  throw new Error('Timed out: ' + description);
}
function events(user: string, kind?: string) { return sinkEvents.filter(e => e.user === user && (!kind || e.kind === kind)); }
function assertSerialReads(user: string) {
  const reads = events(user, 'read');
  assert(reads.length > 0);
  reads.slice(1).forEach((e, i) => assert(reads[i].endedAt !== undefined && reads[i].endedAt! <= e.at, 'No overlapping lookup for one user'));
  return reads.length;
}
function key(user: string) { return followGateKey(accountId, campaignId, user); }
async function state(user: string): Promise<FollowGateState | null> {
  const raw = await redis.get(key(user));
  return raw ? JSON.parse(raw) : null;
}
async function terminal(user: string, expected = 1, timeout = 30_000) {
  await until(() => events(user).filter(e => e.kind === 'button' || e.kind === 'link').length >= expected,
    user + ' terminal message', timeout);
  await until(async () => !(await state(user))?.settling, user + ' released state');
}
function startWorker(auto = false, extra: Record<string, string> = {}) {
  const child = spawn(process.execPath, ['--require', path.join(path.dirname(fileURLToPath(import.meta.url)), 'guard.cjs'), process.env.TEST_WORKER_BUNDLE!], {
    cwd: root, env: { ...process.env, ...extra }, windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  const record: WorkerRecord = { child, ready: false, auto, stopped: false };
  workers.push(record);
  child.stdout!.on('data', data => {
    const text = String(data); log(`[PID ${child.pid}] ${text.trimEnd()}`);
    for (const match of text.matchAll(/"outcome":"([^"]+)"/g)) outcomes[match[1]] = (outcomes[match[1]] ?? 0) + 1;
  });
  child.stderr!.on('data', data => log(`[PID ${child.pid} STDERR] ${String(data).trimEnd()}`));
  child.on('message', raw => {
    const message = raw as typeof workerEvents[number]; workerEvents.push(message);
    if (message.type === 'ready') { record.ready = true; log('READY ' + JSON.stringify(message)); }
    if (['failed', 'stalled', 'lease-persisted'].includes(message.type)) log(JSON.stringify(message));
  });
  child.on('exit', (code, signal) => {
    record.stopped = true;
    log(`EXIT pid=${child.pid} code=${code} signal=${signal} supervised=${record.auto}`);
    if (record.auto && !closing) setTimeout(() => startWorker(true), 250);
  });
  return record;
}
async function ready(record: WorkerRecord) { await until(() => record.ready || record.stopped, 'worker ready'); assert(record.ready); }
async function stopAll() {
  for (const w of workers) w.auto = false;
  for (const w of workers.filter(w => !w.stopped)) w.child.send('stop');
  await until(() => workers.every(w => w.stopped), 'graceful worker shutdown', 35_000);
}
async function killWorker(pid: number) {
  const w = workers.find(w => w.child.pid === pid && !w.stopped);
  assert(w, 'PID belongs to a test child');
  assert(w.child.kill('SIGKILL'), 'force termination sent');
  await until(() => w.stopped, 'child really terminated');
}
async function tap(user: string, mid: string, eventAt = Date.now()) {
  const data: ProcessPostbackJob = { accountConnectionId: accountId, instagramAccountId: ownerId,
    userId: user, payload: 'followcheck:' + campaignId, mid, eventAt };
  return queue.add('process-postback', data, { jobId: runId + '-' + mid, attempts: 1, removeOnComplete: false });
}
async function caseRun(name: string, run: () => Promise<unknown>) {
  console.log('START ' + name);
  const start = Date.now();
  try {
    const detail = await run();
    results.push({ name, status: 'PASS', durationMs: Date.now() - start, detail });
    console.log('PASS ' + name + ' ' + JSON.stringify(detail));
  } catch (error) {
    results.push({ name, status: 'FAIL', durationMs: Date.now() - start, detail: error instanceof Error ? error.message : String(error) });
    console.error('FAIL ' + name + ': ' + String(error));
  }
}
const server = createServer(async (request, response) => {
  try {
    let raw = ''; for await (const chunk of request) raw += chunk;
    const body = JSON.parse(raw || '{}');
    const user = String(body.userId ?? body.recipientId ?? body.commentId ?? 'mail');
    const kind = request.url!.slice(1);
    const event: SinkEvent = { kind, user, at: Date.now(), pid: body.pid ?? 0, body };
    sinkEvents.push(event);
    const b = behaviors.get(user) ?? {};
    response.on('close', () => { if (!response.writableEnded) event.aborted = true; });
    if ((kind === 'read' && b.hang) || (kind === 'button' && b.blockResult)) return;
    if (kind === 'read' && b.delay) await delay(b.delay);
    if (!response.destroyed) {
      event.endedAt = Date.now();
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify(kind === 'read' ? { follows: b.follows ?? false } : { message_id: runId + sinkEvents.length }));
    }
  } catch (error) { response.writeHead(500); response.end(String(error)); }
});

async function main() {
  assert.equal(new URL(process.env.DATABASE_URL!).hostname, '127.0.0.1');
  assert.equal(new URL(process.env.DATABASE_URL!).pathname, '/openreply_integration');
  assert.equal(new URL(process.env.REDIS_URL!).port, '26379');
  await sql.connect();
  const marker = await redis.get('openreply-integration-owner');
  if (!marker) { assert.equal(await redis.dbsize(), 0, 'Refuse unmarked nonempty Redis'); await redis.set('openreply-integration-owner', 'OpenReply-Test'); }
  else assert.equal(marker, 'OpenReply-Test');
  queue = getDMQueue();
  const existing = await sql.query("SELECT to_regclass('public.\"User\"') AS present");
  if (!existing.rows[0].present) {
    const migrations = path.join(root, 'prisma/migrations');
    for (const name of readdirSync(migrations).sort()) {
      if (name.endsWith('.toml')) continue;
      await sql.query(readFileSync(path.join(migrations, name, 'migration.sql'), 'utf8'));
    }
  } else {
    // This dedicated database predates migration bookkeeping. Preserve prior
    // evidence rows when upgrading its historical single-claim test schema.
    const rounds = await sql.query("SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='GiftClaim' AND column_name='round'");
    if (!rounds.rowCount) await sql.query(readFileSync(path.join(root,
      'prisma/migrations/20261025220000_gift_claim_rounds/migration.sql'), 'utf8'));
  }
  await prisma.user.create({ data: { id: runId + 'user', email: runId + '@openreply.test' } });
  await prisma.workspace.create({ data: { id: workspaceId, name: 'Isolated integration', ownerId: runId + 'user' } });
  await prisma.instagramAccount.create({ data: { id: accountId, workspaceId, instagramId: ownerId,
    username: 'local_only', accessToken: 'local-test-only' } });
  await prisma.automation.create({ data: { id: campaignId, workspaceId, instagramAccountId: accountId,
    name: 'Synthetic follow test', keywords: ['禮物'], dmMessage: 'PRIVATE_GIFT_NOT_ALLOWED_BEFORE_EMAIL',
    requireFollow: true, requireEmail: true, dmTriggerEnabled: true, matchAnyPost: true } });
  await new Promise<void>(resolve => server.listen(26480, '127.0.0.1', resolve));
  log('ENV ' + JSON.stringify({ runId, redis: (await redis.info('server')).match(/redis_version:([^\r]+)/)?.[1],
    postgres: (await sql.query('SHOW server_version')).rows[0].server_version,
    node: process.version, queue: 'real BullMQ', api: 'loopback sink', productionAccess: false }));
  const pool = Array.from({ length: 4 }, () => startWorker());
  await Promise.all(pool.map(ready));

  await caseRun('4 程序：同人 1000 次連按', async () => {
    const user = runId + 'burst'; behaviors.set(user, { follows: false, delay: 4000 });
    const start = Date.now();
    const jobs = await queue.addBulk(Array.from({ length: 1000 }, (_, i) => ({ name: 'process-postback',
      data: { accountConnectionId: accountId, instagramAccountId: ownerId, userId: user,
        payload: 'followcheck:' + campaignId, mid: 'burst-' + i, eventAt: start + i },
      opts: { jobId: runId + '-burst-' + i, attempts: 1, removeOnComplete: false } })));
    await terminal(user);
    await until(async () => (await Promise.all(jobs.map(j => j.getState()))).every(s => s === 'completed'), '1000 jobs complete');
    const reads = assertSerialReads(user);
    assert.equal(events(user, 'button').length, 1000);
    const pending = events(user, 'button').filter(e => e.body.text === SAFE_FOLLOW_MESSAGES.checkInProgress).length;
    assert.equal(pending + reads, 1000);
    assert(events(user, 'button').every(e => [SAFE_FOLLOW_MESSAGES.checkInProgress, SAFE_FOLLOW_MESSAGES.retryPrompt].includes(e.body.text as never)));
    assert.equal(await prisma.giftClaim.count({ where: { automationId: campaignId, recipientId: user } }), 0);
    const pids = new Set(workerEvents.filter(e => e.type === 'completed' && e.id?.startsWith(runId + '-burst-')).map(e => e.pid));
    assert.equal(pids.size, 4);
    // Replay exactly the same Meta events with different queue ids: PG dedupe
    // must still prevent additional responses after the entire burst settled.
    const replays = await queue.addBulk(jobs.map((job, i) => ({ name: job.name, data: job.data,
      opts: { jobId: runId + '-replay-' + i, attempts: 1, removeOnComplete: false } })));
    await until(async () => (await Promise.all(replays.map(j => j.getState()))).every(s => s === 'completed'), '1000 replay jobs complete');
    assert.equal(events(user, 'button').length, 1000); assert.equal(events(user, 'read').length, reads);
    return { events: 1000, processes: pids.size, reads, replies: 1000, pendingReplies: pending, replayedWithoutResend: 1000, elapsedMs: Date.now() - start };
  });

  await caseRun('4 程序：100 人各按 10 次，50 人追蹤／50 人未追蹤', async () => {
    const start = Date.now();
    const users = Array.from({ length: 100 }, (_, i) => runId + 'person' + i);
    users.forEach((u, i) => behaviors.set(u, { follows: i % 2 === 0, delay: 100 }));
    const jobs = await queue.addBulk(Array.from({ length: 1000 }, (_, i) => {
      const u = users[i % 100];
      return { name: 'process-postback', data: { accountConnectionId: accountId, instagramAccountId: ownerId,
        userId: u, payload: 'followcheck:' + campaignId, mid: 'people-' + i, eventAt: start + Math.floor(i / 100) * 100 },
        opts: { jobId: runId + '-people-' + i, attempts: 1, removeOnComplete: false } };
    }));
    await until(async () => (await Promise.all(jobs.map(j => j.getState()))).every(s => s === 'completed'), '1000 mixed jobs complete', 60_000);
    users.forEach((u, i) => {
      assertSerialReads(u);
      assert.equal(events(u, 'link').length + events(u, 'button').length, 10);
      if (i % 2 !== 0) assert.equal(events(u, 'link').length, 0);
    });
    assert.equal(await prisma.giftClaim.count({ where: { automationId: campaignId } }), 50);
    assert.equal(await prisma.giftClaim.count({ where: { automationId: campaignId, OR: [{ emailVerifiedAt: { not: null } }, { igSentAt: { not: null } }, { emailSentAt: { not: null } }] } }), 0);
    assert.equal(sinkEvents.filter(e => e.kind.includes('email')).length, 0);
    return { people: 100, events: 1000, reads: users.reduce((n, u) => n + events(u, 'read').length, 0), replies: 1000, unverifiedClaims: 50, gifts: 0, elapsedMs: Date.now() - start };
  });

  await caseRun('20 人同時 API 不回應：真實 8＋2＋8 秒逾時', async () => {
    const users = Array.from({ length: 20 }, (_, i) => runId + 'timeout' + i);
    users.forEach(u => behaviors.set(u, { hang: true }));
    await Promise.all(users.map(u => tap(u, u)));
    await Promise.all(users.map(u => terminal(u, 1, 30_000)));
    const durations = users.map(u => {
      assert.equal(events(u, 'read').length, 2); assert.equal(events(u, 'text').length, 1);
      assert.equal(events(u, 'button').length, 1); assert.equal(events(u, 'link').length, 0);
      assert.equal(events(u, 'button')[0].body.text, SAFE_FOLLOW_MESSAGES.unknown);
      return events(u, 'button')[0].at - events(u, 'read')[0].at;
    });
    await until(() => users.every(u => events(u, 'read').every(e => e.aborted)), '40 HTTP requests aborted');
    assert(Math.min(...durations) >= 17_900); assert(Math.max(...durations) < 23_000);
    return { people: 20, abortedRequests: 40, terminalMessages: 20, minimumMs: Math.min(...durations), maximumMs: Math.max(...durations) };
  });

  await caseRun('連續六次未追蹤每次回覆，隨後追蹤立即查核', async () => {
    const user = runId + 'repeat';
    for (let i = 0; i < 6; i++) {
      const job = await tap(user, 'repeat-' + i);
      await until(async () => await job.getState() === 'completed', 'tap completed');
      await terminal(user, i + 1);
    }
    assert.equal(events(user, 'read').length, 6); assert.equal(events(user, 'button').length, 6);
    assert(events(user, 'button').every(e => e.body.text === SAFE_FOLLOW_MESSAGES.retryPrompt));
    assert.equal((await state(user))?.state, 'prompted');
    behaviors.set(user, { follows: true });
    const job = await tap(user, 'now-following');
    await until(async () => await job.getState() === 'completed', 'following tap completed');
    assert.equal(events(user, 'read').length, 7); assert.equal(events(user, 'link').length, 1);
    const claim = await prisma.giftClaim.findFirstOrThrow({ where: { automationId: campaignId, recipientId: user } });
    assert.equal(claim.emailVerifiedAt, null); assert.equal(claim.igSentAt, null); assert.equal(claim.emailSentAt, null);
    return { falseChecks: 6, negativeReplies: 6, immediateFollowCheck: true, unverifiedClaims: 1, gifts: 0 };
  });
  await stopAll();

  await caseRun('查詢中強殺程序，監督程序自動重啟及 45 秒補救', async () => {
    const w = startWorker(true); await ready(w);
    const user = runId + 'crash-read'; behaviors.set(user, { hang: true });
    const job = await tap(user, 'crash-read');
    await until(() => events(user, 'read').length === 1, 'lookup started');
    const saved = (await state(user))!;
    assert(await queue.getJob('follow_timeout_' + saved.currentCheckId));
    const oldPid = events(user, 'read')[0].pid; await killWorker(oldPid);
    await until(() => workers.some(w => !w.stopped && w.ready && w.child.pid !== oldPid), 'automatic replacement');
    await terminal(user, 1, 60_000);
    assert.equal(events(user, 'button')[0].body.text, SAFE_FOLLOW_MESSAGES.unknown);
    assert.equal(events(user, 'read').length, 1);
    const elapsed = events(user, 'button')[0].at - saved.checkStartedAt;
    assert(elapsed >= 45_000 && elapsed < 52_000);
    await until(async () => await job.getState() === 'completed', 'stalled original redelivered', 65_000);
    assert.equal(events(user, 'button').length, 1);
    const after = runId + 'after-crash'; await tap(after, 'after-crash'); await terminal(after);
    return { killedPid: oldPid, recoveryMs: elapsed, reads: 1, recoveredOnce: true, newJobSucceeded: true };
  });
  await stopAll();

  await caseRun('全部 worker 停止＋Redis 強殺重啟，持久資料恢復', async () => {
    const w = startWorker(); await ready(w);
    const user = runId + 'redis-crash'; behaviors.set(user, { hang: true });
    const job = await tap(user, 'redis-crash');
    await until(() => events(user, 'read').length === 1, 'lookup before full outage');
    const saved = (await state(user))!;
    const original = await redis.get(key(user));
    await killWorker(w.child.pid!);
    const command = spawnSync('wsl.exe', ['--distribution', 'OpenReply-Test', '--user', 'root', '--exec', 'sh',
      '/mnt/d/桌面資料/codex的家/openreply/scripts/integration/follow-gate/services.sh', 'restart-redis'], { encoding: 'utf8', windowsHide: true, timeout: 20_000 });
    log('REDIS RESTART ' + command.stdout + command.stderr); assert.equal(command.status, 0);
    await until(async () => await redis.ping() === 'PONG', 'Redis reconnect');
    assert.equal(await redis.get(key(user)), original);
    assert(await queue.getJob('follow_timeout_' + saved.currentCheckId));
    await delay(Math.max(0, saved.deadline + 2000 - Date.now()));
    assert.equal(events(user, 'button').length, 0, 'No worker cannot deliver');
    const resumedAt = Date.now(); const replacement = startWorker(); await ready(replacement);
    await terminal(user, 1, 15_000);
    assert.equal(events(user, 'button')[0].body.text, SAFE_FOLLOW_MESSAGES.unknown);
    await until(async () => await job.getState() === 'completed', 'outage original job recovered', 65_000);
    assert.equal(events(user, 'read').length, 1); assert.equal(events(user, 'button').length, 1);
    return { aofPreserved: true, watchdogPreserved: true, afterRestartMs: events(user, 'button')[0].at - resumedAt, totalMs: events(user, 'button')[0].at - saved.checkStartedAt };
  });
  await stopAll();

  await caseRun('結果已被接收後強殺：重啟不重寄，保留不明結果', async () => {
    const w = startWorker(true); await ready(w);
    const user = runId + 'crash-send'; behaviors.set(user, { follows: false, blockResult: true });
    const job = await tap(user, 'crash-send');
    await until(() => events(user, 'button').length === 1, 'receiver accepted response');
    const saved = (await state(user))!; assert(saved.settling);
    assert(await prisma.postbackDelivery.findUnique({ where: { id: saved.currentCheckId } }));
    await killWorker(events(user, 'button')[0].pid);
    await until(async () => !(await state(user))!.settling, 'uncertain delivery settled by watchdog', 60_000);
    await until(async () => await job.getState() === 'completed', 'original delivery replay', 65_000);
    assert.equal(events(user, 'button').length, 1); assert.equal(events(user, 'read').length, 1);
    assert((await redis.lrange('alerts:worker:dm', 0, 24)).some(s => s.includes('未確認送達')));
    return { receiverAcceptances: 1, reads: 1, durableDedupe: true, alertRecorded: true };
  });
  await stopAll();

  await caseRun('極窄中斷點：Redis 已存檢查狀態、補救工作尚未入列', async () => {
    const user = runId + 'crash-before-watchdog';
    const w = startWorker(true, { TEST_PAUSE_AFTER_BEGIN_KEY: key(user) }); await ready(w);
    const job = await tap(user, 'crash-before-watchdog');
    await until(() => workerEvents.some(e => e.type === 'lease-persisted' && e.pid === w.child.pid), 'real Redis commit failpoint');
    const saved = (await state(user))!;
    assert.equal(await queue.getJob('follow_timeout_' + saved.currentCheckId), undefined);
    await killWorker(w.child.pid!);
    await terminal(user, 1, 100_000);
    assert.equal(events(user, 'read').length, 0);
    assert.equal(events(user, 'button')[0].body.text, SAFE_FOLLOW_MESSAGES.unknown);
    await until(async () => await job.getState() === 'completed', 'gap original completed');
    assert.equal(events(user, 'button').length, 1);
    return { killedAfterRealCommit: true, reads: 0, recoveredOnce: true, recoveryMs: events(user, 'button')[0].at - saved.checkStartedAt };
  });

  assert.equal(sinkEvents.filter(e => e.kind.includes('email')).length, 0);
  log('QUEUE ' + JSON.stringify(await queue.getJobCounts()));
  log('OUTCOMES ' + JSON.stringify(outcomes));
  log('RESULTS ' + JSON.stringify(results));
}

try { await main(); }
catch (error) { console.error(error); results.push({ name: 'Harness', status: 'FAIL', durationMs: 0, detail: String(error) }); }
finally {
  closing = true;
  for (const w of workers) { w.auto = false; if (!w.stopped) w.child.kill('SIGKILL'); }
  await delay(300);
  server.closeAllConnections(); server.close();
  await queue?.close().catch(() => {}); await prisma.$disconnect().catch(() => {});
  redis.disconnect(); await sql.end().catch(() => {});
  const rows = results.map(r => `| ${r.name} | ${r.status} | ${r.durationMs} | ${JSON.stringify(r.detail)} |`).join('\n');
  writeFileSync(path.join(evidence, '整合測試結果.md'), `# 階段 1-B 獨立環境測試\n\nRun: ${runId}\n\n日期：${new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Taipei' })}（台灣）\n\n真實 Redis／PostgreSQL／BullMQ／獨立 Node 程序；Instagram 與寄信使用本機接收器。\n\n| 情境 | 結果 | 毫秒 | 實測 |\n| --- | --- | --- | --- |\n${rows}\n\n未部署；沒有真人投遞；沒有改階段 2。\n`);
  writeFileSync(path.join(evidence, '本機接收事件.md'), '# 本機接收事件\n\n```json\n' + JSON.stringify(sinkEvents, null, 2) + '\n```\n');
  console.log('EVIDENCE ' + evidence);
  process.exitCode = results.some(r => r.status === 'FAIL') ? 1 : 0;
}
