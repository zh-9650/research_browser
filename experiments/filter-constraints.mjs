import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { Executor } from '../engine/executor.mjs';
import { runAgent } from '../engine/agent-loop.mjs';
import { codexDecision } from '../adapters/codex-decision.mjs';

const [model, reasoningEffort] = process.argv.slice(2);
if (!model || !reasoningEffort) throw Error('用法: node experiments/filter-constraints.mjs <model> <effort>');
const root = resolve('traces', `filter-constraints-${new Date().toISOString().replace(/[:.]/g, '-')}`);
await mkdir(root, {recursive:true});
const sourceHashes = {};
for (const file of ['experiments/filter-constraints.mjs','engine/agent-loop.mjs','engine/executor.mjs',
  'engine/decision-modes.mjs','engine/observation-codec.mjs','engine/visual-write.mjs','adapters/codex-decision.mjs','package-lock.json']) {
  const bytes = await readFile(file);
  sourceHashes[file] = createHash('sha256').update(bytes).digest('hex');
  await writeFile(join(root,file.replaceAll('/','-')),bytes);
}
const rows = [
  {id:'SZ-417',city:'苏州',amount:620,review:true,received:true},
  {id:'NJ-681',city:'南京',amount:920,review:true,received:true},
  {id:'SZ-418',city:'苏州',amount:880,review:false,received:true},
  {id:'SZ-419',city:'苏州',amount:810,review:true,received:false},
  {id:'SZ-420',city:'苏州',amount:520,review:true,received:true},
];
const attempts = [];
const writes = [];
const server = createServer(async (req,res) => {
  if (req.method === 'POST' && req.url === '/register') {
    let body = '';
    for await (const chunk of req) body += chunk;
    const payload = JSON.parse(body);
    const accepted = payload.city === '苏州' && payload.review === true && payload.received === true
      && payload.sort === 'descending' && payload.id === 'SZ-417' && writes.length === 0;
    attempts.push({...payload,accepted});
    if (accepted) writes.push(payload.id);
    res.writeHead(accepted ? 200 : 422).end(accepted ? '已登记' : '业务拒绝');
    return;
  }
  res.writeHead(200, {'Content-Type':'text/html; charset=utf-8'}).end(`<!doctype html>
    <h1>仓库收货登记</h1>
    <label>城市 <select id="city"><option>全部</option><option>苏州</option><option>南京</option></select></label>
    <label><input id="review" type="checkbox">仅待复核</label>
    <label><input id="received" type="checkbox">仅已签收</label>
    <label>金额排序 <select id="sort"><option value="ascending">从低到高</option><option value="descending">从高到低</option></select></label>
    <p role="status"></p><table><tbody></tbody></table>
    <script>
    const rows = ${JSON.stringify(rows)};
    const state = () => ({city:document.querySelector('#city').value, review:document.querySelector('#review').checked,
      received:document.querySelector('#received').checked,sort:document.querySelector('#sort').value});
    function render() {
      const current = state();
      const displayed = rows.filter(row => (current.city === '全部' || row.city === current.city)
        && (!current.review || row.review) && (!current.received || row.received))
        .sort((a,b) => current.sort === 'descending' ? b.amount-a.amount : a.amount-b.amount);
      document.querySelector('tbody').innerHTML = displayed.map(row => '<tr><td>'+row.id+'</td><td>'+row.city+'</td><td>'+row.amount+
        ' 元</td><td>'+(row.review?'待复核':'已复核')+'</td><td>'+(row.received?'已签收':'未签收')+
        '</td><td><button data-id="'+row.id+'">登记</button></td></tr>').join('');
      document.querySelectorAll('tbody button').forEach(button => button.onclick = async () => {
        button.disabled = true;
        const response = await fetch('/register',{method:'POST',headers:{'Content-Type':'application/json'},
          body:JSON.stringify({...state(),id:button.dataset.id})});
        document.querySelector('[role=status]').textContent = await response.text();
      });
    }
    document.querySelectorAll('input,select').forEach(control => control.onchange=render);
    render();
    </script>`);
});
await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
let browser, executor;
try {
  console.log(`Evidence directory: ${root}`);
  browser = await chromium.launch({channel:'chrome'});
  const page = await browser.newPage();
  await page.goto(origin);
  executor = new Executor(page,{journal:join(root,'actions.jsonl'),timeout:3000,grants:[{origin,kinds:['click','select']}]});
  const result = await runAgent({executor,mode:'program',directory:root,maxModelCalls:9,maxActions:14,maxWallTimeMs:150000,
    task:{goal:'在仓库收货登记中筛选苏州，同时勾选仅待复核与仅已签收，把金额按从高到低排序，然后登记筛选结果中金额最高的一单，只登记一次。'},
    decide:request => codexDecision({...request,model,reasoningEffort,timeoutMs:Math.max(1000,Math.min(90000,request.remainingTimeMs)),
      workingDirectory:resolve('.cache/decision-model-context')}),
    verifyGoal:() => ({status:writes.length === 1 && attempts.length === 1 ? 'verified' : 'failed',
      evidence:'independent-filter-register-ledger',attempts:attempts.slice(),writes:writes.slice()}),
  });
  await page.screenshot({path:join(root,'final.png')});
  await writeFile(join(root,'experiment.json'),JSON.stringify({model,reasoningEffort,browser:browser.version(),sourceHashes,result},null,2));
  console.log(JSON.stringify({terminal:result.terminal,taskResult:result.taskResult,modelCalls:result.modelCalls,tokens:result.tokens}));
  if (result.terminal !== 'GOAL_VERIFIED') process.exitCode=2;
} finally {
  await executor?.close();
  await browser?.close();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}
