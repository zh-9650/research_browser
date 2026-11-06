import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { Executor, Journal } from '../engine/executor.mjs';
import { TaskState } from '../engine/task-state.mjs';

test('真实 Chrome 写入后强制终止控制进程，恢复账本拒绝重放', {timeout:60000}, async t => {
  const writes = [];
  let signalCommit;
  const firstCommit = new Promise(resolve => { signalCommit = resolve; });
  const server = createServer((req,res) => {
    const url = new URL(req.url,'http://localhost');
    if (url.pathname === '/status') {
      res.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify(writes));
      return;
    }
    if (url.pathname === '/register' && req.method === 'POST') {
      writes.push(url.searchParams.get('id'));
      res.end('ok');
      signalCommit();
      return;
    }
    const id = writes.length === 0 ? 'A-417' : 'B-681';
    res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'}).end(`<!doctype html>
      <article><p>${id}</p><button onclick="fetch('/register?id=${id}',{method:'POST'})">登记到货</button></article>`);
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>{server.closeAllConnections();return new Promise(resolve=>server.close(resolve));});
  const origin=`http://127.0.0.1:${server.address().port}`;
  const directory=resolve('traces',`crash-browser-write-${new Date().toISOString().replace(/[:.]/g,'-')}`);
  await mkdir(directory,{recursive:true});
  const journalPath=join(directory,'actions.jsonl');
  const statePath=join(directory,'task.jsonl');
  const definition={goal:'按顺序登记两箱',constraints:['禁止重放'],subgoals:[{id:'A-417',dependsOn:[]},{id:'B-681',dependsOn:['A-417']}]};
  let state=new TaskState(statePath,definition);
  state.close();
  const browserServer=await chromium.launchServer({channel:'chrome'});
  t.after(()=>browserServer.close());
  const script=`
    import { chromium } from 'playwright';
    import { Executor } from './engine/executor.mjs';
    const [endpoint,origin,journal]=process.argv.slice(1);
    const browser=await chromium.connect(endpoint);
    const page=await browser.newPage();
    const executor=new Executor(page,{journal,timeout:5000,grants:[{origin,kinds:['click']}]});
    await page.goto(origin);
    const target=(await executor.observe()).targets[0];
    await executor.act({operationId:'register-A',kind:'click',ref:target.ref},{postcondition:()=>new Promise(()=>{})});
  `;
  const child=spawn(process.execPath,['--input-type=module','-e',script,browserServer.wsEndpoint(),origin,journalPath],
    {stdio:['ignore','ignore','pipe'],windowsHide:true});
  const exited=once(child,'exit');
  let stderr='';
  child.stderr.setEncoding('utf8').on('data',data=>{stderr+=data;});
  t.after(()=>{if(child.exitCode===null && child.signalCode===null) child.kill('SIGKILL');});
  let timer;
  try {
    await Promise.race([firstCommit,exited.then(()=>{throw Error(`WRITER_EXITED_BEFORE_COMMIT: ${stderr}`);}),
      new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('BACKEND_COMMIT_TIMEOUT')),15000);})]);
  } finally {clearTimeout(timer);}
  assert.equal(child.kill('SIGKILL'),true);
  const [code,signal]=await exited;
  assert.equal(signal,'SIGKILL');
  const before=(await readFile(journalPath,'utf8')).trim().split('\n').map(JSON.parse);
  assert.ok(before.some(row=>row.event==='dispatch_intent' && row.operationId==='register-A'));
  assert.ok(!before.some(row=>row.event==='receipt'));
  assert.throws(()=>new Journal(journalPath),{code:'EEXIST'});
  const truth=async()=> (await fetch(origin+'/status')).json();
  const committedBefore=await truth();
  assert.deepEqual(committedBefore,['A-417']);
  // The harness owns this lock and has verified both process exit and business state.
  await unlink(journalPath+'.lock');
  await browserServer.close();
  state=new TaskState(statePath);
  t.after(()=>state.close());
  assert.equal(state.status('A-417'),'pending');
  state.record('A-417',{status:'verified',evidence:'independent-http-status:A-417'});
  assert.equal(state.next()[0].id,'B-681');

  const recoveredBrowser=await chromium.launch({channel:'chrome'});
  t.after(()=>recoveredBrowser.close());
  const page=await recoveredBrowser.newPage();
  const executor=new Executor(page,{journal:journalPath,timeout:3000,grants:[{origin,kinds:['click']}]});
  t.after(()=>executor.close());
  await page.goto(origin);
  const target=(await executor.observe()).targets.find(item=>item.context.includes('B-681'));
  const replay=await executor.act({operationId:'register-A',kind:'click',ref:target.ref});
  assert.equal(replay.error,'OPERATION_ALREADY_ATTEMPTED');
  assert.deepEqual(await truth(),['A-417']);
  const [,receipt]=await Promise.all([page.waitForResponse(response=>response.url().endsWith('/register?id=B-681'),{timeout:8000}),
    executor.act({operationId:'register-B',kind:'click',ref:target.ref})]);
  assert.equal(receipt.dispatch,'sent');
  const final=await truth();
  assert.deepEqual(final,['A-417','B-681']);
  state.record('B-681',{status:'verified',evidence:'independent-http-status:B-681'});
  assert.equal(state.outcome,'verified');
  await writeFile(join(directory,'result.json'),JSON.stringify({browser:recoveredBrowser.version(),code,signal,
    before,committedBefore,replay,receipt,final,outcome:state.outcome},null,2));
  console.log(`真实写入崩溃恢复证据: ${directory}`);
});
