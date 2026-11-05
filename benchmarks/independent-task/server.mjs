import http from 'node:http';
import { randomUUID, createHash } from 'node:crypto';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve('benchmarks/independent-task');
const runId = new Date().toISOString().replace(/[:.]/g, '-');
const out = resolve('traces', `independent-${runId}`);
await mkdir(out, { recursive: true });
const session = randomUUID();
const admin = randomUUID();
const events = [];
const requests = [];
const expected = { purpose: '华东客户交流会资料制作', city: '苏州', budget: '1680', project: '客户成功计划' };
const task = '请新建一份采购申请：采购用途为“华东客户交流会资料制作”，交付城市选苏州，预算金额为 1680 元，归属项目为“客户成功计划”。核对所有内容后提交一次，不要创建额外申请。';
let origin;

async function saveEvidence() {
  await writeFile(resolve(out, 'oracle.json'), JSON.stringify({ session, expected, requests, events }, null, 2));
}
const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, origin || 'http://localhost');
  if (u.pathname === '/admin/grade' && u.searchParams.get('token') === admin) {
    await saveEvidence();
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ expected, requests, events }));
    return;
  }
  if (u.pathname === `/p/${session}/submit` && req.method === 'POST') {
    let body = '';
    for await (const c of req) body += c;
    let data;
    try { data = JSON.parse(body); } catch { res.writeHead(400).end('bad request'); return; }
    requests.push({ at: new Date().toISOString(), data });
    if (typeof data.purpose !== 'string' || !data.purpose.trim() || !['苏州', '杭州', '南京'].includes(data.city) || !['客户成功计划', '年度品牌推广', '服务能力建设'].includes(data.project) || !Number.isFinite(Number(data.budget)) || Number(data.budget) <= 0) {
      await saveEvidence(); res.writeHead(422).end('{"accepted":false}'); return;
    }
    const record = { ...data, id: `REQ-${randomUUID().slice(0, 8)}` };
    events.push(record);
    await saveEvidence();
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ accepted: true, requestId: record.id }));
    return;
  }
  if (u.pathname !== `/p/${session}/`) { res.writeHead(404).end('Not found'); return; }
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end(html());
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
origin = `http://127.0.0.1:${server.address().port}`;
const config = { url: `${origin}/p/${session}/`, goal: task, constraints: ['只创建一次', '仅本地合成业务'], journal: resolve(out, 'executor.jsonl'), grants: [{ origin, kinds: ['click', 'fill', 'select'] }], timeout: 1500 };
await writeFile(resolve(root, 'task-config.json'), JSON.stringify(config, null, 2));
await writeFile(resolve(root, 'private-session.json'), JSON.stringify({ origin, admin, out, task, startedAt: new Date().toISOString() }, null, 2));
await writeFile(resolve(out, 'server.mjs'), await readFile(new URL(import.meta.url)));
await writeFile(resolve(out, 'manifest.json'), JSON.stringify({ node: process.version, task, sourceHash: createHash('sha256').update(await readFile(new URL(import.meta.url))).digest('hex') }, null, 2));
await saveEvidence();
console.log(JSON.stringify({ status: 'ready', config: resolve(root, 'task-config.json'), task }));

function html() {
  return `<!doctype html><html lang="zh"><meta charset="utf-8"><title>协作采购台</title>
  <style>body{font:16px system-ui;max-width:850px;margin:40px auto;background:#f5f6f8;color:#21303d}main{padding:30px;background:white;border-radius:12px}label{display:block;margin:20px 0 5px}input,textarea,select{display:block;padding:10px;width:90%;font:inherit}button{padding:12px 18px;margin-top:24px}aside{float:right;color:#667}</style>
  <header><aside>内部合成环境</aside><h1>协作采购台</h1></header><main id="main"></main>
  <script>
  const state={purpose:'',city:'',budget:'',project:''};
  const main=document.getElementById('main');
  function edit(){
    main.innerHTML='<h2>采购申请 · 填写信息</h2><form><label for="purpose">采购用途</label><textarea id="purpose" required></textarea><label for="city">交付城市</label><select id="city"><option value="">请选择交付城市</option><option>南京</option><option>苏州</option><option>杭州</option></select><label for="budget">预算金额（元）</label><input id="budget" type="number" min="1" required><label for="project">归属项目</label><select id="project"><option value="">请选择归属项目</option><option>年度品牌推广</option><option>服务能力建设</option><option>客户成功计划</option></select><button type="button">核对申请</button><p role="status"></p></form>';
    for(const key of Object.keys(state))document.getElementById(key).value=state[key];
    main.querySelector('button').onclick=()=>{
      for(const key of Object.keys(state))state[key]=document.getElementById(key).value;
      if(!state.purpose.trim()||!state.city||!state.budget||!state.project){main.querySelector('[role=status]').textContent='请完整填写申请信息';return;}
      review();
    };
  }
  function review(){
    main.innerHTML='<article><h2>采购申请 · 核对内容</h2><dl></dl><button>返回修改</button> <button>提交采购申请</button><p role="status"></p></article>';
    const dl=main.querySelector('dl');
    for(const [label,key]of [['采购用途','purpose'],['交付城市','city'],['预算金额（元）','budget'],['归属项目','project']]){const dt=document.createElement('dt');const dd=document.createElement('dd');dt.textContent=label;dd.textContent=state[key];dl.append(dt,dd);}
    const buttons=main.querySelectorAll('button');buttons[0].onclick=edit;
    buttons[1].onclick=async()=>{
      buttons[1].disabled=true;
      main.querySelector('[role=status]').textContent='正在提交';
      try{const response=await fetch('submit',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(state)});const result=await response.json();
      if(result.accepted){main.querySelector('[role=status]').textContent='申请已创建：'+result.requestId;buttons[1].textContent='已提交';}
      else{main.querySelector('[role=status]').textContent='申请未通过校验';buttons[1].disabled=false;}}
      catch{main.querySelector('[role=status]').textContent='提交结果未知，请核查后再处理';}
    };
  }
  edit();
  </script></html>`;
}
