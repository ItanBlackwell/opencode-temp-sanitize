import fs from "node:fs/promises";
import path from "node:path";
import {isProjectDir,protectedProject} from "./sweep.js";

export const PAGE_SIZE=50;
export const MAX_SELECTION=500;
export const samePolicy=(a,b)=>!!a&&!!b&&["enabled","retentionDays","intervalMinutes","maxBytes","maxFiles","legacy"].every(key=>a[key]===b[key]);
export const identity=s=>({dev:s.dev,ino:s.ino,size:s.size,mtimeMs:s.mtimeMs,atimeMs:s.atimeMs,ctimeMs:s.ctimeMs,link:s.isSymbolicLink()});
export function candidatePage(snapshot,{snapshotId,offset}){
  if(!snapshot||snapshot.id!==snapshotId)throw new Error("Candidate list changed; refresh");
  if(!Number.isSafeInteger(offset)||offset<0)throw new Error("Invalid offset");
  return {snapshotId,offset,items:snapshot.entries.slice(offset,offset+PAGE_SIZE).map((entry,i)=>({
    id:offset+i,path:entry.path,bytes:entry.size,modifiedAt:new Date(entry.mtimeMs).toISOString()
  }))};
}
export function selectionEntries(snapshot,{snapshotId,ids}){
  if(!snapshot||snapshot.id!==snapshotId)throw new Error("Candidate list changed; refresh");
  if(!Array.isArray(ids)||ids.length===0||ids.length>MAX_SELECTION||new Set(ids).size!==ids.length||
    ids.some(id=>!Number.isSafeInteger(id)||id<0||id>=snapshot.entries.length))throw new Error("Invalid selection");
  return ids.map(id=>snapshot.entries[id]);
}
// Only an entry from the current server-owned snapshot can reach this function.
// Recheck current policy, ownership, canonical ancestry, leases and identity.
export async function deleteCandidate(root,entry,policy,now=Date.now()){
  const segments=entry.path.split(path.sep);
  if(segments.length<2||!isProjectDir(segments[0])||segments.some(s=>!s||s==="."||s===".."||s.toLowerCase()==="uploads"||s.startsWith(".sanitize-")))return false;
  const target=path.resolve(root,entry.path);
  const relative=path.relative(root,target);
  if(relative!==entry.path||path.isAbsolute(relative))return false;
  const project=path.join(root,segments[0]);
  try{
    const projectStat=await fs.lstat(project);
    if(!projectStat.isDirectory()||projectStat.isSymbolicLink()||path.relative(project,await fs.realpath(project))!=="")return false;
    const parent=path.dirname(target);
    if(path.relative(parent,await fs.realpath(parent))!=="")return false;
    if(await protectedProject(project))return false;
    const current=await fs.lstat(target);
    if(!current.isFile()&&!current.isSymbolicLink())return false;
    const check=identity(current);
    if(Object.keys(check).some(key=>check[key]!==entry[key]))return false;
    if(now-Math.max(current.atimeMs,current.mtimeMs)<=policy.retentionDays*86400000)return false;
    // Recheck lease and ancestry immediately before unlink; never recurse.
    if(await protectedProject(project)||path.relative(parent,await fs.realpath(parent))!=="")return false;
    await fs.unlink(target);
    return true;
  }catch(error){
    if(error.code==="ENOENT")return false;
    throw error;
  }
}
