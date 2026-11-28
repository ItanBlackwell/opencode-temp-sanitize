import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {beforeEach,afterEach,describe,it,expect,vi} from "vitest";
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
  it("shows only saved eligible candidates when the indicator is enabled and auto cleanup is off",async()=>{
    const hidden={visible:false,count:0,bytes:0};
    expect(await manager.indicator()).toEqual(hidden);
    const target=await oldFile("project-1234abcd/indicator.bin",42);
    await manager.tick();
    const before=await manager.candidates();
    expect(await manager.indicator()).toEqual({visible:true,count:1,bytes:42});
    const policy=await manager.settings();
    await manager.save({...policy,showIndicator:false});
    expect(await manager.indicator()).toEqual(hidden);
    expect((await manager.candidates()).id).toBe(before.id);
    await manager.save(policy);
    expect(await manager.indicator()).toEqual({visible:true,count:1,bytes:42});
    await manager.preview({...policy,retentionDays:2});
    expect(await manager.indicator()).toEqual(hidden);
    await manager.preview(policy);
    const ready=await manager.candidates();
    await manager.cleanSelected({confirmed:true,snapshotId:ready.id,ids:[0]});
    expect(await manager.indicator()).toEqual(hidden);
    expect(await exists(target)).toBe(false);
    await oldFile("project-1234abcd/next.bin");
    await manager.save({...policy,enabled:true});
    await manager.preview({...policy,enabled:true});
    expect(await manager.indicator()).toEqual(hidden);
  });
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
  it("keeps at most 50 summaries and reclaims only dead empty lease markers on scheduled scans",async()=>{
    const uuid="12345678-1234-1234-1234-123456789abc";
    const dead=await oldFile("project-1234abcd/.sanitize-lease-987654-"+uuid,0);
    const live=await oldFile("global/.sanitize-lease-"+process.pid+"-"+uuid,0);
    const unknown=await oldFile("project-1234abcd/.sanitize-lease-987654-abcd",0);
    const data=await oldFile("project-1234abcd/keep.bin");
    const kill=process.kill.bind(process);
    const spy=vi.spyOn(process,"kill").mockImplementation((pid,signal)=>{
      if(pid===987654)throw Object.assign(new Error("dead"),{code:"ESRCH"});
      return kill(pid,signal);
    });
    try{
      await manager.preview(await manager.settings());
      expect(await exists(dead)).toBe(true);
      for(let i=0;i<55;i++){now+=60000;await manager.tick();}
      expect(await exists(dead)).toBe(false);
      expect(await exists(live)).toBe(true);
      expect(await exists(unknown)).toBe(true);
      expect(await exists(data)).toBe(true);
      expect(manager.history().length).toBe(50);
      expect((await manager.candidates()).count).toBe(1);
      expect(manager.history().every(record=>record.sample.length===0)).toBe(true);
    }finally{spy.mockRestore();}
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

describe("retention renewal",()=>{
  async function ready(){
    await manager.preview(await manager.settings());
    const summary=await manager.candidates();
    return {summary,items:manager.candidatePage({snapshotId:summary.id,offset:0}).items};
  }
  it("renews selected access times without changing content, mtime or storage totals, including after restart",async()=>{
    const a=await oldFile("project-1234abcd/a.bin",32);
    const b=await oldFile("project-1234abcd/b.bin",64);
    const before=await fs.stat(a);
    const overview=await manager.analyze();
    const {summary,items}=await ready();
    const chosen=items.find(x=>x.path.endsWith("a.bin"));
    expect(chosen.canExtend).toBe(true);
    expect(new Date(chosen.lastUsedAt).getTime()).toBeLessThan(now-86400000);
    expect(await manager.extendSelected({snapshotId:summary.id,ids:[chosen.id]})).toEqual({extended:1,errors:0});
    const after=await fs.stat(a);
    expect(Math.abs(after.atimeMs-now)).toBeLessThan(2000);
    expect(Math.abs(after.mtimeMs-before.mtimeMs)).toBeLessThan(2);
    expect(after.size).toBe(before.size);
    expect(await manager.indicator()).toEqual({visible:true,count:1,bytes:64});
    expect(manager.storageSummary()).toEqual(overview);
    await expect(manager.extendSelected({snapshotId:summary.id,ids:[chosen.id]})).rejects.toThrow();
    await expect(manager.cleanSelected({confirmed:true,snapshotId:summary.id,ids:[chosen.id]})).rejects.toThrow();
    await manager.stop();
    manager=createManager(root,path.join(sandbox,"config"),{clock:()=>now,schedule:false});
    expect((await ready()).items.map(x=>x.path)).toEqual([path.relative(root,b)]);
    expect(await fs.readFile(a)).toEqual(Buffer.alloc(32));
    now+=2*86400000;
    expect((await ready()).items.length).toBe(2);
  });
  it("supports multiple IDs and clears the indicator after the final renewal",async()=>{
    await oldFile("global/a.bin",10);
    await oldFile("global/b.bin",20);
    const {summary,items}=await ready();
    expect(await manager.extendSelected({snapshotId:summary.id,ids:items.map(x=>x.id)})).toEqual({extended:2,errors:0});
    expect((await manager.candidates())).toMatchObject({count:0,bytes:0});
    expect(await manager.indicator()).toEqual({visible:false,count:0,bytes:0});
    expect((await ready()).summary.count).toBe(0);
  });
  it("rejects unsaved policy, invalid IDs and duplicate IDs",async()=>{
    await oldFile("global/a.bin");
    const saved=await manager.settings();
    await manager.preview({...saved,retentionDays:2});
    let s=await manager.candidates();
    await expect(manager.extendSelected({snapshotId:s.id,ids:[0]})).rejects.toThrow();
    s=(await ready()).summary;
    for(const ids of [[],[999],[0,0],[-1],[0.5]])await expect(manager.extendSelected({snapshotId:s.id,ids})).rejects.toThrow();
    expect((await manager.candidates()).count).toBe(1);
  });
  it("keeps failures in the candidate list and skips changed, hard-linked and newly leased files",async()=>{
    const changed=await oldFile("project-1234abcd/changed.bin");
    const linked=await oldFile("project-1234abcd/linked.bin");
    const leased=await oldFile("project-abcdef12/leased.bin");
    const ok=await oldFile("global/ok.bin");
    const outside=path.join(sandbox,"outside.bin");
    await fs.link(linked,outside);
    const linkedBefore=await fs.stat(outside);
    const {summary,items}=await ready();
    expect(items.find(x=>x.path.endsWith("linked.bin")).canExtend).toBe(false);
    await fs.writeFile(changed,Buffer.alloc(40));
    await oldFile("project-abcdef12/.sanitize-lease-"+process.pid+"-abcd",0);
    const result=await manager.extendSelected({snapshotId:summary.id,ids:items.map(x=>x.id)});
    expect(result).toEqual({extended:1,errors:3});
    expect((await manager.candidates())).toMatchObject({count:3,errors:3});
    expect((await fs.stat(outside)).atimeMs).toBe(linkedBefore.atimeMs);
    for(const f of [changed,linked,leased,ok])expect(await exists(f)).toBe(true);
  });
  it("rejects a file that becomes hard-linked after scanning",async()=>{
    const file=await oldFile("global/a.bin");
    const before=await fs.stat(file);
    const {summary}=await ready();
    const other=path.join(sandbox,"other.bin");
    await fs.link(file,other);
    expect(await manager.extendSelected({snapshotId:summary.id,ids:[0]})).toEqual({extended:0,errors:1});
    expect((await fs.stat(other)).atimeMs).toBe(before.atimeMs);
  });
  it.skipIf(process.platform==="win32")("does not follow symbolic links or replaced parent directories",async()=>{
    const outside=path.join(sandbox,"outside");
    await fs.mkdir(outside);
    const external=path.join(outside,"a.bin");
    await fs.writeFile(external,"outside");
    const old=new Date(now-3*86400000);
    await fs.utimes(external,old,old);
    const target=await oldFile("global/sub/a.bin");
    const link=path.join(root,"global","link.bin");
    await fs.symlink(external,link);
    await fs.lutimes(link,old,old);
    const {summary,items}=await ready();
    expect(items.find(x=>x.path.endsWith("link.bin")).canExtend).toBe(false);
    await fs.rename(path.dirname(target),path.join(sandbox,"original"));
    await fs.symlink(outside,path.dirname(target),"dir");
    const before=await fs.stat(external);
    expect(await manager.extendSelected({snapshotId:summary.id,ids:items.map(x=>x.id)})).toEqual({extended:0,errors:2});
    expect((await fs.stat(external)).atimeMs).toBe(before.atimeMs);
    expect(await fs.readFile(external,"utf8")).toBe("outside");
  });
});
