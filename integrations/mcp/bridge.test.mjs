import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHandler, callTool, listTools } from './bridge.mjs';

const W='a'.repeat(24),R='b'.repeat(24),H='c'.repeat(64),OP='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const env={FLOWCRAFT_MCP_API_ORIGIN:'https://flowcraft-ai-workflow-builder.vercel.app',FLOWCRAFT_MCP_SESSION_TOKEN:'x'.repeat(40)};
const workflow={_id:W,name:'Test',currentRevision:3,definitionHash:H,nodes:[{config:{secret:'CANARY_PRIVATE'}}]};
const run={_id:R,workflowId:W,status:'completed',workflowRevision:3,error:'CANARY_PRIVATE',stepLogs:[{status:'success',input:{secret:'CANARY_PRIVATE'},output:{secret:'CANARY_PRIVATE'},error:'CANARY_PRIVATE',nodeLabel:'CANARY_PRIVATE'}]};
function apiFixture(resolver,calls=[]){
 return async (url,options)=>{
  calls.push({path:url.pathname,method:options.method,headers:options.headers});
  const d=resolver(url.pathname);
  if(typeof d==='number')return {status:d,ok:false,headers:new Headers(),text:async()=>JSON.stringify({error:'CANARY_PRIVATE'})};
  return {status:200,ok:true,headers:new Headers(),text:async()=>JSON.stringify({data:d})};
 };
}
const rpc=(method,params={},id=1)=>({jsonrpc:'2.0',id,method,params:{...params,_meta:{'io.modelcontextprotocol/protocolVersion':'2026-07-28','io.modelcontextprotocol/clientInfo':{name:'test',version:'1'},'io.modelcontextprotocol/clientCapabilities':{}}}});
const runArgs={workflowId:W,expectedRevision:3,expectedDefinitionHash:H,operationId:OP,acknowledgeSideEffects:true};

