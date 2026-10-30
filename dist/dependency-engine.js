/** Deterministic, sandboxed dependency model. It does NOT interpret arbitrary Excel formulas. */
import {parseExpression,evaluate} from './simulation.js';
const idPattern=/^[a-z][a-z0-9_]{0,35}$/;
const numeric=v=>typeof v==='number'&&Number.isFinite(v);
function vars(node,set=new Set()){if(node.kind==='var')set.add(node.name);else if(node.kind==='bin'){vars(node.a,set);vars(node.b,set);}else if(node.kind==='unary')vars(node.expr,set);else if(node.kind==='call')node.args.forEach(v=>vars(v,set));return set;}
export const sampleModel=()=>({name:'RPG 角色养成 · 虚构演示',levels:30,outputs:['attack','power','upgradecost','goldbalance'],nodes:[
 {id:'level',label:'角色等级',kind:'input',value:1,unit:'级',system:'基础',source:null},
 {id:'baseattack',label:'基础攻击',kind:'input',value:100,unit:'点',system:'属性'},
 {id:'attackgrowth',label:'每级攻击成长',kind:'input',value:12,unit:'点/级',system:'属性'},
 {id:'weaponattack',label:'武器攻击',kind:'input',value:40,unit:'点',system:'属性'},
 {id:'basedefense',label:'基础防御',kind:'input',value:55,unit:'点',system:'属性'},
 {id:'defensegrowth',label:'每级防御成长',kind:'input',value:6,unit:'点/级',system:'属性'},
 {id:'basehp',label:'基础生命',kind:'input',value:850,unit:'点',system:'属性'},
 {id:'hpgrowth',label:'每级生命成长',kind:'input',value:78,unit:'点/级',system:'属性'},
 {id:'powerattackweight',label:'攻击战力权重',kind:'input',value:2,unit:'',system:'战力'},
 {id:'powerdefenseweight',label:'防御战力权重',kind:'input',value:1.4,unit:'',system:'战力'},
 {id:'powerhpweight',label:'生命战力权重',kind:'input',value:0.12,unit:'',system:'战力'},
 {id:'costbase',label:'升级基础成本',kind:'input',value:70,unit:'金币',system:'经济'},
 {id:'costgrowth',label:'升级成本倍率',kind:'input',value:1.11,unit:'倍/级',system:'经济'},
 {id:'attacktraincost',label:'攻击训练成本系数',kind:'input',value:0.16,unit:'金币/攻击',system:'经济'},
 {id:'stagegold',label:'每级固定金币产出',kind:'input',value:115,unit:'金币',system:'经济'},
 {id:'goldperpower',label:'战力附加金币系数',kind:'input',value:0.025,unit:'金币/战力',system:'经济'},
 {id:'attack',label:'最终攻击',kind:'formula',formula:'baseattack + (level-1)*attackgrowth + weaponattack',unit:'点',system:'属性'},
 {id:'defense',label:'最终防御',kind:'formula',formula:'basedefense + (level-1)*defensegrowth',unit:'点',system:'属性'},
 {id:'hp',label:'最终生命',kind:'formula',formula:'basehp + (level-1)*hpgrowth',unit:'点',system:'属性'},
 {id:'power',label:'综合战力',kind:'formula',formula:'round(attack*powerattackweight + defense*powerdefenseweight + hp*powerhpweight)',unit:'战力',system:'战力'},
 {id:'upgradecost',label:'每级养成成本',kind:'formula',formula:'round(costbase*pow(costgrowth,level-1) + attack*attacktraincost)',unit:'金币',system:'经济'},
 {id:'goldincome',label:'每级金币产出',kind:'formula',formula:'round(stagegold + power*goldperpower)',unit:'金币',system:'经济'},
 {id:'goldbalance',label:'累计金币盈余',kind:'formula',formula:'prev_goldbalance + goldincome - upgradecost',unit:'金币',system:'经济'},
 {id:'totalcost',label:'累计养成成本',kind:'formula',formula:'prev_totalcost + upgradecost',unit:'金币',system:'经济'}
]});
export function compileModel(model){
 if(!Array.isArray(model?.nodes)||model.nodes.length<2||model.nodes.length>120)throw Error('模型需要 2–120 个节点');
 const nodes=new Map(),deps=new Map(),temporal=new Map(),reverse=new Map();
 for(const raw of model.nodes){const n={...raw,id:String(raw.id||'').toLowerCase()};if(!idPattern.test(n.id)||n.id.startsWith('prev_'))throw Error(`节点 ID 不合法：${raw.id}`);if(nodes.has(n.id))throw Error(`节点 ID 重复：${n.id}`);if(!['input','formula'].includes(n.kind))throw Error(`节点类型不支持：${n.id}`);if(n.kind==='input'&&!numeric(Number(n.value)))throw Error(`输入节点 ${n.id} 必须有有效默认值`);nodes.set(n.id,n);reverse.set(n.id,new Set());}
 if(!nodes.has('level')||nodes.get('level').kind!=='input')throw Error('模型必须包含输入节点 level');
 const compiled=new Map();
 for(const n of nodes.values()){if(n.kind==='input'){deps.set(n.id,new Set());temporal.set(n.id,new Set());continue;}
 const ast=parseExpression(n.formula);const refs=vars(ast),same=new Set(),prev=new Set();for(const r of refs){if(r.startsWith('prev_')){const id=r.slice(5);if(!nodes.has(id))throw Error(`${n.id} 引用未定义上期节点 ${r}`);prev.add(id);}else{if(!nodes.has(r))throw Error(`${n.id} 引用未定义节点 ${r}`);same.add(r);}}
 deps.set(n.id,same);temporal.set(n.id,prev);compiled.set(n.id,ast);
 for(const id of [...same,...prev])reverse.get(id).add(n.id);
 }
 const order=[],color=new Map();function visit(id,stack=[]){const c=color.get(id);if(c===2)return;if(c===1)throw Error(`检测到循环依赖：${[...stack,id].join(' → ')}`);color.set(id,1);for(const d of deps.get(id))visit(d,[...stack,id]);color.set(id,2);order.push(id);}for(const id of nodes.keys())visit(id);
 return{nodes,deps,temporal,reverse,order,compiled};
}
export function impactOf(graph,id){const hits=new Set();const queue=[id];while(queue.length){const next=queue.shift();if(hits.has(next))continue;hits.add(next);for(const d of graph.reverse.get(next)||[])queue.push(d);}return hits;}
/** Inputs are bound to Excel saved numeric values (when mapped); overrides are scenario-only. */
export function simulate(model,{levels=model.levels||30,source=()=>undefined,changed=[]}={}){
 if(!Number.isInteger(levels)||levels<1||levels>500)throw Error('推演等级必须为 1–500');
 const graph=compileModel(model);const modified=changed.length?new Set(changed):new Set([...graph.nodes].filter(([,n])=>n.kind==='input'&&(Number(n.factor??1)!==1||Number(n.offset??0)!==0)).map(([id])=>id));
 const affected=new Set();for(const id of modified){if(!graph.nodes.has(id))throw Error(`未知变更节点 ${id}`);for(const d of impactOf(graph,id))affected.add(d);}
 const baseline=[],scenario=[];let prevBase={},prevNext={};let baselineOps=0,scenarioOps=0;
 for(let step=1;step<=levels;step++){
   const base={},next={};for(const id of graph.order){const n=graph.nodes.get(id);if(n.kind==='input'){
     let val=id==='level'?step:source(n,step);if(val===undefined||val===null)val=Number(n.value);
     if(!numeric(val))throw Error(`第 ${step} 级节点 ${id} 的 Excel 映射不是有效数字`);base[id]=val;
     next[id]=affected.has(id)?val*Number(n.factor??1)+Number(n.offset??0):val;
     if(!numeric(next[id]))throw Error(`第 ${step} 级输入 ${id} 调整后不是有效数值`);
   }else{
     const ctx={...base};for(const dep of graph.temporal.get(id))ctx['prev_'+dep]=prevBase[dep]??0;
     try{base[id]=evaluate(graph.compiled.get(id),ctx);baselineOps++;}catch(e){throw Error(`基准第 ${step} 级 ${id}：${e.message}`);}
     if(affected.has(id)){const changedCtx={...next};for(const dep of graph.temporal.get(id))changedCtx['prev_'+dep]=prevNext[dep]??0;
       try{next[id]=evaluate(graph.compiled.get(id),changedCtx);scenarioOps++;}catch(e){throw Error(`方案第 ${step} 级 ${id}：${e.message}`);}
     }else next[id]=base[id];
   }}baseline.push(base);scenario.push(next);prevBase=base;prevNext=next;
 }
 return{baseline,scenario,affected:[...affected],order:graph.order,stats:{baselineOps,scenarioOps,reused:(graph.order.filter(id=>graph.nodes.get(id).kind==='formula'&&!affected.has(id)).length)*levels},graph};
}
export function metricRows(result,id){return result.baseline.map((b,i)=>({level:i+1,base:b[id],projected:result.scenario[i][id],delta:result.scenario[i][id]-b[id]}));}
export function validateBindings(model,workbook){const errors=[];for(const n of model.nodes){if(n.kind!=='input'||!n.source)continue;const s=n.source;if(!workbook?.sheets?.some(v=>v.name===s.sheet))errors.push(`${n.id}：找不到工作表 ${s.sheet}`);if(s.mode==='cell'&&!/^[A-Z]{1,4}[1-9]\d*$/i.test(s.address||''))errors.push(`${n.id}：单元格地址无效`);if(s.mode==='column'&&(!/^[A-Z]{1,4}$/i.test(s.column||'')||!Number.isInteger(Number(s.startRow))||Number(s.startRow)<1))errors.push(`${n.id}：列或起始行无效`);if(!['cell','column'].includes(s.mode))errors.push(`${n.id}：绑定方式不支持`);}return errors;}
