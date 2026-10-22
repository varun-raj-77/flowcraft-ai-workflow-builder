import { createHash } from 'node:crypto';
import { mkdir, open } from 'node:fs/promises';
import { resolve } from 'node:path';

// Isolated local stdio adapter: no new API route, MongoDB schema, or browser changes.
// The cookie token is provided locally by the operator and never echoed to MCP.
const CURRENT = '2026-07-28', LEGACY = '2025-11-25';
const versions = [CURRENT, LEGACY];
const objectId = /^[a-f0-9]{24}$/i, hash = /^[a-f0-9]{64}$/i;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const meta = { name: 'flowcraft-local', version: '0.1.0' };
const idSchema = { type:'string',pattern:'^[a-fA-F0-9]{24}$' };
const tools = [
 { name:'list_workflows',description:'List 20 owned workflows; no source or secrets.',inputSchema:{type:'object',additionalProperties:false},annotations:{readOnlyHint:true,destructiveHint:false}},
 { name:'get_workflow',description:'Get owned workflow metadata, revision and definition hash; no graph contents.',inputSchema:{type:'object',properties:{workflowId:idSchema},required:['workflowId'],additionalProperties:false},annotations:{readOnlyHint:true,destructiveHint:false}},
 { name:'get_execution_status',description:'Get owned run status and step counts only. No outputs, inputs, diagnostics or error text.',inputSchema:{type:'object',properties:{runId:idSchema},required:['runId'],additionalProperties:false},annotations:{readOnlyHint:true,destructiveHint:false}},
 { name:'run_workflow',description:'Start one REAL workflow run with potential irreversible effects. Requires local operator enablement, dedicated account, workflow allowlist, exact revision/hash, and a durable one-attempt ID. Human confirmation by MCP host is required.',inputSchema:{type:'object',properties:{workflowId:idSchema,expectedRevision:{type:'integer',minimum:1},expectedDefinitionHash:{type:'string',pattern:'^[a-fA-F0-9]{64}$'},operationId:{type:'string',format:'uuid'},acknowledgeSideEffects:{type:'boolean',const:true}},required:['workflowId','expectedRevision','expectedDefinitionHash','operationId','acknowledgeSideEffects'],additionalProperties:false},annotations:{readOnlyHint:false,destructiveHint:true,idempotentHint:false}}
];
const obj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
function validate(v, keys){if(!obj(v)||Object.keys(v).some(k=>!keys.includes(k)))throw Error('INVALID_ARGUMENTS');}
function validId(v){if(typeof v!=='string'||!objectId.test(v))throw Error('INVALID_ID');return v.toLowerCase();}
function origin(value){
 if(typeof value!=='string')throw Error('ORIGIN_NOT_CONFIGURED');
 let u;try{u=new URL(value);}catch{throw Error('INVALID_ORIGIN');}
 const local=u.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(u.hostname);
 if((u.protocol!=='https:'&&!local)||value!==u.origin||u.username||u.password)throw Error('INVALID_ORIGIN');
 return value;
}
function safeWorkflow(row){
 if(!obj(row))throw Error('INVALID_API_RESPONSE');
 const x={workflowId:validId(row._id),name:typeof row.name==='string'?row.name.slice(0,100):'',currentRevision:Number.isSafeInteger(row.currentRevision)&&row.currentRevision>0?row.currentRevision:null};
 if(typeof row.definitionHash==='string'&&hash.test(row.definitionHash))x.definitionHash=row.definitionHash.toLowerCase();
 if(Number.isSafeInteger(row.nodeCount)&&row.nodeCount>=0)x.nodeCount=row.nodeCount;
 else if(Array.isArray(row.nodes))x.nodeCount=row.nodes.length;
 return x;
}
function safeRun(row){
 if(!obj(row))throw Error('INVALID_API_RESPONSE');
 const r={runId:validId(row._id),workflowId:validId(row.workflowId),status:['running','completed','failed','cancelled'].includes(row.status)?row.status:'unknown',workflowRevision:Number.isSafeInteger(row.workflowRevision)?row.workflowRevision:null};
 if(Array.isArray(row.stepLogs)){
  const counts={pending:0,running:0,success:0,failed:0,skipped:0};
  for(const s of row.stepLogs.slice(0,200))if(obj(s)&&Object.hasOwn(counts,s.status))counts[s.status]++;
  r.stepCounts=counts;
 }
 return r;
}
async function api(env,fetchImpl,path,method='GET',trustedOrigin){
 const host=origin(env.FLOWCRAFT_MCP_API_ORIGIN);
 const token=env.FLOWCRAFT_MCP_SESSION_TOKEN;
 if(typeof token!=='string'||! /^[A-Za-z0-9_.-]{16,8192}$/.test(token))throw Error('SESSION_TOKEN_REQUIRED');
 const url=new URL(path,host);
 if(url.origin!==host||!url.pathname.startsWith('/api/'))throw Error('INVALID_API_PATH');
 let response;
 try{response=await fetchImpl(url,{method,redirect:'error',cache:'no-store',signal:AbortSignal.timeout(10000),headers:{accept:'application/json',cookie:'token='+token,...(trustedOrigin?{origin:trustedOrigin}:{})}});}
 catch{throw Error('API_REQUEST_FAILED_OR_UNCERTAIN');}
 if(response.status===401)throw Error('SESSION_EXPIRED');
 if(response.status===403)throw Error('ACCESS_DENIED');
 if(!response.ok)throw Error('API_HTTP_'+response.status);
 if(Number(response.headers?.get?.('content-length'))>524288)throw Error('RESPONSE_TOO_LARGE');
 let data;
 try{const body=await response.text();if(body.length>524288)throw Error('RESPONSE_TOO_LARGE');data=JSON.parse(body).data;}
 catch{throw Error('INVALID_API_RESPONSE');}
 return data;
}
async function reserve(dir,workflowId,operationId){
 const filename=createHash('sha256').update(workflowId+':'+operationId).digest('hex')+'.attempt';
 await mkdir(dir,{recursive:true,mode:0o700});
 let handle;
 try{handle=await open(resolve(dir,filename),'wx',0o600);}
 catch(e){if(e?.code==='EEXIST')throw Error('ALREADY_ATTEMPTED_NO_RETRY');throw Error('JOURNAL_UNAVAILABLE');}
 try{await handle.writeFile('reserved; do not retry an uncertain execution\n');await handle.sync();}
 finally{await handle.close();}
}
export function listTools(env={}){return tools.filter(t=>t.name!=='run_workflow'||env.FLOWCRAFT_MCP_ENABLE_RUNS==='1');}
export async function callTool(name,args,{env=process.env,fetchImpl=fetch}={}){
 if(name==='list_workflows'){
  validate(args,[]);
  const rows=await api(env,fetchImpl,'/api/workflows');
  if(!Array.isArray(rows))throw Error('INVALID_API_RESPONSE');
  return {workflows:rows.slice(0,20).map(safeWorkflow),truncated:rows.length>20};
 }
 if(name==='get_workflow'){
  validate(args,['workflowId']);const id=validId(args.workflowId);
  return safeWorkflow(await api(env,fetchImpl,'/api/workflows/'+id));
 }
 if(name==='get_execution_status'){
  validate(args,['runId']);const id=validId(args.runId);
  return safeRun(await api(env,fetchImpl,'/api/executions/run/'+id));
 }
 if(name==='run_workflow'){
  validate(args,['workflowId','expectedRevision','expectedDefinitionHash','operationId','acknowledgeSideEffects']);
  const id=validId(args.workflowId);
  if(env.FLOWCRAFT_MCP_ENABLE_RUNS!=='1')throw Error('RUNS_DISABLED');
  const allow=(env.FLOWCRAFT_MCP_RUN_WORKFLOW_IDS||'').split(',').map(s=>s.trim().toLowerCase());
  if(!allow.every(s=>objectId.test(s))||!allow.includes(id))throw Error('NOT_ALLOWLISTED');
  const dir=env.FLOWCRAFT_MCP_JOURNAL_DIR;
  if(typeof dir!=='string'||!dir.startsWith('/'))throw Error('ABSOLUTE_JOURNAL_REQUIRED');
  const trusted=origin(env.FLOWCRAFT_MCP_TRUSTED_ORIGIN);
  if(!Number.isSafeInteger(args.expectedRevision)||args.expectedRevision<1||
     typeof args.expectedDefinitionHash!=='string'||!hash.test(args.expectedDefinitionHash)||
     typeof args.operationId!=='string'||!uuid.test(args.operationId)||
     args.acknowledgeSideEffects!==true)throw Error('RUN_APPROVAL_OR_REVISION_INVALID');
  const me=await api(env,fetchImpl,'/api/auth/me');
  if(!obj(me)||me.isDemoAccount!==false)throw Error('NON_DEMO_ACCOUNT_REQUIRED');
  const workflow=safeWorkflow(await api(env,fetchImpl,'/api/workflows/'+id));
  if(workflow.currentRevision!==args.expectedRevision||workflow.definitionHash!==args.expectedDefinitionHash.toLowerCase())throw Error('REVISION_CHANGED');
  await reserve(dir,id,args.operationId.toLowerCase()); // Atomic attempt journal before network write.
  const run=safeRun(await api(env,fetchImpl,'/api/executions/'+id+'/run','POST',trusted));
  if(run.workflowId!==id)throw Error('INVALID_API_RESPONSE');
  return {...run,note:'One POST requested. Do not automatically retry after uncertainty; external side effects may already have occurred.'};
 }
 throw Error('UNKNOWN_TOOL');
}
const error=(id,code,message,data)=>({jsonrpc:'2.0',id,error:{code,message,...(data?{data}:{})}});
export function createHandler({env=process.env,fetchImpl=fetch}={}){
 const requests=[];
 return async function handle(msg){
  if(!obj(msg)||msg.jsonrpc!=='2.0'||typeof msg.method!=='string')return error(null,-32600,'Invalid Request');
  if(!Object.hasOwn(msg,'id'))return null; // Notification; no response.
  const id=msg.id,p=obj(msg.params)?msg.params:{};
  if(!(typeof id==='string'||typeof id==='number'||id===null))return error(null,-32600,'Invalid Request');
  const version=p._meta?.['io.modelcontextprotocol/protocolVersion'];
  if(msg.method!=='initialize'&&version!==undefined&&!versions.includes(version))return error(id,-32602,'Unsupported protocol version',{supportedVersions:versions});
  if(msg.method==='server/discover')return {jsonrpc:'2.0',id,result:{resultType:'complete',supportedVersions:versions,capabilities:{tools:{}},_meta:{'io.modelcontextprotocol/serverInfo':meta},ttlMs:300000,cacheScope:'public'}};
  if(msg.method==='initialize')return {jsonrpc:'2.0',id,result:{protocolVersion:LEGACY,capabilities:{tools:{}},serverInfo:meta}};
  if(msg.method==='ping')return {jsonrpc:'2.0',id,result:{}};
  if(msg.method==='tools/list'){
   if(p.cursor!==undefined)return error(id,-32602,'Cursor not supported');
   return {jsonrpc:'2.0',id,result:{...(version===LEGACY?{}:{resultType:'complete',ttlMs:300000,cacheScope:'public'}),tools:listTools(env)}};
  }
  if(msg.method==='tools/call'){
   if(typeof p.name!=='string'||!listTools(env).some(t=>t.name===p.name))return error(id,-32602,'Unknown or disabled tool');
   const now=Date.now();while(requests.length&&requests[0]<now-60000)requests.shift();
   if(requests.length>=60)return error(id,-32000,'Rate limit');
   requests.push(now);
   try{
    const data=await callTool(p.name,p.arguments??{},{env,fetchImpl});
    return {jsonrpc:'2.0',id,result:{...(version===LEGACY?{}:{resultType:'complete'}),content:[{type:'text',text:JSON.stringify(data)}],isError:false}};
   }catch(e){
    const safe=e instanceof Error&&/^[A-Z_0-9]+$/.test(e.message)?e.message:'TOOL_UNAVAILABLE';
    return {jsonrpc:'2.0',id,result:{...(version===LEGACY?{}:{resultType:'complete'}),content:[{type:'text',text:safe}],isError:true}};
   }
  }
  return error(id,-32601,'Method not found');
 };
}
