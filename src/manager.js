import path from "node:path";
import {randomUUID} from "node:crypto";
import {sweepDir,sweepProjects} from "./sweep.js";
import {analyzeStorage} from "./storage-scan.js";
import {settingsStore,validate} from "./settings.js";
import {candidatePage,selectionEntries,deleteCandidate,identity,samePolicy} from "./candidates.js";

const managers=new Map();
export function acquireManager(root,configDir){
  let entry=managers.get(root);
  if(!entry){entry={manager:createManager(root,configDir),refs:0};managers.set(root,entry);}
  entry.refs++;
  return {manager:entry.manager,async release(){if(--entry.refs===0){managers.delete(root);await entry.manager.stop();}}};
}
export function createManager(root,configDir,{clock=Date.now,schedule=true}={}){
  const store=settingsStore(configDir);
  let running,stopped=false,timer,last=-Infinity,snapshot;
  const history=[];
  const makeRecord=(mode,dryRun)=>({time:new Date(clock()).toISOString(),mode,dryRun,files:0,dirs:0,candidates:0,errors:0,sample:[]});
  function remember(record){history.unshift(record);if(history.length>50)history.pop();}
  function summary(){
    return snapshot?{id:snapshot.id,time:snapshot.time,count:snapshot.entries.length,bytes:snapshot.bytes,errors:snapshot.errors,legacyCount:snapshot.legacyCount,retentionDays:snapshot.policy.retentionDays}:
      {id:"",time:"",count:0,bytes:0,errors:0,legacyCount:0,retentionDays:0};
  }
  async function exclusive(fn){
    if(running)throw new Error("Cleanup already running");
    running=Promise.resolve().then(fn);
    try{return await running;}finally{running=undefined;}
  }
  async function perform(mode,config){
    const dryRun=mode==="preview";
    const record=makeRecord(mode,dryRun);
    const entries=[];
    let bytes=0,legacyCount=0;
    const age=config.retentionDays*86400000;
    const now=clock();
    const options={dryRun,maxBytes:config.maxBytes,maxFiles:config.maxFiles,report(error,target,stat){
      if(error){record.errors++;console.warn("[temp-sanitize]",error.message,target);return;}
      if(!dryRun||!stat)return;
      const relative=path.relative(root,target);
      // Root files can be reported, but cannot become selectable deletion targets.
      if(path.dirname(relative)==="."){legacyCount++;return;}
      entries.push({path:relative,...identity(stat)});
      bytes+=stat.size;
    }};
    if(!dryRun)snapshot=undefined;
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
      const record=await perform(actual,config);
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
      const record=makeRecord("manual",false);
      record.candidates=entries.length;
      for(const entry of entries){
        try{if(await deleteCandidate(root,entry,saved,clock()))record.files++;else record.errors++;}
        catch(error){record.errors++;console.warn("[temp-sanitize] selected cleanup",error.message);}
      }
      const attempted=new Set(input.ids);
      const remaining=old.entries.filter((_,i)=>!attempted.has(i));
      snapshot={...old,id:randomUUID(),entries:remaining,bytes:remaining.reduce((sum,e)=>sum+e.size,0),errors:old.errors+record.errors};
      remember(record);
      return record;
    });
  }
  async function tick(){
    try{
      const config=await store.read();
      if(!running&&clock()-last>=config.intervalMinutes*60000){
        last=clock();
        await run("scheduled");
      }
    }catch(e){console.warn("[temp-sanitize] cleanup",e.message);}
    finally{if(schedule&&!stopped){timer=setTimeout(tick,15000);timer.unref();}}
  }
  if(schedule){timer=setTimeout(tick,0);timer.unref();}
  return {
    settings:()=>store.read(),save,analyze:()=>analyzeStorage(root),preview:v=>run("preview",v),
    candidates:summary,candidatePage:v=>candidatePage(snapshot,v),cleanSelected,
    clean:v=>{if(v.confirmed!==true)throw new Error("Confirmation required");return run("manual");},
    history:()=>history.slice(),tick,
    async stop(){stopped=true;clearTimeout(timer);await running?.catch(()=>{});snapshot=undefined;}
  };
}
