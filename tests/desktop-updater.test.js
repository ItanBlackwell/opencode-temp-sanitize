import {describe,it,expect,vi} from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {newer,selectRelease,pruneUpdaterTemps} from "../src/desktop-updater.js";
describe("desktop updater release validation",()=>{
  const base="https://github.com/ItanBlackwell/opencode-temp-sanitize/releases/download/v0.3.2/";
  const asset=name=>({name,state:"uploaded",browser_download_url:base+name,size:100});
  const release={draft:false,prerelease:false,tag_name:"v0.3.2",assets:[asset("Temp-Sanitize-Portable-0.3.2.zip"),asset("SHA256SUMS.txt")]};
  it("accepts newer stable releases only",()=>{
    expect(newer("0.3.2","0.3.1")).toBe(true);
    expect(newer("0.3.1","0.3.1")).toBe(false);
    expect(newer("0.3.2-rc.1","0.3.1")).toBe(false);
    expect(selectRelease(release,"0.3.1")).toBe("0.3.2");
    expect(selectRelease({...release,prerelease:true},"0.3.1")).toBeNull();
  });
  it("rejects missing, duplicate, redirected and oversized assets",()=>{
    expect(()=>selectRelease({...release,assets:[]},"0.3.1")).toThrow();
    expect(()=>selectRelease({...release,assets:[...release.assets,release.assets[0]]},"0.3.1")).toThrow();
    expect(()=>selectRelease({...release,assets:[{...release.assets[0],browser_download_url:"https://other.invalid/test.zip"},release.assets[1]]},"0.3.1")).toThrow();
    expect(()=>selectRelease({...release,assets:[{...release.assets[0],size:200*1024*1024},release.assets[1]]},"0.3.1")).toThrow();
  });
});

it("cleans only orphaned update-mode writes with known dead owners",()=>{
  const dir=fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(),"sanitize-updater-debris-")));
  const uuid="12345678-1234-1234-1234-123456789abc";
  const names=["update-mode.json.987654."+uuid+".tmp","update-mode.json."+process.pid+"."+uuid+".tmp","update-mode.json."+uuid+".tmp","unrelated.txt"];
  const kill=process.kill.bind(process);
  const spy=vi.spyOn(process,"kill").mockImplementation((pid,signal)=>{
    if(pid===987654)throw Object.assign(new Error("dead"),{code:"ESRCH"});
    return kill(pid,signal);
  });
  try{
    for(const name of names)fs.writeFileSync(path.join(dir,name),"{}");
    pruneUpdaterTemps(path.join(dir,"update-mode.json"));
    expect(fs.readdirSync(dir).sort()).toEqual(names.slice(1).sort());
  }finally{spy.mockRestore();fs.rmSync(dir,{recursive:true,force:true});}
});
