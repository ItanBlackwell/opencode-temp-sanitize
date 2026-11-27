import fs from "node:fs/promises";
import path from "node:path";
import {sweepDir, sweepProjects} from "./sweep.js";
import {analyzeStorage} from "./storage-scan.js";
import {settingsStore,validate} from "./settings.js";

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
  const analyze=()=>analyzeStorage(root);
  async function run(mode, previewPolicy) {
    if (running) throw new Error("Cleanup already running");
    running = (async()=>{
      const saved = await store.read();
      const config = mode === "preview" ? validate(previewPolicy) : saved;
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
      // Unsaved simulations are local to the requesting UI, not scheduled-cleanup history.
      if(mode !== "preview" || JSON.stringify(config) === JSON.stringify(saved)) {
        history.unshift(record); if(history.length>50)history.pop();
      }
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
  return {settings:()=>store.read(),save:v=>store.write(v),analyze,preview:v=>run("preview",v),clean:v=>{if(v.confirmed!==true)throw new Error("Confirmation required");return run("manual");},history:()=>history.slice(),async stop(){stopped=true;clearTimeout(timer);await running?.catch(()=>{});}};
}
