#!/usr/bin/env node
// Dedicated local stdio process. Stdout carries JSON-RPC ONLY; no secrets/logs.
import { createInterface } from 'node:readline';
import { createHandler } from './bridge.mjs';

const handle=createHandler();
const input=createInterface({input:process.stdin,crlfDelay:Infinity});
for await(const line of input){
 if(Buffer.byteLength(line,'utf8')>65536){
  process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:null,error:{code:-32700,message:'Message too large'}})+'\n');
  continue;
 }
 let response;
 try{response=await handle(JSON.parse(line));}
 catch{response={jsonrpc:'2.0',id:null,error:{code:-32700,message:'Parse error'}};}
 if(response!==null)process.stdout.write(JSON.stringify(response)+'\n');
}
