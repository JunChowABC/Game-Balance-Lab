/** Explicit what-if engine over cached Excel values. No Excel formula recomputation. */
const allowedFns={min:Math.min,max:Math.max,abs:Math.abs,round:Math.round,ceil:Math.ceil,floor:Math.floor,pow:Math.pow,sqrt:Math.sqrt,log:Math.log,exp:Math.exp,clamp:(v,a,b)=>Math.min(Math.max(v,a),b)};
export const DEFAULT_FORMULA='max(0, (y * k + t * b) * pow(1 + g / 100, t))';
const isNum=x=>typeof x==='number'&&Number.isFinite(x);
/** Small, non-eval parser for the user-authored numeric expression. */
export function parseExpression(source){
  const s=String(source||'').trim();if(!s||s.length>600)throw Error('请输入不超过 600 字的表达式');
  const tokens=[];let i=0;
  while(i<s.length){if(/\s/.test(s[i])){i++;continue;}
    const m=s.slice(i).match(/^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?|^[A-Za-z_][A-Za-z_0-9]*|^[+\-*/^(),]/);
    if(!m)throw Error(`无法识别的字符：${s.slice(i,i+10)}`);
    tokens.push(m[0]);i+=m[0].length;if(tokens.length>220)throw Error('表达式过长');
  }
  let p=0;const peek=()=>tokens[p];const eat=a=>{if(peek()!==a)throw Error(`表达式缺少 ${a}`);p++;};
  function primary(){const t=peek();if(t===undefined)throw Error('表达式不完整');
    if(t==='('){p++;const n=add();eat(')');return n;}
    if(/^(?:\d|\.)/.test(t)){p++;const v=Number(t);if(!Number.isFinite(v))throw Error('非法数值');return {kind:'num',v};}
    if(/^[A-Za-z_]/.test(t)){
      p++;const name=t.toLowerCase();if(peek()==='('){p++;const args=[];if(peek()!==')'){while(true){args.push(add());if(peek()!==',')break;p++;}}eat(')');if(!Object.prototype.hasOwnProperty.call(allowedFns,name))throw Error(`不支持的函数：${t}`);if(args.length>8)throw Error('函数参数过多');return {kind:'call',name,args};}
      if(!/^(x|y|t|k|b|g|[a-z]{1,3})$/.test(name))throw Error(`未知变量：${t}`);
      return {kind:'var',name};}
    throw Error(`表达式无法解析：${t}`);
  }
  function unary(){if(peek()==='+'||peek()==='-'){const op=tokens[p++];return{kind:'unary',op,expr:unary()};}return power();}
  function power(){let left=primary();if(peek()==='^'){p++;left={kind:'bin',op:'^',a:left,b:unary()};}return left;}
  function mul(){let node=unary();while(['*','/'].includes(peek())){const op=tokens[p++];node={kind:'bin',op,a:node,b:unary()};}return node;}
  function add(){let node=mul();while(['+','-'].includes(peek())){const op=tokens[p++];node={kind:'bin',op,a:node,b:mul()};}return node;}
  const tree=add();if(p!==tokens.length)throw Error(`表达式多余部分：${tokens.slice(p).join(' ')}`);return tree;
}
export function evaluate(tree,vars){function run(n){switch(n.kind){case'num':return n.v;case'var':{const v=vars[n.name];if(!isNum(v))throw Error(`变量 ${n.name.toUpperCase()} 在当前行没有有效数值`);return v;}case'unary':return n.op==='-'?-run(n.expr):run(n.expr);case'bin':{const a=run(n.a),b=run(n.b);if(n.op==='/'){if(b===0)throw Error('分母为零');return a/b;}return n.op==='+'?a+b:n.op==='-'?a-b:n.op==='*'?a*b:Math.pow(a,b);}case'call':return allowedFns[n.name](...n.args.map(run));default:throw Error('表达式类型错误');}}const result=run(tree);if(!isNum(result))throw Error('计算结果不是有限数字');return result;}
export function project(points,options={},rowVars=()=>({})){const {multiplier=1,delta=0,growth=0,formula=DEFAULT_FORMULA}=options;
  if(!points.length)return{points:[],errors:[]};if(![multiplier,delta,growth].every(isNum))throw Error('推演参数必须是有效数字');
  const tree=parseExpression(formula);const x0=points[0].x;const result=[],errors=[];
  for(const p of points){try{const variables={...rowVars(p.row),x:p.x,y:p.y,t:p.x-x0,k:multiplier,b:delta,g:growth};const value=evaluate(tree,variables);result.push({...p,base:p.y,projected:value,diff:value-p.y,pct:p.y===0?null:(value/p.y-1)*100});}
  catch(e){errors.push({row:p.row,reason:e.message});}}
  return{points:result,errors};}
export function getSummary(points){if(!points.length)return null;const first=points[0],last=points[points.length-1];const changes=points.slice(1).map((p,i)=>p.projected-points[i].projected);const flags=[];
  let falls=0,plateaus=0,leaps=0;const absolute=changes.map(Math.abs).filter(v=>v>1e-9).sort((a,b)=>a-b),median=absolute.length?absolute[Math.floor(absolute.length/2)]:0;
  for(let i=0;i<changes.length;i++){const d=changes[i];if(d < -1e-9){falls++;if(flags.length<8)flags.push({x:points[i+1].x,message:'相邻成长值下降'});}if(Math.abs(d)<1e-9)plateaus++;if(median>0&&Math.abs(d)>median*5){leaps++;if(flags.length<8)flags.push({x:points[i+1].x,message:'变化超过典型增长 5 倍'});}}
  return{count:points.length,first,last,falls,plateaus,leaps,flags,delta:last.projected-last.base,deltaPercent:last.base===0?null:(last.projected/last.base-1)*100};}
export function csvRows(points){return[['工作表原行','横轴','原始值（Excel缓存）','假设推演值','差值','变化百分比'],...points.map(p=>[p.row,p.x,p.base,p.projected,p.diff,p.pct??''])];}
