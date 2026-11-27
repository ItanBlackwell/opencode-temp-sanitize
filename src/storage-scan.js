import fs from "node:fs/promises";
import path from "node:path";
import {isProjectDir,protectedProject} from "./sweep.js";

const newRow=(name)=>({name,files:0,bytes:0,protected:true,errors:0});
const leaseName=name=>/^\.sanitize-lease-\d+-[a-f0-9-]+$/.test(name);

// Read-only inventory, independent from cleanup eligibility.
// Never recurse through symbolic links or directory junctions.
export async function analyzeStorage(root){
  const rows=[];
  const base=newRow("Legacy root files");
  rows.push(base);
  const canonicalRoot=await fs.realpath(root);
  const inside=target=>{
    const relative=path.relative(canonicalRoot,target);
    return relative!==""&&relative!==".."&&!relative.startsWith(".."+path.sep)&&!path.isAbsolute(relative);
  };
  async function list(folder,row){
    try{return await fs.readdir(folder,{withFileTypes:true});}
    catch(error){row.errors++;return [];}
  }
  async function inspect(target,row){
    try{return await fs.lstat(target);}
    catch(error){row.errors++;return undefined;}
  }
  function count(stat,row){
    if(stat.isFile()||stat.isSymbolicLink()){row.files++;row.bytes+=stat.size;}
  }
  async function scanDirectory(folder,row){
    const stack=[folder];
    while(stack.length){
      const current=stack.pop();
      try{
        const stat=await fs.lstat(current);
        if(!stat.isDirectory()||stat.isSymbolicLink()){row.errors++;continue;}
        const real=await fs.realpath(current);
        if(!inside(real)||path.relative(current,real)!==""){row.errors++;continue;}
        for(const item of await list(current,row)){
          if(leaseName(item.name))continue;
          const target=path.join(current,item.name);
          const s=await inspect(target,row);
          if(!s)continue;
          if(s.isDirectory()&&!s.isSymbolicLink())stack.push(target);
          else count(s,row);
        }
      }catch(error){row.errors++;}
    }
  }
  // A missing/inaccessible root is a failed scan, not an empty disk.
  for(const item of await fs.readdir(canonicalRoot,{withFileTypes:true})){
    if(leaseName(item.name))continue;
    const target=path.join(canonicalRoot,item.name);
    const stat=await inspect(target,base);
    if(!stat)continue;
    if(!stat.isDirectory()||stat.isSymbolicLink()){count(stat,base);continue;}
    const row=newRow(item.name);
    rows.push(row);
    if(isProjectDir(item.name)){
      try{row.protected=await protectedProject(target);}
      catch(error){row.errors++;}
    }
    // Include uploads and all non-project directories, but keep them protected.
    await scanDirectory(target,row);
  }
  return rows;
}
