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
  const policy={enabled:false,retentionDays:7,intervalMinutes:60,maxBytes:2147483648,maxFiles:100000,legacy:false,dryRun:true};
  await fs.writeFile(path.join(config,"opencode-temp-sanitize","settings.json"),JSON.stringify(policy));
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
  assert.deepEqual(await invoke("save",{...policy,retentionDays:8}),{...policy,retentionDays:8});
  const storage=path.join(tmp,"opencode");
  await fs.mkdir(path.join(storage,"uploads","nested"),{recursive:true});
  await fs.mkdir(path.join(storage,"old-task","nested"),{recursive:true});
  await fs.writeFile(path.join(storage,"uploads","nested","a.bin"),Buffer.alloc(4096));
  await fs.writeFile(path.join(storage,"old-task","nested","b.bin"),Buffer.alloc(8192));
  await fs.writeFile(path.join(storage,"root.bin"),Buffer.alloc(1024));
  const rows=await invoke("analyze",{});
  assert.equal(rows.reduce((sum,row)=>sum+row.bytes,0),13312);
  assert.equal(rows.find(row=>row.name==="uploads")?.protected,true);
  assert.equal(rows.find(row=>row.name==="old-task")?.protected,true);
  assert.ok(Array.isArray(await invoke("history",{})));
  assert.equal((await invoke("preview",{})).dryRun,true);
  assert.equal((await invoke("clean",{confirmed:true})).dryRun,true);
  console.log("Packaged server RPC smoke passed");
} finally {
  await cleanup?.();
  await fs.rm(root,{recursive:true,force:true});
}
