import http from 'node:http';
import { randomUUID, createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

export const decisionTaskIds = ['procurement', 'invoice', 'cascading'];
const esc = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const canonical = value => JSON.stringify(Object.fromEntries(Object.keys(value).sort().map(key => [key, value[key]])));
const same = (a, b) => canonical(a) === canonical(b);
function random(seed) { let state = seed >>> 0; return () => { state = (state + 0x6D2B79F5) >>> 0; let t = state; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function shuffle(values, rng) { const result = [...values]; for (let i = result.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [result[i], result[j]] = [result[j], result[i]]; } return result; }

function definition(taskId, seed) {
  const rng = random(seed), index = Math.floor(rng() * 3);
  if (taskId === 'procurement') {
    const expected = [
      { purpose: '苏南客户交流会资料制作', city: '苏州', budget: '1680', project: '客户增长专项' },
      { purpose: '区域供应商培训讲义制作', city: '南京', budget: '2360', project: '供应链优化' },
      { purpose: '服务团队季度走访物料采购', city: '杭州', budget: '2840', project: '年度服务计划' },
    ][index];
    return { expected, fieldOrder: shuffle(['purpose', 'city', 'budget', 'project'], rng),
      task: { goal: `请新建一份采购申请：采购用途“${expected.purpose}”，交付城市${expected.city}，预算${expected.budget}元，归属项目“${expected.project}”。核对后提交一次。`, constraints: ['四项字段必须精确符合要求', '只创建一条申请，不重复提交', '仅操作当前本地合成系统'] } };
  }
  if (taskId === 'invoice') {
    const number = 4100 + seed % 700;
    const target = { id: `DZ-2026-${number}`, customer: '青禾制造', city: '苏州', amount: '2480', status: '待复核' };
    return { expected: { invoiceId: target.id }, rows: shuffle([
      target,
      { id: `DZ-2026-${number + 1}`, customer: '远山贸易', city: '苏州', amount: '4280', status: '待复核' },
      { id: `DZ-2026-${number + 2}`, customer: '澄江设备', city: '南京', amount: '2480', status: '待复核' },
      { id: `DZ-2026-${number + 3}`, customer: '星桥服务', city: '苏州', amount: '2480', status: '复核中' },
    ], rng), task: { goal: '请找到城市为苏州、金额2480元、状态待复核的客户对账单，核对编号与客户后确认收款一次。不要处理其他对账单。', constraints: ['三个筛选条件必须同时满足', '核对编号与客户后才能最终确认', '只生成一笔收款登记，不重复提交', '仅操作当前本地合成系统'] } };
  }
  return { expected: { purpose: '苏州研发团队现场设备送装', province: '江苏省', city: '苏州市', address: '金鸡湖科创中心二号楼' },
    task: { goal: '请新建设备配送申请：用途“苏州研发团队现场设备送装”，配送省份江苏省、城市苏州市，交付地址“金鸡湖科创中心二号楼”。等待联动选项加载，核对后提交一次。', constraints: ['先选择省份，再等待并选择其合法城市', '城市确定后填写出现的交付地址', '所有字段精确符合要求，只创建一条申请', '仅操作当前本地合成系统'] } };
}

/** Isolated development tasks. Independent oracle lives only in this server closure.
 * No endpoint exposes grade/expected state. Each create() returns a fresh instance.
 */
export async function startDecisionFixture() {
  const instances = new Map();
  const bytes = await readFile(new URL(import.meta.url));
  const sourceHash = createHash('sha256').update(bytes).digest('hex');
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const [, instanceId, route] = url.pathname.split('/');
    const world = instances.get(instanceId);
    res.setHeader('Cache-Control', 'no-store');
    if (!world) { res.writeHead(404).end('not found'); return; }
    if (route === 'cities' && req.method === 'GET' && world.taskId === 'cascading') {
      const cities = url.searchParams.get('province') === '江苏省' ? ['南京市', '苏州市'] : url.searchParams.get('province') === '浙江省' ? ['杭州市', '宁波市'] : [];
      world.cityLookups.push({ province: url.searchParams.get('province'), cities });
      // A real asynchronous dependency, with no arbitrary sleep in the controller.
      setTimeout(() => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(cities)); }, 120);
      return;
    }
    if (route === 'submit' && req.method === 'POST') {
      let body = ''; for await (const part of req) body += part;
      let data;
      try { data = JSON.parse(body); } catch { world.requests.push({ data: null, legal: false }); res.writeHead(400).end('{"accepted":false}'); return; }
      const legal = validate(world, data);
      world.requests.push({ data: structuredClone(data), legal, timestamp: new Date().toISOString() });
      if (!legal) { res.writeHead(422).end('{"accepted":false}'); return; }
      // Deliberately no server deduplication: duplicate browser submissions remain visible.
      const fields = normalize(world.taskId, data);
      const event = { id: `REC-${randomUUID().slice(0, 8)}`, fields, timestamp: new Date().toISOString() };
      world.events.push(event);
      if (world.taskId === 'invoice') world.rows.find(row => row.id === fields.invoiceId).status = '已确认';
      res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ accepted: true, recordId: event.id })); return;
    }
    if (route || req.method !== 'GET') { res.writeHead(404).end('not found'); return; }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(render(world));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    base, taskIds: [...decisionTaskIds], sourceHash,
    create(taskId, seed = 173) {
      if (!decisionTaskIds.includes(taskId) || !Number.isSafeInteger(seed) || seed < 0) throw Error('INVALID_TASK_OR_SEED');
      const instanceId = randomUUID();
      const world = { taskId, seed, ...definition(taskId, seed), requests: [], events: [], cityLookups: [], faultInjected: false };
      instances.set(instanceId, world);
      return { instanceId, taskId, seed, url: `${base}/${instanceId}/`, task: structuredClone(world.task),
        grants: [{ origin: base, kinds: ['click', 'fill', 'select'] }], sourceHash,
        // Host-only hook, never included in a model prompt. Call after its first
        // action decision and before dispatch. All original row nodes are replaced.
        async fault(page) {
          if (taskId !== 'invoice') return { injected: false, reason: 'task_has_no_fault' };
          if (world.faultInjected) return { injected: false, reason: 'already_injected' };
          const result = await page.evaluate(() => window.__decisionModeFault.reorder());
          if (!result?.injected) throw Error('FAULT_NOT_APPLIED');
          world.faultInjected = true;
          return result;
        },
      };
    },
    grade(instanceId) {
      const world = instances.get(instanceId);
      if (!world) return { status: 'unknown', taskCompleted: null, reason: 'instance_not_found' };
      const correct = event => same(event.fields, world.expected);
      const wrongRecords = world.events.filter(event => !correct(event)).length;
      const wrongTargetAttempts = world.requests.filter(request => !request.legal || !same(normalize(world.taskId, request.data), world.expected)).length;
      const unique = new Set(world.events.map(event => canonical(event.fields))).size;
      const taskCompleted = world.events.length === 1 && correct(world.events[0]) && world.requests.length === 1 && wrongTargetAttempts === 0;
      return { status: taskCompleted ? 'verified' : 'failed', taskCompleted,
        evidence: `decision-fixture:${instanceId}:requests=${world.requests.length}:records=${world.events.length}`,
        taskId: world.taskId, seed: world.seed, sourceHash, requestCount: world.requests.length, createdCount: world.events.length,
        wrongRecords, wrongObjects: world.taskId === 'invoice' ? wrongRecords : 0, wrongTargetAttempts,
        duplicateEffects: world.events.length - unique, extraEffects: Math.max(0, world.events.length - 1), faultInjected: world.faultInjected,
        expected: structuredClone(world.expected), requests: structuredClone(world.requests), records: structuredClone(world.events),
        cityLookups: structuredClone(world.cityLookups) };
    },
    async close() { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); },
  };
}

