import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { Executor } from '../engine/executor.mjs';
import { TaskState } from '../engine/task-state.mjs';
import { runAgent } from '../engine/agent-loop.mjs';
import { codexDecision } from '../adapters/codex-decision.mjs';

const [model, reasoningEffort] = process.argv.slice(2);
if (!model || !reasoningEffort) throw Error('用法: node experiments/model-long-recovery.mjs <model> <effort>');
const dir = resolve('traces', `model-long-recovery-${new Date().toISOString().replace(/[:.]/g, '-')}`);
await mkdir(dir, {recursive:true});
const hashes = {};
for (const file of ['experiments/model-long-recovery.mjs','engine/task-state.mjs','engine/agent-loop.mjs','engine/executor.mjs',
  'engine/decision-modes.mjs','engine/observation-codec.mjs','engine/visual-write.mjs','adapters/codex-decision.mjs','package-lock.json']) {
  const bytes = await readFile(file);
  hashes[file] = createHash('sha256').update(bytes).digest('hex');
  await writeFile(join(dir,file.replaceAll('/','-')),bytes);
}
const boxes = Array.from({length:25}, (_,i) => `SZ-${410 + ((i * 17) % 29)}`);
const definition = {goal:'按指定清单顺序登记 25 箱苏州到货',constraints:['严格按序','每箱仅登记一次','不能选择待复核箱'],
  subgoals:boxes.map((box,i)=>({id:`box-${i+1}`,box,dependsOn:i ? [`box-${i}`] : []}))};
const attempts = [], committed = [];
const server = createServer((req,res) => {
  const url = new URL(req.url,'http://localhost');
  if (url.pathname === '/commit' && req.method === 'POST') {
    const id = url.searchParams.get('id');
    const accepted = id === boxes[committed.length];
    attempts.push({id,accepted});
    if (accepted) committed.push(id);
    res.writeHead(accepted ? 200 : 422).end(accepted ? '已登记' : '拒绝');
    return;
  }
  if (url.pathname === '/status') {
    res.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify({committed,attempts}));
    return;
  }
  res.setHeader('Content-Type','text/html; charset=utf-8');
  if (url.pathname === '/interruption') { res.end('<h1>浏览器已被导航到其他页面</h1>'); return; }
  const expected = boxes[committed.length];
  const pair = expected ? [{id:expected,label:'苏州待登记箱'}, {id:`NJ-${committed.length+610}`,label:'南京待复核箱'}] : [];
  if (committed.length % 2 === 0) pair.reverse();
  res.end(`<!doctype html><h1>仓储到货登记</h1><p>当前批次 ${committed.length+1}</p>
    ${pair.map(row=>`<article><p>${row.label} ${row.id}</p><button data-id="${row.id}">登记此箱</button></article>`).join('')}
    <script>for(const b of document.querySelectorAll('button'))b.onclick=async()=>{b.disabled=true;await fetch('/commit?id='+b.dataset.id,{method:'POST'});};</script>`);
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const statePath = join(dir,'task.jsonl');
const actionsPath = join(dir,'actions.jsonl');
let state, browser, page, executor;
const summary = {model,reasoningEffort,hashes,rows:[],interruption:null,complete:false};
const readTruth = async () => (await fetch(origin+'/status')).json();
const save = async () => {
  const truth = await readTruth();
  await writeFile(join(dir,'summary.json'),JSON.stringify({...summary,...truth},null,2));
};
const open = async () => {
  browser = await chromium.launch({channel:'chrome'});
  summary.browser = browser.version();
  page = await browser.newPage();
  executor = new Executor(page,{journal:actionsPath,timeout:3000,grants:[{origin,kinds:['click'],name:'登记此箱'}]});
};
const waitForAttempt = async index => {
  const until = Date.now()+2500;
  while (attempts.length <= index && Date.now()<until) await new Promise(resolve=>setTimeout(resolve,25));
};
try {
  console.log(`Evidence directory: ${dir}`);
  state = new TaskState(statePath,definition);
  await open();
  for (const [index,box] of boxes.entries()) {
    const item = state.next()[0];
    assert.equal(item.box,box);
    await page.goto(origin);
    const result = await runAgent({executor,mode:'ref',directory:join(dir,item.id),maxModelCalls:1,maxActions:1,maxWallTimeMs:45000,
      task:{goal:definition.goal,constraints:definition.constraints,currentSubgoal:`本轮只登记 ${box}；有疑问则停止。`},
      decide:request=>codexDecision({...request,model,reasoningEffort,timeoutMs:Math.max(1000,request.remainingTimeMs),
        workingDirectory:resolve('.cache/decision-model-context')}),
      verifyGoal:async()=>{
        await waitForAttempt(index);
        if(index===14) throw Error('CHECKPOINT_INTERRUPTION_INJECTED');
        const truth = await readTruth();
        return {status:truth.committed[index]===box && truth.attempts.length===index+1 ? 'verified' : 'failed',
          evidence:`independent-http-status:${index+1}:${box}`};
      },
    });
    summary.rows.push({id:item.id,box,terminal:result.terminal,controllerTerminal:result.controllerTerminal,tokens:result.tokens,
      modelCalls:result.modelCalls});
    await save();
    console.log(JSON.stringify(summary.rows.at(-1)));
    if (result.controllerTerminal==='MODEL_UNAVAILABLE') { process.exitCode=2; break; }
    if(index===14) {
      assert.equal(state.status(item.id),'pending');
      assert.equal(result.taskResult.status,'unknown');
      await page.goto(origin+'/interruption');
      const displacedUrl = page.url();
      await executor.close(); executor=null;
      await browser.close(); browser=null;
      state.close();
      state = new TaskState(statePath);
      assert.deepEqual(state.definition.constraints,definition.constraints);
      assert.equal(state.next()[0].id,item.id);
      const truth = await readTruth();
      assert.deepEqual(truth.committed,boxes.slice(0,15));
      assert.equal(truth.attempts.length,15);
      state.record(item.id,{status:'verified',evidence:`independent-http-reconciliation:15:${box}`});
      summary.interruption = {displacedUrl,checkpointBefore:'pending',reconciled:box,next:state.next()[0].id};
      await open();
      await save();
      continue;
    }
    if(result.terminal!=='GOAL_VERIFIED') { process.exitCode=2; break; }
    state.record(item.id,{status:'verified',evidence:result.taskResult.evidence});
  }
  summary.complete = state.outcome === 'verified';
  if (summary.complete) {
    assert.deepEqual(committed,boxes);
    assert.deepEqual(attempts,boxes.map(id=>({id,accepted:true})));
  }
  await save();
} finally {
  await executor?.close();
  await browser?.close();
  state?.close();
  server.closeAllConnections();
  await new Promise(resolve=>server.close(resolve));
}
