import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { Executor } from '../engine/executor.mjs';

test('S34 删除、发送和支付需要受信宿主审批，等待期间目标变化拒绝派发', {timeout:60000}, async t => {
  const writes=[];
  const server=createServer((req,res)=>{
    const url=new URL(req.url,'http://localhost');
    if(req.method==='POST'){
      writes.push(url.pathname);
      res.end('ok');
      return;
    }
    res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'}).end(`<!doctype html>
      <article><p>归档单 A-417</p><button onclick="fetch('/delete/A-417',{method:'POST'})">删除单据</button></article>
      <article><p>收件组 苏州仓储</p><button onclick="fetch('/send/SZ',{method:'POST'})">发送通知</button></article>
      <article><p id="invoice">账单 P-681 金额 120 元</p><button onclick="fetch('/pay/P-681',{method:'POST'})">支付账单</button></article>`);
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>{server.closeAllConnections();return new Promise(resolve=>server.close(resolve));});
  const origin=`http://127.0.0.1:${server.address().port}`;
  const browser=await chromium.launch({channel:'chrome'});
  t.after(()=>browser.close());
  const directory=resolve('traces',`sensitive-approval-${new Date().toISOString().replace(/[:.]/g,'-')}`);
  await mkdir(directory,{recursive:true});
  const page=await browser.newPage();
  await page.goto(origin);
  const grants=[{origin,kinds:['click']},
    ...[['删除单据','delete'],['发送通知','send'],['支付账单','pay']].map(([name,approval])=>({origin,kinds:['click'],name,approval}))];
  let executor=new Executor(page,{journal:join(directory,'no-approver.jsonl'),grants,timeout:3000});
  t.after(()=>executor.close());
  const click=async(name,operationId)=>{
    const target=(await executor.observe()).targets.find(item=>item.name===name);
    return executor.act({kind:'click',ref:target.ref,operationId});
  };
  const unavailable=await click('删除单据','delete-a');
  assert.equal(unavailable.error,'APPROVAL_REQUIRED');
  assert.deepEqual(writes,[]);
  await executor.close();
  const requests=[];
  executor=new Executor(page,{journal:join(directory,'approved.jsonl'),grants,timeout:3000,approveAction:async request=>{
    requests.push(request);
    if(request.scope==='delete') return false;
    if(request.scope==='pay') await page.locator('#invoice').evaluate(el=>{el.textContent='账单 P-681 金额 990 元';});
    return true;
  }});
  const deletion=await click('删除单据','delete-a');
  assert.equal(deletion.error,'APPROVAL_DENIED');
  const payment=await click('支付账单','pay-p');
  assert.equal(payment.error,'TARGET_STALE');
  assert.deepEqual(writes,[]);
  const [,sending]=await Promise.all([page.waitForResponse(response=>response.url()===origin+'/send/SZ',{timeout:8000}),
    click('发送通知','send-sz')]);
  assert.equal(sending.dispatch,'sent');
  const replay=await click('发送通知','send-sz');
  assert.equal(replay.error,'OPERATION_ALREADY_ATTEMPTED');
  assert.deepEqual(requests.map(request=>request.scope),['delete','pay','send']);
  assert.deepEqual(writes,['/send/SZ']);
  await writeFile(join(directory,'result.json'),JSON.stringify({browser:browser.version(),requests,unavailable,deletion,payment,sending,replay,writes},null,2));
  console.log(`S34 审批证据: ${directory}`);
});