test('modern discovery, deterministic tool catalog and legacy initialize',async()=>{
 const h=createHandler({env:{}});
 const d=await h(rpc('server/discover'));
 assert.equal(d.result.resultType,'complete');
 assert.ok(d.result.supportedVersions.includes('2026-07-28'));
 assert.equal((await h(rpc('tools/list'))).result.tools.length,3);
 assert.equal((await h(rpc('tools/call',{name:'run_workflow'}))).error.code,-32602);
 const old=await h({jsonrpc:'2.0',method:'initialize',id:2,params:{protocolVersion:'2025-11-25'}});
 assert.equal(old.result.protocolVersion,'2025-11-25');
 const newer=await h({jsonrpc:'2.0',id:3,method:'tools/list',params:{_meta:{'io.modelcontextprotocol/protocolVersion':'future'}}});
 assert.equal(newer.error.code,-32602);
 assert.equal(listTools({FLOWCRAFT_MCP_ENABLE_RUNS:'1'}).length,4);
});
test('all three read tools redact nested runtime/source secrets',async()=>{
 const calls=[];
 const f=apiFixture(p=>p==='/api/workflows'?[workflow]:p==='/api/workflows/'+W?workflow:run,calls);
 const h=createHandler({env,fetchImpl:f});
 const outputs=await Promise.all([
  h(rpc('tools/call',{name:'list_workflows',arguments:{}})),
  h(rpc('tools/call',{name:'get_workflow',arguments:{workflowId:W}})),
  h(rpc('tools/call',{name:'get_execution_status',arguments:{runId:R}}))
 ]);
 assert.equal(outputs.length,3);
 for(const o of outputs){
  assert.equal(o.result.isError,false);
  assert.ok(!JSON.stringify(o).includes('CANARY_PRIVATE'));
 }
 const wf=JSON.parse(outputs[1].result.content[0].text);
 assert.equal(wf.definitionHash,H);
 assert.equal(wf.nodeCount,1);
 const st=JSON.parse(outputs[2].result.content[0].text);
 assert.deepEqual(st.stepCounts,{pending:0,running:0,success:1,failed:0,skipped:0});
 assert.ok(calls.every(c=>c.method==='GET'));
 assert.ok(calls.every(c=>c.headers.cookie==='token='+env.FLOWCRAFT_MCP_SESSION_TOKEN));
});
test('strict tool argument checks occur before backend network access',async()=>{
 const calls=[],h=createHandler({env,fetchImpl:apiFixture(()=>401,calls)});
 for(const bad of [{runId:'../x'},{runId:R,extra:true}]){
  const out=await h(rpc('tools/call',{name:'get_execution_status',arguments:bad}));
  assert.equal(out.result.isError,true);
 }
 assert.equal(calls.length,0);
 const denied=await h(rpc('tools/call',{name:'list_workflows',arguments:{}}));
 assert.equal(denied.result.content[0].text,'SESSION_EXPIRED');
 assert.ok(!JSON.stringify(denied).includes('CANARY_PRIVATE'));
});
test('execution disabled by default, even when agent calls it directly',async()=>{
 const calls=[];
 const h=createHandler({env,fetchImpl:apiFixture(()=>workflow,calls)});
 assert.equal((await h(rpc('tools/call',{name:'run_workflow',arguments:runArgs}))).error.code,-32602);
 assert.equal(calls.length,0);
});
test('allowlist and side-effect acknowledgement block writes before API access',async()=>{
 const calls=[];
 const runEnv={...env,FLOWCRAFT_MCP_ENABLE_RUNS:'1',FLOWCRAFT_MCP_RUN_WORKFLOW_IDS:R,FLOWCRAFT_MCP_TRUSTED_ORIGIN:env.FLOWCRAFT_MCP_API_ORIGIN,FLOWCRAFT_MCP_JOURNAL_DIR:'/tmp/flowcraft-mcp-test-unused'};
 const opts={env:runEnv,fetchImpl:apiFixture(()=>workflow,calls)};
 await assert.rejects(callTool('run_workflow',runArgs,opts),/NOT_ALLOWLISTED/);
 runEnv.FLOWCRAFT_MCP_RUN_WORKFLOW_IDS=W;
 await assert.rejects(callTool('run_workflow',{...runArgs,acknowledgeSideEffects:false},opts),/RUN_APPROVAL_OR_REVISION_INVALID/);
 assert.equal(calls.length,0);
});
test('shared demo account and changed revision cannot initiate a live run',async()=>{
 const calls=[],dir=await mkdtemp(join(tmpdir(),'mcp-'));
 let demo=true;
 const opts={env:{...env,FLOWCRAFT_MCP_ENABLE_RUNS:'1',FLOWCRAFT_MCP_RUN_WORKFLOW_IDS:W,FLOWCRAFT_MCP_TRUSTED_ORIGIN:env.FLOWCRAFT_MCP_API_ORIGIN,FLOWCRAFT_MCP_JOURNAL_DIR:dir},fetchImpl:apiFixture(p=>p==='/api/auth/me'?{isDemoAccount:demo}:workflow,calls)};
 try{
  await assert.rejects(callTool('run_workflow',runArgs,opts),/NON_DEMO_ACCOUNT_REQUIRED/);
  demo=false;
  await assert.rejects(callTool('run_workflow',{...runArgs,expectedRevision:4},opts),/REVISION_CHANGED/);
  assert.ok(!calls.some(c=>c.method==='POST'));
  assert.equal((await readdir(dir)).length,0);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('single authorized POST and durable no-retry journal across calls',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'mcp-')),calls=[];
 const opts={env:{...env,FLOWCRAFT_MCP_ENABLE_RUNS:'1',FLOWCRAFT_MCP_RUN_WORKFLOW_IDS:W,FLOWCRAFT_MCP_TRUSTED_ORIGIN:env.FLOWCRAFT_MCP_API_ORIGIN,FLOWCRAFT_MCP_JOURNAL_DIR:dir},fetchImpl:apiFixture(p=>p==='/api/auth/me'?{isDemoAccount:false}:p==='/api/workflows/'+W?workflow:{...run,status:'running'},calls)};
 try{
  const result=await callTool('run_workflow',runArgs,opts);
  assert.equal(result.status,'running');
  assert.equal(calls.filter(c=>c.method==='POST').length,1);
  assert.equal(calls.find(c=>c.method==='POST').headers.origin,env.FLOWCRAFT_MCP_API_ORIGIN);
  assert.equal((await readdir(dir)).length,1);
  await assert.rejects(callTool('run_workflow',runArgs,opts),/ALREADY_ATTEMPTED_NO_RETRY/);
  assert.equal(calls.filter(c=>c.method==='POST').length,1);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('uncertain POST cannot be automatically repeated with same ID',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'mcp-'));let posts=0;
 const f=async(url)=>{
  if(url.pathname==='/api/auth/me')return {ok:true,status:200,headers:new Headers(),text:async()=>JSON.stringify({data:{isDemoAccount:false}})};
  if(url.pathname==='/api/workflows/'+W)return {ok:true,status:200,headers:new Headers(),text:async()=>JSON.stringify({data:workflow})};
  posts++;throw Error('CANARY_PRIVATE');
 };
 const opts={env:{...env,FLOWCRAFT_MCP_ENABLE_RUNS:'1',FLOWCRAFT_MCP_RUN_WORKFLOW_IDS:W,FLOWCRAFT_MCP_TRUSTED_ORIGIN:env.FLOWCRAFT_MCP_API_ORIGIN,FLOWCRAFT_MCP_JOURNAL_DIR:dir},fetchImpl:f};
 try{
  await assert.rejects(callTool('run_workflow',runArgs,opts),/API_REQUEST_FAILED_OR_UNCERTAIN/);
  await assert.rejects(callTool('run_workflow',runArgs,opts),/ALREADY_ATTEMPTED_NO_RETRY/);
  assert.equal(posts,1);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('stdio process emits protocol JSON only, no banner or console logs',async()=>{
 const child=spawn(process.execPath,[new URL('./server.mjs',import.meta.url).pathname],{stdio:['pipe','pipe','pipe']});
 const lines=[];let chunk='';
 child.stdout.on('data',data=>{
  chunk+=data.toString();
  while(chunk.includes('\n')){const i=chunk.indexOf('\n');lines.push(JSON.parse(chunk.slice(0,i)));chunk=chunk.slice(i+1);}
 });
 child.stdin.write(JSON.stringify(rpc('server/discover',{},31))+'\n');
 child.stdin.write(JSON.stringify(rpc('tools/list',{},32))+'\n');
 child.stdin.end();
 const code=await new Promise((ok,fail)=>{child.on('close',ok);child.on('error',fail);});
 assert.equal(code,0);
 assert.deepEqual(lines.map(x=>x.id),[31,32]);
});
