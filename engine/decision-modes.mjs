const controls=['observe','done','blocked'];
const string={type:'string'};

// Schema differences are the experimental treatment. All dispatches still use
// Executor's original observations, identity checks, grants and durable ledger.
export function decisionSpace(observation,mode='ref') {
  const choices=new Map();
  for(const target of observation.targets) {
    if(target.disabled)continue;
    for(const kind of target.actions)choices.set(`${kind}:${target.ref}`,{kind,ref:target.ref});
  }
  const tokens=[...choices.keys()];
  if(mode==='ref')return {schema:{type:'object',properties:{action:{type:'string',enum:[...tokens,...controls]},value:string,reason:string},required:['action','value','reason'],additionalProperties:false},choices,
    rules:['Select an exact action token. Tokens combine a supported operation and an observed target. For click, leave value empty.']};
  if(mode==='program')return {schema:{type:'object',properties:{kind:{type:'string',enum:['program',...controls]},steps:{type:'array',maxItems:8,items:{type:'object',properties:{action:{type:'string',enum:tokens.length?tokens:['NO_LEGAL_ACTION']},value:string},required:['action','value'],additionalProperties:false}},reason:string},required:['kind','steps','reason'],additionalProperties:false},choices,
    rules:['Write a bounded straight-line program with at most 8 observed action tokens. Use an empty value for click.',
      'Use several currently independent fields in one program when safe. End the program before navigation, dynamic control changes or a confirmation screen requiring new observation.',
      'Every instruction is checked before any instruction dispatches. A stale target or unknown result interrupts the program; do not replay prior effects.']};
  if(mode==='locator')return {schema:{type:'object',properties:{kind:{type:'string',enum:['click','fill','select',...controls]},locator:{type:'object',properties:{strategy:{type:'string',enum:['css','role','label','text']},query:string,role:string,within:string,frame:{type:'integer',enum:[...new Set([...observation.targets.map(t=>t.frame),0])]}},required:['strategy','query','role','within','frame'],additionalProperties:false},value:string,reason:string},required:['kind','locator','value','reason'],additionalProperties:false},choices,
    rules:['Generate a Playwright locator. css uses locator(query); role uses getByRole(role,{name:query,exact:true}); label/text use their exact visible names.',
      'within is optional visible text of the enclosing row or form, such as a visible record number. For a globally unique label or name, set within to the empty string. A tag name or selector is not visible text. For click, leave value empty.',
      'For this decision-mode ablation the result must identify an element present in the shared observation. New/unobserved nodes require a fresh observation. This is not the full native-selector capability baseline.']};
  throw Error('UNKNOWN_DECISION_MODE');
}

function normalizeValue(kind,value) {
  if(typeof value!=='string'||value.length>10000)throw Error('MODEL_DECISION_INVALID');
  return kind==='click' ? '' : value;
}

export async function normalizeDecision(answer,{mode,observation,executor}) {
  const space=decisionSpace(observation,mode);
  if(!answer||typeof answer.reason!=='string')throw Error('MODEL_DECISION_INVALID');
  if(mode==='ref') {
    if(controls.includes(answer.action))return {control:answer.action,actions:[],reason:answer.reason};
    const action=space.choices.get(answer.action);if(!action)throw Error('MODEL_DECISION_INVALID');
    return {control:'act',actions:[{...action,value:normalizeValue(action.kind,answer.value)}],reason:answer.reason};
  }
  if(mode==='program') {
    if(!Array.isArray(answer.steps)||answer.steps.length>8)throw Error('MODEL_DECISION_INVALID');
    if(controls.includes(answer.kind)) {
      if(answer.steps.length)throw Error('MODEL_DECISION_INVALID');
      return {control:answer.kind,actions:[],reason:answer.reason};
    }
    if(answer.kind!=='program'||!answer.steps.length)throw Error('MODEL_DECISION_INVALID');
    const actions=answer.steps.map(step=>{
      const action=space.choices.get(step.action);if(!action)throw Error('MODEL_DECISION_INVALID');
      return {...action,value:normalizeValue(action.kind,step.value)};
    });
    return {control:'act',actions,reason:answer.reason};
  }
  if(controls.includes(answer.kind))return {control:answer.kind,actions:[],reason:answer.reason};
  if(!['click','fill','select'].includes(answer.kind))throw Error('MODEL_DECISION_INVALID');
  const value=normalizeValue(answer.kind,answer.value);
  const spec=answer.locator;
  if(!spec||![spec.query,spec.role,spec.within].every(s=>typeof s==='string'&&s.length<=2048)||!Number.isSafeInteger(spec.frame))throw Error('MODEL_DECISION_INVALID');
  const frame=executor.page.frames()[spec.frame];if(!frame)throw Error('FRAME_CHANGED');
  let root=frame;
  if(spec.within)root=frame.locator('tr,article,fieldset,form,[role=row],[role=group]').filter({hasText:spec.within});
  let locator;
  try {
    if(spec.strategy==='css')locator=root.locator(spec.query);
    else if(spec.strategy==='role')locator=root.getByRole(spec.role,{name:spec.query,exact:true});
    else if(spec.strategy==='label')locator=root.getByLabel(spec.query,{exact:true});
    else if(spec.strategy==='text')locator=root.getByText(spec.query,{exact:true});
    else throw Error('MODEL_DECISION_INVALID');
    const count=await locator.count();
    if(count===0) {
      if(spec.within&&await root.count()===0)throw Error('LOCATOR_SCOPE_TEXT_NOT_FOUND');
      throw Error('LOCATOR_NOT_FOUND');
    }
    if(count!==1)throw Error('TARGET_AMBIGUOUS');
    const handle=await locator.elementHandle();
    if(!handle)throw Error('TARGET_STALE');
    try {
      // Binding is to nodes from the same observation, not role/name replay.
      for(const target of observation.targets) {
        if(target.frame!==spec.frame||!target.actions.includes(answer.kind))continue;
        const entry=executor.refs.get(target.ref);
        if(entry&&await entry.handle.evaluate((node,other)=>node===other,handle).catch(()=>false)) {
          return {control:'act',actions:[{kind:answer.kind,ref:target.ref,value}],reason:answer.reason};
        }
      }
    }finally{await handle.dispose();}
    throw Error('TARGET_UNOBSERVED_OR_STALE');
  }catch(error){
    if(['MODEL_DECISION_INVALID','LOCATOR_NOT_FOUND','LOCATOR_SCOPE_TEXT_NOT_FOUND','TARGET_AMBIGUOUS','TARGET_STALE','TARGET_UNOBSERVED_OR_STALE'].includes(error.message))throw error;
    throw Error('LOCATOR_INVALID');
  }
}