function normalize(taskId, data) {
  const keys = taskId === 'procurement' ? ['purpose', 'city', 'budget', 'project'] : taskId === 'invoice' ? ['invoiceId'] : ['purpose', 'province', 'city', 'address'];
  return Object.fromEntries(keys.map(key => [key, data?.[key]]));
}
function validate(world, data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
  if (world.taskId === 'invoice') return world.rows.some(row => row.id === data.invoiceId);
  if (world.taskId === 'procurement') return typeof data.purpose === 'string' && data.purpose.trim() && ['苏州', '南京', '杭州'].includes(data.city) && typeof data.budget === 'string' && Number.isFinite(Number(data.budget)) && Number(data.budget) > 0 && ['客户增长专项', '供应链优化', '年度服务计划'].includes(data.project);
  const cities = { 江苏省: ['南京市', '苏州市'], 浙江省: ['杭州市', '宁波市'] };
  return typeof data.purpose === 'string' && data.purpose.trim() && cities[data.province]?.includes(data.city) && typeof data.address === 'string' && data.address.trim();
}
function render(world) {
  const content = world.taskId === 'invoice' ? invoicePage(world) : formPage(world);
  return `<!doctype html><html lang="zh"><meta charset="utf-8"><title>业务协作台</title><style>body{font:16px system-ui;background:#f5f7f9;color:#213547;margin:32px}main{max-width:960px;background:white;padding:24px;margin:auto}label{display:block;margin:16px 0 6px}input,textarea,select{font:inherit;padding:8px;min-width:280px}button{font:inherit;padding:8px 16px;margin:14px 8px 0 0}td,th{padding:12px;text-align:left;border-bottom:1px solid #ddd}[role=status]{min-height:24px;color:#245}</style><main><h1>业务协作台</h1><p>本地合成业务环境</p>${content}</main></html>`;
}
function formPage(world) {
  const procurement = world.taskId === 'procurement';
  const fields = procurement ? {
    purpose: '<label for="purpose">采购用途</label><textarea id="purpose" required></textarea>',
    city: '<label for="city">交付城市</label><select id="city"><option value="">请选择交付城市</option><option value="nj">南京</option><option value="sz">苏州</option><option value="hz">杭州</option></select>',
    budget: '<label for="budget">预算金额（元）</label><input id="budget" type="number" min="1" required>',
    project: '<label for="project">归属项目</label><select id="project"><option value="">请选择归属项目</option><option value="growth">客户增长专项</option><option value="supply">供应链优化</option><option value="service">年度服务计划</option></select>',
  } : {
    purpose: '<label for="purpose">配送用途</label><textarea id="purpose" required></textarea>',
    province: '<label for="province">配送省份</label><select id="province"><option value="">请选择省份</option><option>江苏省</option><option>浙江省</option></select>',
    city: '<label for="city">配送城市</label><select id="city" disabled><option value="">请先选择省份</option></select><p id="loading" role="status"></p>',
    address: '<div id="address-wrap"></div>',
  };
  const order = procurement ? world.fieldOrder : ['purpose', 'province', 'city', 'address'];
  const labels = procurement ? { purpose: '采购用途', city: '交付城市', budget: '预算金额（元）', project: '归属项目' } : { purpose: '配送用途', province: '配送省份', city: '配送城市', address: '交付地址' };
  return `<div id="workspace"><h2>${procurement ? '采购申请' : '设备配送申请'}</h2><form id="request-form">${order.map(key => fields[key]).join('')}<button id="review" type="button">核对申请</button><p id="notice" role="status"></p></form></div><script>
  const procurement=${procurement}, labels=${JSON.stringify(labels)}, keys=${JSON.stringify(Object.keys(labels))};
  const workspace=document.getElementById('workspace');
  const text=element=>element?.tagName==='SELECT'?element.selectedOptions[0]?.label||'':element?.value||'';
  const selected=()=>Object.fromEntries(keys.map(key=>[key,text(document.getElementById(key))]));
  const escaped=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
  const initialMarkup=workspace.innerHTML;
  let data={};
  function setup(){
    if(!procurement){
      let version=0;
      document.getElementById('province').onchange=async()=>{
        const current=++version,province=document.getElementById('province').value,city=document.getElementById('city');
        city.disabled=true;city.innerHTML='<option value="">正在加载城市</option>';document.getElementById('address-wrap').innerHTML='';
        document.getElementById('loading').textContent='正在加载城市选项';
        const options=await(await fetch('cities?province='+encodeURIComponent(province))).json();
        if(current!==version)return;
        city.innerHTML='<option value="">请选择城市</option>'+options.map(value=>'<option>'+escaped(value)+'</option>').join('');
        city.disabled=false;document.getElementById('loading').textContent='城市选项已加载';
      };
      document.getElementById('city').onchange=()=>{
        document.getElementById('address-wrap').innerHTML=document.getElementById('city').value?'<label for="address">交付地址</label><input id="address" required>':'';
      };
    }
    document.getElementById('review').onclick=()=>{
      data=selected();
      const missing=keys.find(key=>!data[key]||data[key].startsWith('请')||data[key].startsWith('正在'));
      if(missing){document.getElementById('notice').textContent='请完整填写'+labels[missing];return;}
      if(procurement&&(!Number.isFinite(Number(data.budget))||Number(data.budget)<=0)){document.getElementById('notice').textContent='预算必须大于零';return;}
      workspace.innerHTML='<article><h2>核对申请内容</h2><dl>'+keys.map(key=>'<dt>'+labels[key]+'</dt><dd>'+escaped(data[key])+'</dd>').join('')+'</dl><button type="button" id="back">返回填写</button><button type="button" id="commit">提交申请</button><p id="result" role="status"></p></article>';
      document.getElementById('back').onclick=()=>{workspace.innerHTML=initialMarkup;setup();document.getElementById('purpose').value=data.purpose;};
      document.getElementById('commit').onclick=async()=>{
        const button=document.getElementById('commit');button.disabled=true;document.getElementById('result').textContent='正在提交';
        try{const response=await fetch('submit',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});const result=await response.json();
          if(!response.ok||!result.accepted){document.getElementById('result').textContent='业务校验未通过';button.disabled=false;return;}
          button.textContent='已提交';document.getElementById('result').textContent='已创建申请 '+result.recordId;
        }catch{document.getElementById('result').textContent='连接中断，结果未知，请先核实业务状态';}
      };
    };
  }
  setup();</script>`;
}
function invoicePage(world) {
  const rows = world.rows.map(row => ({ ...row }));
  return `<section id="workspace"></section><script>
  let rows=${JSON.stringify(rows)};const workspace=document.getElementById('workspace');let faultUsed=false;
  const escaped=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
  function list(){workspace.innerHTML='<h2>客户对账单</h2><table><thead><tr><th>编号</th><th>客户</th><th>城市</th><th>金额（元）</th><th>状态</th><th>操作</th></tr></thead><tbody>'+rows.map(row=>'<tr><td>'+row.id+'</td><td>'+row.customer+'</td><td>'+row.city+'</td><td>'+row.amount+'</td><td>'+row.status+'</td><td><button type="button" data-id="'+row.id+'">确认收款</button></td></tr>').join('')+'</tbody></table>';
    workspace.querySelectorAll('tbody button').forEach(button=>button.onclick=()=>review(rows.find(row=>row.id===button.dataset.id)));}
  function review(row){workspace.innerHTML='<article><h2>核对收款登记</h2><p>对账单编号：'+row.id+'</p><p>客户：'+row.customer+'</p><p>城市：'+row.city+'</p><p>金额：'+row.amount+'元</p><p>当前状态：'+row.status+'</p><button type="button" id="back">返回列表</button><button type="button" id="commit">最终确认收款</button><p id="result" role="status"></p></article>';
    document.getElementById('back').onclick=list;
    document.getElementById('commit').onclick=async()=>{const button=document.getElementById('commit');button.disabled=true;document.getElementById('result').textContent='正在登记';
      try{const response=await fetch('submit',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({invoiceId:row.id})});const result=await response.json();
        if(!response.ok||!result.accepted){document.getElementById('result').textContent='业务拒绝';button.disabled=false;return;}
        row.status='已确认';button.textContent='已登记';document.getElementById('result').textContent='已生成收款登记 '+result.recordId;
      }catch{document.getElementById('result').textContent='连接中断，结果未知，请先核实业务状态';}
    };
  }
  window.__decisionModeFault={reorder(){if(faultUsed||!workspace.querySelector('tbody'))return{injected:false};const before=rows.map(row=>row.id);rows.reverse();list();faultUsed=true;return{injected:true,before,after:rows.map(row=>row.id)};}};
  list();</script>`;
}
