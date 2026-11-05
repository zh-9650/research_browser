import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdir, writeFile, copyFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { chromium } from 'playwright';
import { Executor } from '../engine/executor.mjs';

test('SDK返回的观察对象不能修改执行器私有身份基线', async () => {
  const dir = resolve('traces', `observation-alias-${new Date().toISOString().replace(/[:.]/g,'-')}`);
  await mkdir(dir,{recursive:true});
  await copyFile('engine/executor.mjs', join(dir,'executor.mjs'));
  const commits = [];
  const server = http.createServer(async (req,res) => {
    if (req.url === '/submit') {
      let body='';for await(const chunk of req)body+=chunk;
      commits.push(Object.fromEntries(new URLSearchParams(body)));res.end('saved');return;
    }
    res.setHeader('Content-Type','text/html');
    res.end('<form id="form-a" method="post" action="/submit"><input type="hidden" name="invoice" value="A"><button>Save</button></form><form id="form-b" method="post" action="/submit"><input type="hidden" name="invoice" value="B"></form>');
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const origin=`http://127.0.0.1:${server.address().port}`;
  const browser=await chromium.launch({channel:'chrome'});
  const page=await browser.newPage();
  const e=new Executor(page,{journal:join(dir,'actions.jsonl'),grants:[{origin,kinds:['click']}]});
  try {
    await page.goto(origin);
    const observation=await e.observe();
    const target=observation.targets.find(t=>t.name==='Save');
    // UI/framework moves the same submitter. Separately, a caller annotates its
    // observation object. Neither may rewrite the executor's old identity baseline.
    await page.getByRole('button').evaluate(el=>document.getElementById('form-b').append(el));
    target.formOwner.id='form-b';
    const receipt=await e.act({operationId:'invoice-a',kind:'click',ref:target.ref});
    await writeFile(join(dir,'result.json'),JSON.stringify({receipt,commits},null,2));
    assert.equal(receipt.error,'TARGET_STALE');
    assert.deepEqual(commits,[]);
  } finally {await e.close();await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
});

test('字段读回支持模型判断，但不输出password值或暴露可改写的私有状态',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'browser-field-observe-'));
  const browser=await chromium.launch({channel:'chrome'});const page=await browser.newPage();
  const e=new Executor(page,{journal:join(dir,'actions.jsonl')});
  try{
    await page.setContent('<input aria-label="备注" value="原备注"><input type="password" aria-label="口令" value="TOP-SECRET"><select aria-label="城市"><option value="sz" selected>苏州</option><option value="nj">南京</option></select><label><input type="checkbox" checked>已复核</label>');
    const observation=await e.observe();
    assert.equal(JSON.stringify(observation).includes('TOP-SECRET'),false);
    assert.deepEqual(observation.targets.find(t=>t.name==='口令').fieldState,{sensitive:true,hasValue:true});
    assert.equal(observation.targets.find(t=>t.name==='备注').fieldState.value,'原备注');
    const select=observation.targets.find(t=>t.name==='城市');
    assert.equal(select.fieldState.value,'sz');assert.equal(select.fieldState.options[0].label,'苏州');
    assert.equal(observation.targets.find(t=>t.type==='checkbox').fieldState.checked,true);
    select.fieldState.options[0].label='caller mutation';
    const receipt=await e.act({operationId:'not-authorized',kind:'select',ref:select.ref,value:'sz'});
    assert.equal(receipt.error,'POLICY_DENIED');
  }finally{await e.close();await browser.close();}
});
