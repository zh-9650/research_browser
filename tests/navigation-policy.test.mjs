import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { Executor } from '../engine/executor.mjs';

test('显式链接/表单目的地：未授权跨域与脚本URL拒绝，授权跨域导航可用', async () => {
  let destinationRequests = 0;
  const destination = http.createServer((req,res) => { destinationRequests++; res.end('<h1>allowed destination</h1>'); });
  await new Promise(resolve => destination.listen(0, '127.0.0.1', resolve));
  const secondOrigin = `http://127.0.0.1:${destination.address().port}`;
  const source = http.createServer((req,res) => {
    res.setHeader('Content-Type','text/html');
    res.end(`<a href="${secondOrigin}/">Outside</a><a href="javascript:fetch('${secondOrigin}/')">Script</a><form action="${secondOrigin}/" method="post"><button>Send</button></form>`);
  });
  await new Promise(resolve => source.listen(0,'127.0.0.1',resolve));
  const origin = `http://127.0.0.1:${source.address().port}`;
  const dir = await mkdtemp(join(tmpdir(),'browser-nav-policy-'));
  const b = await chromium.launch({ channel:'chrome' });
  const p = await b.newPage();
  let e = new Executor(p,{ journal:join(dir,'denied.jsonl'),grants:[{origin,kinds:['click']}] });
  try {
    await p.goto(origin);
    const obs = await e.observe();
    for (const target of obs.targets) assert.equal((await e.act({operationId:target.name,kind:'click',ref:target.ref})).error,'POLICY_DENIED');
    assert.equal(destinationRequests,0);
    await e.close();
    e = new Executor(p,{journal:join(dir,'allowed.jsonl'),grants:[{origin,kinds:['click']},{origin:secondOrigin,kinds:['click']}]});
    const fresh = await e.observe();
    const navigated = p.waitForURL(secondOrigin + '/');
    assert.equal((await e.act({operationId:'authorized-link',kind:'click',ref:fresh.targets.find(t=>t.name==='Outside').ref})).dispatch,'sent');
    await navigated;
    assert.equal(new URL(p.url()).origin,secondOrigin);
    assert.ok(destinationRequests >= 1);
  } finally { await e.close();await b.close(); source.closeAllConnections();destination.closeAllConnections();await Promise.all([new Promise(r=>source.close(r)),new Promise(r=>destination.close(r))]); }
});
