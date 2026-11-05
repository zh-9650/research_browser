import { readdir, readFile, mkdir, writeFile, copyFile } from 'node:fs/promises';
import { resolve, join, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import assert from 'node:assert/strict';
import { encodeObservation, decodeObservation, targetContext } from '../engine/observation-codec.mjs';

// Replay complete recorded observations, including adverse outcomes; no cherry-picked text.
const groups = [
  'traces/2026-11-04T10-04-31-225Z',
  'traces/independent-2026-11-04T15-11-09-469Z',
  'traces/miniwob-codex-2026-11-04T15-20-11-837Z',
  'traces/external-pytest-read',
];
const records = [], inputHashes = {};
for (const group of groups) for (const name of await readdir(group)) {
  if (!name.endsWith('-before.json') && !name.endsWith('.protocol.jsonl')) continue;
  const path = join(group, name), bytes = await readFile(path);
  inputHashes[path] = createHash('sha256').update(bytes).digest('hex');
  const observations = name.endsWith('.jsonl') ? bytes.toString('utf8').split('\n').filter(Boolean).map(line=>JSON.parse(line)).filter(x=>x.direction==='out'&&x.payload?.observation).map(x=>x.payload.observation) : [JSON.parse(bytes)];
  for (const [index, observation] of observations.entries()) {
    const started=performance.now();
    const packed=encodeObservation(observation);
    const encodeMs=performance.now()-started;
    const decoded=decodeObservation(packed);
    assert.deepEqual(decoded, observation, `${path}:${index}`);
    // Simulated exact business-context consumers must still choose identical Ref sets.
    // This is deterministic selection equivalence, not model-decision equivalence.
    for (const target of observation.targets) {
      const expected=observation.targets.filter(t=>t.name===target.name && t.context===target.context).map(t=>t.ref);
      const actual=packed.targets.filter(t=>t.name===target.name && targetContext(packed,t)===target.context).map(t=>t.ref);
      assert.deepEqual(actual,expected);
    }
    records.push({group,path,index,rev:observation.rev,targetCount:observation.targets.length,rawBytes:Buffer.byteLength(JSON.stringify(observation)),encodedBytes:Buffer.byteLength(JSON.stringify(packed)),encoding:packed.encoding||'raw',encodeMs});
  }
}
const out=resolve('traces',`context-codec-${new Date().toISOString().replace(/[:.]/g,'-')}`);
await mkdir(out,{recursive:true});
const sourceHashes={};
for(const source of ['engine/observation-codec.mjs','experiments/context-codec.mjs','adapters/cli.mjs','package-lock.json']) {
  const bytes=await readFile(source);sourceHashes[source]=createHash('sha256').update(bytes).digest('hex');
  await copyFile(source,join(out,source.replaceAll('/','-')));
}
await writeFile(join(out,'results.json'),JSON.stringify({date:new Date().toISOString(),node:process.version,inputHashes,sourceHashes,records,model:null},null,2));
const lines=['# 无损共享上下文：完整历史观察重放','',`原始结果：\`${relative(process.cwd(),out)}/results.json\`。命令：\`node experiments/context-codec.mjs\`。`,'',
  '| 来源 | 完整观察数 | 原始UTF-8字节 | 编码UTF-8字节 | 减少 |','|---|---:|---:|---:|---:|'];
for(const group of groups) {
  const rows=records.filter(r=>r.group===group),raw=rows.reduce((n,r)=>n+r.rawBytes,0),packed=rows.reduce((n,r)=>n+r.encodedBytes,0);
  lines.push(`| ${group} | ${rows.length} | ${raw} | ${packed} | ${(100*(1-packed/raw)).toFixed(2)}% |`);
}
lines.push('',`全部 ${records.length} 份观察逐字深比较还原成功；目标Ref、frame、表单关联、不可信标记、裁剪缺口和精确上下文匹配的候选集合全部保持。未调用模型，也未重跑浏览器。`,'',
  '编码器只将目标中重复的context移到共享字符串表。相同contextIndex只表示文本相同，不表示同节点、同frame或同业务对象。原始documents与contexts均保留，未以摘要替代原始内容。auto仅在UTF-8 JSON更小时启用，否则保留原始格式。',
  '指标是实际序列化JSON字节，不是模型token、费用、任务成功率或端到端延迟。格式变化可能影响模型行为，尚未用固定模型盲化A/B验证，不能据字节减少宣称能力提高。当前仍未给全部字段设置总预算；共享表中的单个大context仍可能很长。',
  '外部pytest样本来自真实只读导航，日志保留了3次导航与补读16000–32000文字区间；没有隐藏reward或后台写入。该样本不是独立作者的盲测，日志里的残锁不作为活进程证据，未为本实验移除残锁或重启业务。');
await mkdir('reports',{recursive:true});await writeFile('reports/context-codec.md',lines.join('\n')+'\n');
console.log(lines.slice(0,10).join('\n'));
