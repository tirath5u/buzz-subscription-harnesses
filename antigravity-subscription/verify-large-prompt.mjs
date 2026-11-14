import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
const manifest=JSON.parse(readFileSync(new URL("./manifest.json",import.meta.url),"utf8"));
const launcher=manifest.host.processes.find((entry)=>entry.id==="antigravity");
const dir=mkdtempSync(join(tmpdir(),"buzz-antigravity-launcher-"));
try{
  writeFileSync(join(dir,"agy.cmd"),"@echo off\r\nnode \"%~dp0capture.mjs\" %*\r\n");
  writeFileSync(join(dir,"capture.mjs"),`import{readFileSync}from"node:fs";let text="";process.stdin.setEncoding("utf8");process.stdin.on("data",x=>text+=x);process.stdin.on("end",()=>{const f=process.cwd()+"/.agents/plugins/buzz/mcp_config.json";console.log(JSON.stringify({text,args:process.argv.slice(2),cwd:process.cwd(),config:readFileSync(f,"utf8")}))});`);
  const prompt=`BEGIN\n${`🐝 spaces \"quotes\" ; $() & %PATH% !PATH!\n`.repeat(2400)}END`;
  assert(Buffer.byteLength(prompt,"utf8")>32768);
  const input=`${JSON.stringify({event:"user",message:{content:prompt}})}\n`;
  const mcpConfig=JSON.stringify({mcpServers:{buzz:{serverUrl:"http://127.0.0.1:1234/mcp",headers:{Authorization:"Bearer test"}}}});
  const args=["--input-format","stream-json","--output-format","stream-json","--print="];
  const result=spawnSync(launcher.program,launcher.args,{input:JSON.stringify({args,input,mcpConfig,wrapperKey:"large-hostile-key"}),encoding:"utf8",env:{...process.env,PATH:`${dir}${delimiter}${process.env.PATH??""}`},maxBuffer:2*1024*1024});
  assert.equal(result.status,0,result.stderr||"launcher failed");
  const captured=JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1));
  const decoded=JSON.parse(captured.text.trim());
  assert.equal(decoded.message.content,prompt);
  assert.deepEqual(captured.args,args);
  assert.equal(captured.config,mcpConfig);
  assert.match(captured.cwd,/buzz-antigravity-large-hostile-key$/i);
  console.log(`large prompt verified: ${Buffer.byteLength(prompt,"utf8")} UTF-8 bytes and ephemeral MCP plugin reached agy.cmd intact`);
}finally{rmSync(dir,{recursive:true,force:true});}
