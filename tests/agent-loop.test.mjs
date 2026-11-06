import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runAgent } from '../engine/agent-loop.mjs';

const task={goal:'只提交指定申请一次',constraints:['不得重复提交','未经独立证据不得宣布成功']};
const observation={rev:1,url:'http://localhost/app',targets:[{ref:'r1-1',frame:0,name:'提交申请',context:'指定申请',formOwner:null,actions:['click']}],trust:'untrusted_page_data'};
const answer=kind=>({validRun:true,usage:{input_tokens:1,output_tokens:1},answer:{kind,ref:kind==='click'?'r1-1':'',value:'',reason:'test-only decision stub'}});
const fixture=(receipt={dispatch:'sent',error:null})=>({calls:0,async observe(){return structuredClone(observation);},async act(){this.calls++;return receipt;}});
const directory=()=>mkdtemp(join(tmpdir(),'browser-agent-loop-'));

test('已派发的最终动作立即转独立验真，未知结果时不再请求模型', async () => {
  for (const [status, terminal] of [['verified','GOAL_VERIFIED'], ['failed','GOAL_FAILED'], ['unknown','FINAL_ACTION_AWAITING_VERIFICATION']]) {
    const executor=fixture();
    let decisions=0, verifications=0;
    const result=await runAgent({executor,task,directory:await directory(),
      isFinalAction:({target})=>target.name==='提交申请',
      decide:async()=>{decisions++;return answer('click');},
      verifyGoal:async()=>{verifications++;return {status,evidence:'backend:terminal-record'};},
    });
    assert.equal(result.terminal,terminal);
    assert.equal(result.controllerTerminal,'FINAL_ACTION_AWAITING_VERIFICATION');
    assert.equal(decisions,1);
    assert.equal(verifications,1);
    assert.equal(executor.calls,1);
  }
});

test('按需视觉观察缺失时，即使决策端越过 schema 也拒绝坐标点击', async () => {
  const executor = fixture();
  executor.page = { viewportSize: () => ({width:640,height:360}) };
  const result = await runAgent({executor, task, directory:await directory(), mode:'hybrid',
    shouldCaptureImage: () => false,
    decide: async request => {
      assert.equal(request.images, undefined);
      assert.equal(request.schema.properties.kind.enum.includes('visual_click'), false);
      return answer('visual_click');
    },
  });
  assert.equal(result.terminal, 'VISUAL_OBSERVATION_REQUIRED');
  assert.equal(result.steps[0].screenshotBytes, 0);
  assert.equal(executor.calls, 0);
});

test('独立完成证据保留事实，模型服务终止原因仍供批次调度使用',async()=>{
  const executor=fixture();
  const result=await runAgent({executor,task,directory:await directory(),
    decide:async()=>({validRun:false,usage:null,answer:null}),
    verifyGoal:async()=>({status:'verified',evidence:'backend:existing-record=1'}),
  });
  assert.equal(result.terminal,'GOAL_VERIFIED');
  assert.equal(result.controllerTerminal,'MODEL_UNAVAILABLE');
  assert.equal(result.tokenAccountingComplete,false);
  assert.equal(executor.calls,0);
});

test('控制器安全：未知写入后停止，不让后续模型建议重试',async()=>{
  const executor=fixture({dispatch:'unknown',error:'ACTION_RESULT_UNKNOWN'});let decisions=0;
  const result=await runAgent({executor,task,directory:await directory(),decide:async()=>{decisions++;return answer('click');}});
  assert.equal(result.terminal,'ACTION_RECONCILIATION_REQUIRED');assert.equal(decisions,1);assert.equal(executor.calls,1);
  assert.equal(result.taskResult.status,'unknown');
});

test('模型DONE不当真值；只有带证据的独立裁判能确认任务结果',async()=>{
  for(const [verdict,expected] of [[{status:'failed',evidence:'backend:records=0'},'failed'],[{status:'verified'},'unknown'],[{status:'verified',evidence:'backend:records=1'},'verified']]) {
    const executor=fixture();
    const result=await runAgent({executor,task,directory:await directory(),decide:async()=>answer('done'),verifyGoal:async(...args)=>{assert.equal(args.length,0);return verdict;}});
    assert.equal(result.taskResult.status,expected);assert.equal(executor.calls,0);
  }
});

test('非法Ref、模型失败、缺失usage与超预算均不会操作浏览器',async()=>{
  const invalid={...answer('click'),answer:{...answer('click').answer,ref:'not-observed'}};
  for(const decision of [invalid,{validRun:false}, {...answer('click'),usage:null}, {...answer('click'),usage:{input_tokens:9999,output_tokens:1}}]) {
    const executor=fixture();
    await runAgent({executor,task,directory:await directory(),maxTokens:100,decide:async()=>decision});
    assert.equal(executor.calls,0);
  }
});

test('决策回调得到独立任务/历史副本，不能改写后续硬约束',async()=>{
  let calls=0;const executor=fixture();
  const result=await runAgent({executor,task,directory:await directory(),decide:async({state})=>{
    calls++;assert.deepEqual(state.task,task);
    state.task.constraints=[];
    return answer(calls===1?'observe':'done');
  }});
  assert.equal(result.modelCalls,2);assert.deepEqual(task.constraints,['不得重复提交','未经独立证据不得宣布成功']);
});
