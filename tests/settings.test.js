import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {describe,it,expect,vi} from "vitest";
import {defaults,validate,migrate,settingsStore,pruneSettingsTemps} from "../src/settings.js";
describe("settings",()=>{
  it("rejects invalid values",()=>{
    expect(()=>validate({...defaults,retentionDays:0})).toThrow();
    expect(()=>validate({...defaults,enabled:"false"})).toThrow();
    expect(()=>validate({...defaults,showIndicator:"true"})).toThrow();
    expect(()=>validate({...defaults,intervalMinutes:1441})).toThrow();
  });
  it("migrates old dry-run policies without activating deletion",()=>{
    expect(migrate({...defaults,enabled:true,dryRun:true})).toEqual(defaults);
    expect(migrate({...defaults,enabled:true,dryRun:false}).enabled).toBe(true);
    expect(()=>migrate({...defaults,dryRun:"false"})).toThrow();
    const {showIndicator,...old}=defaults;
    expect(migrate(old).showIndicator).toBe(true);
    expect(migrate({...old,showIndicator:false}).showIndicator).toBe(false);
    expect(migrate(old).enabled).toBe(false);
  });
  it("reclaims dead-writer settings debris only",async()=>{
    const dir=await fs.mkdtemp(path.join(os.tmpdir(),"sanitize-settings-debris-"));
    const uuid="12345678-1234-1234-1234-123456789abc";
    const names=["settings.json.987654."+uuid,"settings.json."+process.pid+"."+uuid,"unrelated.json."+uuid,"settings.json."+uuid];
    const kill=process.kill.bind(process);
    const spy=vi.spyOn(process,"kill").mockImplementation((pid,signal)=>{
      if(pid===987654)throw Object.assign(new Error("dead"),{code:"ESRCH"});
      return kill(pid,signal);
    });
    try{
      for(const name of names)await fs.writeFile(path.join(dir,name),"{}");
      await pruneSettingsTemps(dir);
      expect((await fs.readdir(dir)).sort()).toEqual(names.slice(1).sort());
    }finally{spy.mockRestore();await fs.rm(dir,{recursive:true,force:true});}
  });
  it("persists validated settings",async()=>{
    const dir=await fs.mkdtemp(path.join(os.tmpdir(),"sanitize-settings-"));
    try {
      const store=settingsStore(dir);
      expect(await store.read()).toEqual(defaults);
      expect((await store.read()).enabled).toBe(false);
      expect((await store.read()).showIndicator).toBe(true);
      await store.write({...defaults,retentionDays:14,showIndicator:false});
      expect((await settingsStore(dir).read()).showIndicator).toBe(false);
      expect((await settingsStore(dir).read()).retentionDays).toBe(14);
    } finally {await fs.rm(dir,{recursive:true,force:true});}
  });
});
