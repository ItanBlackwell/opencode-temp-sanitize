// Desktop main process only. The renderer receives status, not paths or payloads.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";

const API = "https://api.github.com/repos/ItanBlackwell/opencode-temp-sanitize/releases/latest";
const REPO = "https://github.com/ItanBlackwell/opencode-temp-sanitize/releases/download/";
const modes = ["notify", "auto", "manual"];
const DAY = 86400000;
const version = (value) => typeof value === "string" && /^(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})$/.test(value);
export function newer(a,b) {
  if(!version(a)||!version(b))return false;
  const x=a.split(".").map(Number),y=b.split(".").map(Number);
  for(let i=0;i<3;i++)if(x[i]!==y[i])return x[i]>y[i];
  return false;
}
export function selectRelease(data,current) {
  if(data?.draft!==false||data.prerelease!==false||typeof data.tag_name!=="string"||!data.tag_name.startsWith("v"))return null;
  const next=data.tag_name.slice(1);
  if(!newer(next,current))return null;
  const assets=Array.isArray(data.assets)?data.assets:[];
  for(const name of ["Temp-Sanitize-Portable-"+next+".zip","SHA256SUMS.txt"]){
    const found=assets.filter(a=>a?.name===name&&a.state==="uploaded"&&a.browser_download_url===REPO+"v"+next+"/"+name);
    if(found.length!==1||!Number.isSafeInteger(found[0].size)||found[0].size<1||found[0].size>100*1024*1024)throw new Error("Missing or invalid release assets");
  }
  return next;
}
function assertSafe(target){
  let cursor=path.resolve(target);
  while(true){
    try{if(fs.lstatSync(cursor).isSymbolicLink())throw new Error("Redirected path");}
    catch(e){if(e.code!=="ENOENT")throw e;}
    const parent=path.dirname(cursor);if(parent===cursor)break;cursor=parent;
  }
}
export function createUpdater(current) {
  let mode="notify",state="unavailable",next=null,checkedAt=0,busy=null,timer,stopped=false;
  let root,folder,manifest,script,settings;
  const status=()=>({mode,state,version:next,checkedAt});
  function installed(){
    assertSafe(manifest);
    const p=JSON.parse(fs.readFileSync(manifest,"utf8"));
    if(p.name!=="@gfn-cis/opencode-temp-sanitize"||!version(p.version))throw new Error("Invalid installed package");
    return p.version;
  }
  try{
    if(process.platform!=="win32"||!version(current))throw new Error("Unsupported platform");
    const configured=process.env.OPENCODE_CONFIG_DIR;
    if(configured&&!path.isAbsolute(configured))throw new Error("Invalid config directory");
    root=configured||path.join(os.homedir(),".config","opencode");
    folder=path.join(root,"plugins","opencode-temp-sanitize");
    manifest=path.join(folder,"package.json");
    script=path.join(folder,"installer","Update.ps1");
    settings=path.join(root,".temp-sanitize-install","update-mode.json");
    assertSafe(script);assertSafe(path.join(folder,"installer","Common.ps1"));assertSafe(settings);
    if(!fs.lstatSync(script).isFile()||!fs.lstatSync(path.join(folder,"installer","Common.ps1")).isFile())throw new Error("Portable installer required");
    const v=installed();
    if(v!==current){next=v;state="restart";}
    else{
      try{const saved=JSON.parse(fs.readFileSync(settings,"utf8"));if(modes.includes(saved.mode))mode=saved.mode;}catch(e){if(e.code!=="ENOENT")throw e;}
      state="idle";
    }
  }catch{state="unavailable";}
  function run(task){
    if(stopped||state==="unavailable"||state==="restart")return Promise.resolve(status());
    if(busy)return busy.then(status);
    busy=Promise.resolve().then(task).catch(()=>{state="error";}).finally(()=>{busy=null;});
    return busy.then(status);
  }
  async function install(){
    if(!next||!newer(next,current)||stopped)return;
    if(installed()!==current)throw new Error("Installed version changed");
    state="installing";
    const system=process.env.SystemRoot;
    if(!system||!path.isAbsolute(system))throw new Error("Missing system root");
    assertSafe(script);
    // Invoke the already installed, trusted script, never a script from the ZIP.
    await new Promise((resolve,reject)=>execFile(
      path.join(system,"System32","WindowsPowerShell","v1.0","powershell.exe"),
      ["-NoProfile","-NonInteractive","-ExecutionPolicy","Bypass","-File",script,"-NonInteractive","-ExpectedVersion",next],
      {windowsHide:true,timeout:180000,maxBuffer:256*1024,env:{...process.env,OPENCODE_CONFIG_DIR:root}},
      (error)=>error?reject(error):resolve()
    ));
    if(installed()!==next)throw new Error("Update did not commit");
    state="restart";
  }
  function check(force=false){
    if(!force&&(mode==="manual"||Date.now()-checkedAt<DAY))return Promise.resolve(status());
    return run(async()=>{
      if(installed()!==current){next=installed();state="restart";return;}
      state="checking";next=null;
      try{
        const response=await fetch(API,{redirect:"error",credentials:"omit",signal:AbortSignal.timeout(20000),headers:{"User-Agent":"Temp-Sanitize-Updater","Accept":"application/vnd.github+json"}});
        if(!response.ok)throw new Error("Release check failed");
        const raw=await response.text();if(raw.length>1024*1024)throw new Error("Invalid release response");
        next=selectRelease(JSON.parse(raw),current);
        state=next?"available":"current";
        if(next&&mode==="auto")await install();
      }finally{checkedAt=Date.now();}
    });
  }
  function setMode(value){
    if(!modes.includes(value)||busy||stopped||["unavailable","restart"].includes(state))return Promise.resolve(status());
    try{
      assertSafe(settings);
      fs.mkdirSync(path.dirname(settings),{recursive:true});
      const tmp=settings+"."+randomUUID()+".tmp";
      try{fs.writeFileSync(tmp,JSON.stringify({mode:value}),{flag:"wx",mode:0o600});fs.renameSync(tmp,settings);}
      finally{if(fs.existsSync(tmp))fs.unlinkSync(tmp);}
      mode=value;
    }catch{state="error";return Promise.resolve(status());}
    if(mode==="auto"&&next)return run(install);
    if(mode!=="manual"&&!checkedAt)return check();
    return Promise.resolve(status());
  }
  return {status,check:()=>check(true),install:()=>run(install),setMode,
    start(){if(stopped||timer||["unavailable","restart"].includes(state))return;void check();timer=setInterval(()=>void check(),DAY);timer.unref?.();},
    stop(){stopped=true;clearInterval(timer);timer=null;}};
}
