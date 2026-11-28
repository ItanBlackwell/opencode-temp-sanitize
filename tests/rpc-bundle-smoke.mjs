import assert from "node:assert/strict";
import fs from "node:fs/promises";
import {realpathSync} from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = await fs.mkdtemp(path.join(os.tmpdir(), "sanitize-rpc-smoke-"));
let cleanup;
try {
  const tmp = path.join(root,"tmp");
  const config = path.join(root,"config");
  for(const key of ["TMPDIR","TEMP","TMP"]) process.env[key]=tmp;
  process.env.LOCALAPPDATA=config;
  process.env.XDG_CONFIG_HOME=config;
  await fs.mkdir(path.join(tmp,"opencode"),{recursive:true});
  await fs.mkdir(path.join(config,"opencode-temp-sanitize"),{recursive:true});
  const policy={enabled:false,showIndicator:true,retentionDays:7,intervalMinutes:60,maxBytes:2147483648,maxFiles:100000,legacy:false};
  const {showIndicator,...oldPolicy}=policy;
  await fs.writeFile(path.join(config,"opencode-temp-sanitize","settings.json"),JSON.stringify({...oldPolicy,enabled:true,dryRun:true}));
  const plugin=(await import(pathToFileURL(path.resolve("dist/server.mjs")).href)).default;
  const metadata=JSON.parse(await fs.readFile("package.json","utf8"));
  let handlers, definition;
  cleanup=await plugin.setup({
    location:{project:{id:"rpc-smoke",directory:root}},
    session:{hook:async()=>({dispose:async()=>{}})},
    shell:{hook:async()=>({dispose:async()=>{}})},
    rpc:{register:async(d,h)=>{definition=d;handlers=h;return {dispose:async()=>{}}}},
  });
  assert.equal(definition.id,"temp-sanitize");
  const invoke=async(name,input)=>{
    const promise=handlers[name](input,{error:(type,message,data)=>({type,message,data})});
    assert.equal(typeof promise.then,"function",name+" must return Promise");
    const result=await promise;
    assert.notEqual(result?.type,"operation_failed",name+" failed");
    return result;
  };
  const protocol=await invoke("protocol",{});
  assert.equal(protocol.version,metadata.version);
  assert.equal(protocol.root,realpathSync.native(path.join(tmp,"opencode")));
  // Verify actual filesystem identity as well as the native path spelling.
  const expectedStat=await fs.stat(path.join(tmp,"opencode"),{bigint:true});
  const reportedStat=await fs.stat(protocol.root,{bigint:true});
  assert.equal(reportedStat.dev,expectedStat.dev);
  assert.equal(reportedStat.ino,expectedStat.ino);
  assert.deepEqual(await invoke("settings",{}),policy);
  // Let the immediate scan-only scheduled pass finish before other mutations.
  for(let i=0;i<100&&!(await invoke("candidates",{})).id;i++)await new Promise(resolve=>setTimeout(resolve,20));
  assert.ok((await invoke("candidates",{})).id);
  assert.deepEqual(await invoke("save",{...policy,retentionDays:8}),{...policy,retentionDays:8});
  const storage=path.join(tmp,"opencode");
  await fs.mkdir(path.join(storage,"uploads","nested"),{recursive:true});
  await fs.mkdir(path.join(storage,"old-task","nested"),{recursive:true});
  await fs.writeFile(path.join(storage,"uploads","nested","a.bin"),Buffer.alloc(4096));
  await fs.writeFile(path.join(storage,"old-task","nested","b.bin"),Buffer.alloc(8192));
  await fs.writeFile(path.join(storage,"root.bin"),Buffer.alloc(1024));
  const overview=await invoke("analyze",{});
  assert.equal(overview.bytes,13312);
  assert.equal(overview.files,3);
  assert.deepEqual(await invoke("storageSummary",{}),overview);
  const {items:rows}=await invoke("storagePage",{snapshotId:overview.id,offset:0});
  assert.equal(rows.reduce((sum,row)=>sum+row.bytes,0),13312);
  assert.equal(rows.find(row=>row.name==="uploads")?.protected,true);
  assert.equal(rows.find(row=>row.name==="old-task")?.protected,true);
  // A 3-day-old file qualifies for a 1-day draft, but not the saved 8-day policy.
  const candidate=path.join(storage,"inactive-1234abcd","candidate.bin");
  await fs.mkdir(path.dirname(candidate),{recursive:true});
  await fs.writeFile(candidate,Buffer.alloc(128));
  const old=new Date(Date.now()-3*86400000);
  await fs.utimes(candidate,old,old);
  const saved={...policy,retentionDays:8};
  const originalSettings=await fs.readFile(path.join(config,"opencode-temp-sanitize","settings.json"),"utf8");
  const historyBefore=await invoke("history",{});
  const draft=await invoke("preview",{...saved,retentionDays:1});
  assert.equal(draft.dryRun,true);
  assert.equal(draft.candidates,1);
  assert.equal(draft.files,0);
  assert.equal(await fs.stat(candidate).then(s=>s.size),128);
  assert.deepEqual(await invoke("settings",{}),saved);
  assert.equal(await fs.readFile(path.join(config,"opencode-temp-sanitize","settings.json"),"utf8"),originalSettings);
  assert.deepEqual(await invoke("history",{}),historyBefore);
  const draftSummary=await invoke("candidates",{});
  assert.equal(draftSummary.matchesSaved,false);
  const candidatePage=await invoke("candidatePage",{snapshotId:draftSummary.id,offset:0});
  assert.equal(candidatePage.items.length,1);
  assert.equal(candidatePage.items[0].bytes,128);
  const denied=await handlers.cleanSelected({confirmed:true,snapshotId:draftSummary.id,ids:[0]},{error:(type,message,data)=>({type,message,data})});
  assert.equal(denied.type,"operation_failed");
  const normal=await invoke("preview",saved);
  assert.equal(normal.dryRun,true);
  assert.equal(normal.candidates,0);
  const invalid=await handlers.preview({...saved,retentionDays:0},{error:(type,message,data)=>({type,message,data})});
  assert.equal(invalid.type,"operation_failed");
  const manual=await invoke("clean",{confirmed:true});
  assert.equal((await invoke("storageSummary",{})).id,"");
  assert.equal(manual.dryRun,false);
  assert.equal(manual.candidates,0);
  assert.equal(await fs.stat(candidate).then(s=>s.size),128);
  await invoke("save",{...saved,retentionDays:1});
  await invoke("preview",{...saved,retentionDays:1});
  const ready=await invoke("candidates",{});
  assert.equal(ready.matchesSaved,true);
  assert.deepEqual(await invoke("indicator",{}),{visible:true,count:1,bytes:128});
  await invoke("save",{...saved,retentionDays:1,showIndicator:false});
  assert.deepEqual(await invoke("indicator",{}),{visible:false,count:0,bytes:0});
  await invoke("save",{...saved,retentionDays:1});
  assert.deepEqual(await invoke("indicator",{}),{visible:true,count:1,bytes:128});
  const beforeRenewal=await fs.stat(candidate);
  assert.equal((await invoke("candidatePage",{snapshotId:ready.id,offset:0})).items[0].canExtend,true);
  assert.deepEqual(await invoke("extendSelected",{snapshotId:ready.id,ids:[0]}),{extended:1,errors:0});
  const renewed=await fs.stat(candidate);
  assert.ok(Math.abs(renewed.mtimeMs-beforeRenewal.mtimeMs)<2);
  assert.ok(Date.now()-renewed.atimeMs<60000);
  assert.deepEqual(await invoke("indicator",{}),{visible:false,count:0,bytes:0});
  await fs.utimes(candidate,old,old);
  await invoke("preview",{...saved,retentionDays:1});
  const again=await invoke("candidates",{});
  const selected=await invoke("cleanSelected",{confirmed:true,snapshotId:again.id,ids:[0]});
  assert.equal(selected.files,1);
  assert.deepEqual(await invoke("indicator",{}),{visible:false,count:0,bytes:0});
  await assert.rejects(fs.stat(candidate),{code:"ENOENT"});
  console.log("Packaged server RPC smoke passed");
} finally {
  await cleanup?.();
  await fs.rm(root,{recursive:true,force:true});
}
