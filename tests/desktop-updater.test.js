import {describe,it,expect} from "vitest";
import {newer,selectRelease} from "../src/desktop-updater.js";
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
