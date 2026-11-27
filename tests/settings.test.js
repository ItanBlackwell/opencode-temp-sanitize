import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {describe,it,expect} from "vitest";
import {defaults,validate,settingsStore} from "../src/settings.js";
describe("settings",()=>{
  it("rejects invalid values",()=>{
    expect(()=>validate({...defaults,retentionDays:0})).toThrow();
    expect(()=>validate({...defaults,dryRun:"false"})).toThrow();
    expect(()=>validate({...defaults,intervalMinutes:1441})).toThrow();
  });
  it("persists validated settings",async()=>{
    const dir=await fs.mkdtemp(path.join(os.tmpdir(),"sanitize-settings-"));
    try {
      const store=settingsStore(dir);
      expect(await store.read()).toEqual(defaults);
      await store.write({...defaults,retentionDays:14});
      expect((await settingsStore(dir).read()).retentionDays).toBe(14);
    } finally {await fs.rm(dir,{recursive:true,force:true});}
  });
});
