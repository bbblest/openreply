import { build } from 'esbuild';
import { mkdirSync, copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { spawn } from 'node:child_process';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');
const output = process.argv[2];
if (!output || !path.isAbsolute(output)) throw new Error('Pass an absolute evidence directory');
const bundle = path.join(root, 'node_modules/.cache/openreply-follow-integration');
mkdirSync(bundle, { recursive: true });
mkdirSync(output, { recursive: true });
const built = await build({
  absWorkingDir: root, entryPoints: [path.join(here, 'driver.ts'), path.join(here, 'worker.ts')],
  outdir: bundle, bundle: true, platform: 'node', format: 'esm', packages: 'external',
  sourcemap: true, metafile: true, target: 'node24', tsconfig: path.join(root, 'tsconfig.json'),
  outExtension: { '.js': '.mjs' },
  plugins: [{ name: 'local-delivery-only', setup(b) {
    b.onResolve({ filter: /(?:instagram\/provider|gifts\/mailer|^\.\/mailer)$/ }, args => ({
      path: path.join(here, args.path.includes('provider') ? 'provider.ts' : 'mailer.ts'),
    }));
  } }],
});
copyFileSync(path.join(here, 'guard.cjs'), path.join(bundle, 'guard.cjs'));
const inputs = [...new Set([...Object.keys(built.metafile.inputs), 'package-lock.json',
  'scripts/integration/follow-gate/run.mjs', 'scripts/integration/follow-gate/guard.cjs',
  'scripts/integration/follow-gate/services.sh'])].sort();
const fingerprints = inputs.map(name => `| ${name} | ${createHash('sha256').update(readFileSync(path.resolve(root, name))).digest('hex')} |`);
writeFileSync(path.join(output, '實跑來源指紋.md'), '# 實跑來源指紋\n\n根目錄：' + root +
  '\n\n包括實際打包輸入、鎖定依賴與啟動／隔離腳本；沒有複製 .env。\n\n| 路徑 | SHA-256 |\n| --- | --- |\n' + fingerprints.join('\n') + '\n');
// Do not inherit production configuration or read any .env file.
const env = {};
for (const key of ['PATH', 'Path', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'COMSPEC', 'ComSpec', 'USERPROFILE', 'LOCALAPPDATA']) {
  if (process.env[key]) env[key] = process.env[key];
}
Object.assign(env, {
  NODE_ENV: 'test', OPENREPLY_INTEGRATION: 'local-only',
  DATABASE_URL: 'postgresql://openreply_test:openreply-local-test@127.0.0.1:25432/openreply_integration',
  REDIS_URL: 'redis://127.0.0.1:26379/0', DB_POOL_MAX: '5',
  NEXTAUTH_URL: 'http://127.0.0.1:26480', NEXTAUTH_SECRET: 'isolated-integration-signing-key-not-for-production',
  REQUIRE_VERIFIED_EMAIL: 'true', REQUIRE_CONFIRMED_FOLLOW: 'true',
  TEST_SINK_URL: 'http://127.0.0.1:26480', TEST_ROOT: root, TEST_EVIDENCE_DIR: output,
  TEST_WORKER_BUNDLE: path.join(bundle, 'worker.mjs'),
});
const child = spawn(process.execPath, ['--require', path.join(bundle, 'guard.cjs'), path.join(bundle, 'driver.mjs')], {
  cwd: root, env, windowsHide: true, stdio: 'inherit',
});
child.on('exit', code => { process.exitCode = code ?? 1; });
