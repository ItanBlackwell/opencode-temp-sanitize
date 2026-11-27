import fs from "node:fs/promises";
import path from "node:path";
import {isProjectDir, protectedProject, sweepDir, sweepProjects} from "./sweep.js";
import {settingsStore} from "./settings.js";

const managers = new Map();
export function acquireManager(root, configDir) {
  let entry = managers.get(root);
  if (!entry) {
    entry = {manager:createManager(root, configDir), refs:0};
    managers.set(root, entry);
  }
  entry.refs++;
  return {manager:entry.manager, async release(){
    if (--entry.refs === 0) { managers.delete(root); await entry.manager.stop(); }
  }};
}
function createManager(root, configDir) {
  const store = settingsStore(configDir);
  let running, stopped = false, timer, last = 0;
  const history = [];
  async function analyze() {
    const rows = [];
    async function scan(dir, row, flat=false) {
      for (const item of await fs.readdir(dir,{withFileTypes:true})) {
        if (item.name.startsWith(".sanitize-")) continue;
        const target = path.join(dir,item.name);
        try {
          const stat = await fs.lstat(target);
          if (stat.isDirectory() && !stat.isSymbolicLink() && !flat) await scan(target,row);
          else if (stat.isFile() || stat.isSymbolicLink()) {row.files++;row.bytes+=stat.size;}
        } catch(e) {row.errors++;}
      }
    }
    const legacy = {name:"Legacy root files",files:0,bytes:0,protected:true,errors:0};
    await scan(root,legacy,true); rows.push(legacy);
    for (const item of await fs.readdir(root,{withFileTypes:true})) {
      if (!item.isDirectory() || !isProjectDir(item.name)) continue;
      const dir = path.join(root,item.name);
      const row = {name:item.name,files:0,bytes:0,protected:true,errors:0};
      try {row.protected = await protectedProject(dir); await scan(dir,row);} catch(e){row.errors++;}
      rows.push(row);
    }
    return rows;
  }
  async function run(mode) {
    if (running) throw new Error("Cleanup already running");
    running = (async()=>{
      const config = await store.read();
      const dryRun = mode === "preview" || config.dryRun;
      const record = {time:new Date().toISOString(),mode,dryRun,files:0,dirs:0,candidates:0,errors:0,sample:[]};
      const options = {dryRun,maxBytes:config.maxBytes,maxFiles:config.maxFiles,report(error,target){
        if(error){record.errors++;console.warn("[temp-sanitize]",error.message,target);}
        else {record.candidates++;if(record.sample.length<100)record.sample.push(path.relative(root,target));}
      }};
      const age = config.retentionDays*86400000;
      const total = await sweepProjects(root,Date.now(),age,options);
      record.files=total.files;record.dirs=total.dirs;
      // Never delete unowned root files automatically from a running server.
      if(config.legacy && dryRun) await sweepDir(root,Date.now(),age,{...options,flat:true});
      history.unshift(record); if(history.length>50)history.pop();
      return record;
    })();
    try{return await running;}finally{running=undefined;}
  }
  async function tick(){
    try{
      const config=await store.read();
      if(config.enabled && !running && Date.now()-last>=config.intervalMinutes*60000){
        last=Date.now();await run("automatic");
      }
    }catch(e){console.warn("[temp-sanitize] cleanup",e.message);}
    finally{if(!stopped){timer=setTimeout(tick,15000);timer.unref();}}
  }
  timer=setTimeout(tick,0);timer.unref();
  return {settings:()=>store.read(),save:v=>store.write(v),analyze,preview:()=>run("preview"),clean:v=>{if(v.confirmed!==true)throw new Error("Confirmation required");return run("manual");},history:()=>history.slice(),async stop(){stopped=true;clearTimeout(timer);await running?.catch(()=>{});}};
}
