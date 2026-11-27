import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {beforeEach,afterEach,describe,it,expect} from "vitest";
import {createManager} from "../src/manager.js";
import {defaults} from "../src/settings.js";

let sandbox,root,manager,now;
beforeEach(async()=>{
  sandbox=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),"sanitize-candidates-")));
  root=path.join(sandbox,"opencode");
  await fs.mkdir(root);
  now=Date.now();
  manager=createManager(root,path.join(sandbox,"config"),{clock:()=>now,schedule:false});
  await manager.save({...defaults,retentionDays:1,intervalMinutes:1});
});
afterEach(async()=>{await manager?.stop();await fs.rm(sandbox,{recursive:true,force:true});});
async function oldFile(relative,bytes=32){
  const target=path.join(root,relative);
  await fs.mkdir(path.dirname(target),{recursive:true});
  await fs.writeFile(target,Buffer.alloc(bytes));
  const old=new Date(now-3*86400000);
  await fs.utimes(target,old,old);
  return target;
}
const exists=async file=>fs.stat(file).then(()=>true,e=>e.code==="ENOENT"?false:Promise.reject(e));
describe("scheduled and selective cleanup",()=>{
  it("scans on schedule when disabled, never deleting until explicit cleanup or enabled schedule",async()=>{
    const file=await oldFile("project-1234abcd/a.bin");
    await manager.tick();
    const first=await manager.candidates();
    expect(first).toMatchObject({count:1,bytes:32,matchesSaved:true});
    expect(await exists(file)).toBe(true);
    now+=30000;await manager.tick();
    expect((await manager.candidates()).id).toBe(first.id);
    now+=30000;await manager.tick();
    expect((await manager.candidates()).id).not.toBe(first.id);
    expect(await exists(file)).toBe(true);
    await manager.save({...await manager.settings(),enabled:true});
    now+=60000;await manager.tick();
    expect(await exists(file)).toBe(false);
  });
  it("returns bounded pages and deletes only selected unchanged files",async()=>{
    for(let i=0;i<53;i++)await oldFile("project-1234abcd/"+String(i).padStart(2,"0")+".bin");
    const protectedFile=await oldFile("global/keep.bin");
    await oldFile("global/.sanitize-lease-"+process.pid+"-abcd",0);
    const upload=await oldFile("project-1234abcd/uploads/keep.bin");
    const legacy=await oldFile("legacy/keep.bin");
    await manager.tick();
    const summary=await manager.candidates();
    expect(summary.count).toBe(53);
    const a=manager.candidatePage({snapshotId:summary.id,offset:0});
    const b=manager.candidatePage({snapshotId:summary.id,offset:50});
    expect(a.items.length).toBe(50);expect(b.items.length).toBe(3);
    const chosen=[a.items[0],b.items[0]];
    const result=await manager.cleanSelected({confirmed:true,snapshotId:summary.id,ids:chosen.map(x=>x.id)});
    expect(result.files).toBe(2);
    for(const entry of chosen)expect(await exists(path.join(root,entry.path))).toBe(false);
    expect(await exists(path.join(root,a.items[1].path))).toBe(true);
    for(const target of [protectedFile,upload,legacy])expect(await exists(target)).toBe(true);
    expect((await manager.candidates()).count).toBe(51);
    await expect(manager.cleanSelected({confirmed:true,snapshotId:summary.id,ids:[1]})).rejects.toThrow();
  });
  it("refuses changed, newly protected, invalid and unconfirmed targets",async()=>{
    const changed=await oldFile("project-1234abcd/a.bin");
    const leased=await oldFile("project-abcdef12/b.bin");
    await manager.tick();
    const summary=await manager.candidates();
    const page=manager.candidatePage({snapshotId:summary.id,offset:0});
    await fs.writeFile(changed,Buffer.alloc(40));
    await oldFile("project-abcdef12/.sanitize-lease-"+process.pid+"-abcd",0);
    await expect(manager.cleanSelected({confirmed:false,snapshotId:summary.id,ids:[0]})).rejects.toThrow();
    await expect(manager.cleanSelected({confirmed:true,snapshotId:summary.id,ids:[999]})).rejects.toThrow();
    await expect(manager.cleanSelected({confirmed:true,snapshotId:summary.id,ids:[0,0]})).rejects.toThrow();
    const result=await manager.cleanSelected({confirmed:true,snapshotId:summary.id,ids:page.items.map(x=>x.id)});
    expect(result).toMatchObject({files:0,errors:2});
    expect(await exists(changed)).toBe(true);expect(await exists(leased)).toBe(true);
  });
  it("does not delete from a draft preview until its policy is saved",async()=>{
    const target=await oldFile("project-1234abcd/a.bin");
    const saved={...await manager.settings(),retentionDays:7};
    await manager.save(saved);
    const draft={...saved,retentionDays:1};
    await manager.preview(draft);
    const summary=await manager.candidates();
    expect(summary).toMatchObject({count:1,matchesSaved:false});
    await expect(manager.cleanSelected({confirmed:true,snapshotId:summary.id,ids:[0]})).rejects.toThrow();
    expect(await manager.settings()).toEqual(saved);
    expect(await exists(target)).toBe(true);
    await manager.save(draft);
    expect((await manager.candidates()).matchesSaved).toBe(true);
    expect((await manager.cleanSelected({confirmed:true,snapshotId:summary.id,ids:[0]})).files).toBe(1);
  });
  it("keeps root files only in read-only legacy count",async()=>{
    const target=await oldFile("old.bin");
    const policy={...await manager.settings(),legacy:true};
    await manager.save(policy);
    await manager.tick();
    const summary=await manager.candidates();
    expect(summary).toMatchObject({count:0,legacyCount:1});
    await expect(manager.cleanSelected({confirmed:true,snapshotId:summary.id,ids:[0]})).rejects.toThrow();
    expect(await exists(target)).toBe(true);
  });
});
