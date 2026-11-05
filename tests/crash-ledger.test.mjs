import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Journal } from '../engine/executor.mjs';

test('进程在fsync后非正常退出：残锁拒绝自动接管，人工核对清锁后保留未决意图', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'browser-crash-'));
  const file = join(dir, 'journal.jsonl');
  const moduleUrl = pathToFileURL(join(process.cwd(), 'engine/executor.mjs')).href;
  // args are passed directly, never shell-built from data or source content.
  const code = `import {Journal} from ${JSON.stringify(moduleUrl)}; const j=new Journal(process.argv[1]);j.append({event:'dispatch_intent',operationId:'write-before-crash'});process.exit(17);`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', code, file], { stdio: 'ignore' });
  assert.equal(await new Promise(resolve => child.on('exit', resolve)), 17);
  assert.throws(() => new Journal(file), { code: 'EEXIST' });
  // The test owns this exact temporary lock and has observed the writer exit.
  // This is deliberate operator recovery, not an automatic stale-lock heuristic.
  await unlink(file + '.lock');
  const recovered = new Journal(file);
  try { assert.equal(recovered.prior('write-before-crash')[0].event, 'dispatch_intent'); }
  finally { recovered.close(); }
});
