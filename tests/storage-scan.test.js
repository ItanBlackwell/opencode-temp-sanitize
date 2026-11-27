import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {afterEach,beforeEach,describe,it,expect} from "vitest";
import {analyzeStorage} from "../src/storage-scan.js";
import {sweepProjects} from "../src/sweep.js";

let sandbox, root;
beforeEach(async()=>{
  sandbox=await fs.mkdtemp(path.join(os.tmpdir(),"sanitize-scan-"));
  root=path.join(sandbox,"opencode");
  await fs.mkdir(root);
});
afterEach(async()=>{await fs.rm(sandbox,{recursive:true,force:true});});
async function file(relative,bytes){
  const target=path.join(root,relative);
  await fs.mkdir(path.dirname(target),{recursive:true});
  await fs.writeFile(target,Buffer.alloc(bytes));
  return target;
}
const total=rows=>rows.reduce((sum,row)=>sum+row.bytes,0);

describe("complete read-only inventory",()=>{
  it("counts all nested files once, including unknown folders and uploads",async()=>{
    await file("root.bin",10);
    await file("uploads/attachments/a.bin",100);
    await file("legacy-task/nested/b.bin",200);
    await file("project-1234abcd/nested/c.bin",300);
    await file("project-1234abcd/uploads/d.bin",400);
    await file("global/e.bin",500);
    await file("global/.sanitize-lease-"+process.pid+"-abcdef",0);
    const rows=await analyzeStorage(root);
    expect(total(rows)).toBe(1510);
    expect(rows.reduce((sum,row)=>sum+row.files,0)).toBe(6);
    expect(rows.find(row=>row.name==="uploads")).toMatchObject({bytes:100,protected:true});
    expect(rows.find(row=>row.name==="legacy-task")).toMatchObject({bytes:200,protected:true});
    expect(rows.find(row=>row.name==="project-1234abcd")).toMatchObject({bytes:700,protected:false});
    expect(rows.find(row=>row.name==="global")).toMatchObject({bytes:500,protected:true});
    expect(rows.every(row=>row.errors===0)).toBe(true);
  });
  it("does not recurse into directory links or Windows junctions",async()=>{
    const outside=path.join(sandbox,"outside");
    await fs.mkdir(outside);
    await fs.writeFile(path.join(outside,"large.bin"),Buffer.alloc(50000));
    await file("legacy/nested/small.bin",7);
    await fs.symlink(outside,path.join(root,"legacy","outside-link"),process.platform==="win32"?"junction":"dir");
    const link=await fs.lstat(path.join(root,"legacy","outside-link"));
    const rows=await analyzeStorage(root);
    expect(total(rows)).toBe(7+link.size);
    expect(rows.find(row=>row.name==="legacy").protected).toBe(true);
  });
  it("does not expand the deletion scope",async()=>{
    const unknown=await file("legacy-task/old.bin",100);
    const upload=await file("uploads/old.bin",100);
    const owned=await file("project-1234abcd/old.bin",100);
    const nestedUpload=await file("project-1234abcd/uploads/old.bin",100);
    const old=new Date(Date.now()-10*86400000);
    for(const target of [unknown,upload,owned,nestedUpload])await fs.utimes(target,old,old);
    expect(total(await analyzeStorage(root))).toBe(400);
    const warnings=[];
    const removed=await sweepProjects(root,Date.now(),undefined,{report:(error,target)=>warnings.push({error:error?.message,target})});
    expect({removed,warnings}).toEqual({removed:{files:1,dirs:0},warnings:[]});
    await expect(fs.stat(unknown)).resolves.toBeDefined();
    await expect(fs.stat(upload)).resolves.toBeDefined();
    await expect(fs.stat(nestedUpload)).resolves.toBeDefined();
    await expect(fs.stat(owned)).rejects.toMatchObject({code:"ENOENT"});
    expect(total(await analyzeStorage(root))).toBe(300);
  });
  it("handles an aliased ancestor of the temp root without deleting outside it",async()=>{
    const owned=await file("project-1234abcd/old.bin",100);
    const foreign=await file("legacy-task/old.bin",100);
    const old=new Date(Date.now()-10*86400000);
    for(const target of [owned,foreign])await fs.utimes(target,old,old);
    const alias=path.join(sandbox,"alias");
    await fs.symlink(root,alias,process.platform==="win32"?"junction":"dir");
    const nestedRoot=path.join(root,"nested");
    await fs.mkdir(nestedRoot);
    const nestedProject=path.join(nestedRoot,"project-1234abcd");
    await fs.mkdir(nestedProject);
    const nestedFile=path.join(nestedProject,"old.bin");
    await fs.writeFile(nestedFile,Buffer.alloc(100));
    await fs.utimes(nestedFile,old,old);
    expect(await sweepProjects(path.join(alias,"nested"),Date.now())).toEqual({files:1,dirs:0});
    await expect(fs.stat(nestedFile)).rejects.toMatchObject({code:"ENOENT"});
    expect(await sweepProjects(alias,Date.now())).toEqual({files:0,dirs:0});
    await expect(fs.stat(owned)).resolves.toBeDefined();
    await expect(fs.stat(foreign)).resolves.toBeDefined();
  });
  it("rejects a missing root instead of reporting a false zero",async()=>{
    await expect(analyzeStorage(path.join(sandbox,"missing"))).rejects.toMatchObject({code:"ENOENT"});
  });
});
