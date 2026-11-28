import path from "node:path";
import {randomUUID} from "node:crypto";
import {sweepDir,sweepProjects} from "./sweep.js";
import {analyzeStorage} from "./storage-scan.js";
import {settingsStore,validate,pruneSettingsTemps} from "./settings.js";
import {PAGE_SIZE,candidatePage,selectionEntries,deleteCandidate,extendCandidate,identity,samePolicy} from "./candidates.js";

const managers=new Map();
export function acquireManager(root,configDir){
  let entry=managers.get(root);
  if(!entry){entry={manager:createManager(root,configDir),refs:0};managers.set(root,entry);}
  entry.refs++;
  return {manager:entry.manager,async release(){if(--entry.refs===0){managers.delete(root);await entry.manager.stop();}}};
}
export function createManager(root,configDir,{clock=Date.now,schedule=true}={}){
  const store=settingsStore(configDir);
  let running,stopped=false,timer,last=-Infinity,snapshot,inventory,lastTickWarning=-Infinity;
  const history=[];
  const makeRecord=(mode,dryRun)=>({time:new Date(clock()).toISOString(),mode,dryRun,files:0,dirs:0,candidates:0,errors:0,sample:[]});
  function remember(record){history.unshift(record);if(history.length>50)history.pop();}
  async function summary(){
    const saved=await store.read();
    const current=snapshot;
    return current?{id:current.id,time:current.time,count:current.entries.length,bytes:current.bytes,errors:current.errors,legacyCount:current.legacyCount,retentionDays:current.policy.retentionDays,matchesSaved:samePolicy(current.policy,saved)}:
      {id:"",time:"",count:0,bytes:0,errors:0,legacyCount:0,retentionDays:0,matchesSaved:false};
  }
  async function indicator(){
    const saved=await store.read();
    const current=snapshot;
    const visible=!!(saved.showIndicator&&!saved.enabled&&current&&samePolicy(current.policy,saved)&&current.entries.length);
    return {visible,count:visible?current.entries.length:0,bytes:visible?current.bytes:0};
  }
  async function exclusive(fn){
    if(running)throw new Error("Cleanup already running");
    running=Promise.resolve().then(fn);
    try{return await running;}finally{running=undefined;}
  }
  async function analyze(){
    return exclusive(async()=>{
      inventory=undefined;
      const rows=await analyzeStorage(root);
      const totals=rows.reduce((sum,row)=>({files:sum.files+row.files,bytes:sum.bytes+row.bytes,errors:sum.errors+row.errors}),{files:0,bytes:0,errors:0});
      const summary={id:randomUUID(),time:new Date(clock()).toISOString(),count:rows.length,...totals};
      inventory={summary,rows};
      return summary;
    });
  }
  function storageSummary(){return inventory?.summary??{id:"",time:"",count:0,files:0,bytes:0,errors:0};}
  function storagePage({snapshotId,offset}){
    if(!inventory||inventory.summary.id!==snapshotId)throw new Error("Storage scan changed; analyze again");
    if(!Number.isSafeInteger(offset)||offset<0)throw new Error("Invalid offset");
    return {snapshotId,offset,items:inventory.rows.slice(offset,offset+PAGE_SIZE)};
  }
  async function perform(mode,config,maintenance=false){
    const dryRun=mode==="preview";
    if(!dryRun)inventory=undefined;
    const record=makeRecord(mode,dryRun);
    const entries=[];
    let bytes=0,legacyCount=0;
    const age=config.retentionDays*86400000;
    const now=clock();
    const options={dryRun,maintenance,maxBytes:config.maxBytes,maxFiles:config.maxFiles,report(error,target,stat){
      if(error){record.errors++;return;}
      if(!dryRun||!stat)return;
      const relative=path.relative(root,target);
      // Root files can be reported, but cannot become selectable deletion targets.
      if(path.dirname(relative)==="."){legacyCount++;return;}
      entries.push({path:relative,...identity(stat)});
      bytes+=stat.size;
    }};
    // Release the previous snapshot before constructing a replacement. No historical file lists.
    snapshot=undefined;
    const total=await sweepProjects(root,now,age,options);
    record.files=total.files;record.dirs=total.dirs;
    if(dryRun){
      if(config.legacy)await sweepDir(root,now,age,{...options,flat:true});
      record.candidates=entries.length;
      snapshot={id:randomUUID(),time:record.time,policy:config,entries,bytes,errors:record.errors,legacyCount};
    }
    return record;
  }
  async function run(mode,previewPolicy){
    return exclusive(async()=>{
      const saved=await store.read();
      const config=mode==="preview"?validate(previewPolicy):saved;
      const actual=mode==="scheduled"?(saved.enabled?"automatic":"preview"):mode;
      if(mode==="scheduled")await pruneSettingsTemps(configDir).catch(()=>{});
      const record=await perform(actual,config,mode==="scheduled");
      if(mode!=="preview"||samePolicy(config,saved))remember(record);
      return record;
    });
  }
  async function save(value){
    return exclusive(async()=>{
      const policy=await store.write(value);
      if(snapshot&&!samePolicy(snapshot.policy,policy))snapshot=undefined;
      return policy;
    });
  }
  async function cleanSelected(input){
    if(input.confirmed!==true)throw new Error("Confirmation required");
    return exclusive(async()=>{
      const saved=await store.read();
      if(!snapshot||!samePolicy(snapshot.policy,saved))throw new Error("Candidate policy changed; save settings and refresh");
      const entries=selectionEntries(snapshot,input);
      const old=snapshot;
      inventory=undefined;
      const record=makeRecord("manual",false);
      record.candidates=entries.length;
      for(const entry of entries){
        try{if(await deleteCandidate(root,entry,saved,clock()))record.files++;else record.errors++;}
        catch(error){record.errors++;}
      }
      const attempted=new Set(input.ids);
      const remaining=old.entries.filter((_,i)=>!attempted.has(i));
      snapshot={...old,id:randomUUID(),entries:remaining,bytes:remaining.reduce((sum,e)=>sum+e.size,0),errors:old.errors+record.errors};
      remember(record);
      return record;
    });
  }
  async function extendSelected(input){
    return exclusive(async()=>{
      const saved=await store.read();
      if(!snapshot||!samePolicy(snapshot.policy,saved))throw new Error("Candidate policy changed; save settings and refresh");
      const entries=selectionEntries(snapshot,input);
      const old=snapshot,successful=new Set();
      let errors=0;
      for(let i=0;i<entries.length;i++){
        try{if(await extendCandidate(root,entries[i],saved,clock()))successful.add(input.ids[i]);else errors++;}
        catch{errors++;}
      }
      // Keep failures visible. Rotate snapshot IDs to prevent stale selection.
      const remaining=old.entries.filter((_,i)=>!successful.has(i));
      snapshot={...old,id:randomUUID(),entries:remaining,bytes:remaining.reduce((sum,e)=>sum+e.size,0),errors:old.errors+errors};
      return {extended:successful.size,errors};
    });
  }
  async function tick(){
    try{
      const config=await store.read();
      if(!running&&clock()-last>=config.intervalMinutes*60000){
        last=clock();
        await run("scheduled");
      }
    }catch(e){if(clock()-lastTickWarning>=3600000){lastTickWarning=clock();console.warn("[temp-sanitize] scheduled operation failed:",e.message);}}
    finally{if(schedule&&!stopped){timer=setTimeout(tick,15000);timer.unref();}}
  }
  if(schedule){timer=setTimeout(tick,0);timer.unref();}
  return {
    settings:()=>store.read(),save,analyze,storageSummary,storagePage,preview:v=>run("preview",v),
    candidates:summary,indicator,candidatePage:v=>candidatePage(snapshot,v),cleanSelected,extendSelected,
    clean:v=>{if(v.confirmed!==true)throw new Error("Confirmation required");return run("manual");},
    history:()=>history.slice(),tick,
    async stop(){stopped=true;clearTimeout(timer);await running?.catch(()=>{});snapshot=undefined;inventory=undefined;history.length=0;}
  };
}
