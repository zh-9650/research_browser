import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { mkdir, writeFile } from 'node:fs/promises';

// Read-only capability discovery. No thread/turn or inference request is started.
const child=spawn('codex.exe',['app-server','--stdio','--disable','hooks','--disable','plugins','--disable','apps'],{stdio:['pipe','pipe','pipe'],windowsHide:true});
const pending=new Map();let stderr='';
child.stderr.on('data',bytes=>stderr+=bytes);
const lines=createInterface({input:child.stdout});
lines.on('line',line=>{
  let message;try{message=JSON.parse(line);}catch{return;}
  if(message.id!==undefined&&pending.has(message.id)){pending.get(message.id)(message);pending.delete(message.id);}
});
const request=(id,method,params)=>new Promise(resolve=>{pending.set(id,resolve);child.stdin.write(JSON.stringify({id,method,params})+'\n');});
const timer=setTimeout(()=>child.kill(),20000);
const stopped=new Promise((_,reject)=>{child.once('exit',code=>reject(Error(`model discovery process exited ${code}`)));child.once('error',reject);});
stopped.catch(()=>{});
try {
  const initialized=await Promise.race([request(1,'initialize',{clientInfo:{name:'browser-research-capability-probe',version:'0.1.0'},capabilities:{experimentalApi:false}}),stopped]);
  if(initialized.error)throw Error(JSON.stringify(initialized.error));
  child.stdin.write(JSON.stringify({method:'initialized'})+'\n');
  const catalog=await Promise.race([request(2,'model/list',{limit:100,includeHidden:false}),stopped]);
  await mkdir('sources/runs',{recursive:true});
  await writeFile('sources/runs/codex-model-catalog.json',JSON.stringify({date:new Date().toISOString(),authority:'app-server catalog; may be bundled or cached, not proof inference is authorized',initialized,catalog},null,2));
  console.log(JSON.stringify(catalog.result?.data?.map(m=>({model:m.model,isDefault:m.isDefault,effort:m.defaultReasoningEffort}))||catalog,null,2));
}finally{clearTimeout(timer);child.stdin.end();child.kill();lines.close();}
