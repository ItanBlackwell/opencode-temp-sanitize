import { describe,it,expect } from "vitest";
import { GIB,advancedKeys,labelKeys,displayValue,storedValue,validPolicy,summarizeRows,formatStorage } from "../src/compact-view.js";
import { defaults } from "../src/settings.js";
import { i18n,locales,helpKeys } from "../src/i18n.js";
describe("compact settings",()=>{
  it("preserves stored bytes while displaying GiB, including old custom quotas",()=>{
    for(const bytes of [1,1024,1024**2,123456789,2*GIB,Number.MAX_SAFE_INTEGER]){
      expect(storedValue("maxBytes",displayValue("maxBytes",bytes))).toBe(bytes);
    }
    expect(displayValue("maxBytes",defaults.maxBytes)).toBe(2);
    expect(storedValue("maxBytes",0.5)).toBe(GIB/2);
    expect(storedValue("maxBytes",NaN)).toBeNaN();
    expect(storedValue("maxBytes",0)).toBeNaN();
  });
  it("validates editable values without changing the saved cleanup policy",()=>{
    expect(validPolicy(defaults)).toBe(true);
    expect(validPolicy({...defaults,retentionDays:3651})).toBe(false);
    expect(validPolicy({...defaults,intervalMinutes:1441})).toBe(false);
    expect(validPolicy({...defaults,maxBytes:NaN})).toBe(false);
    expect(validPolicy({...defaults,enabled:"false"})).toBe(false);
    expect(storedValue("retentionDays",1.5)).toBeNaN();
    expect(storedValue("intervalMinutes",1440)).toBe(1440);
  });
  it("does not confuse unscanned storage with zero or hide scan errors",()=>{
    expect(summarizeRows(undefined)).toBeUndefined();
    expect(summarizeRows([])).toEqual({bytes:0,files:0,errors:0});
    expect(summarizeRows([{bytes:GIB,files:10,errors:0},{bytes:1024,files:1,errors:2}])).toEqual({bytes:GIB+1024,files:11,errors:2});
    expect(formatStorage(0,"en")).toBe("0 B");
    expect(formatStorage(512,"en")).toBe("512 B");
    expect(formatStorage(GIB*1.5,"en")).toBe("1.5 GiB");
    expect(formatStorage(GIB*1.5,"ru")).toBe("1,5 GiB");
  });
  it("keeps all advanced settings reachable and translated",()=>{
    expect(advancedKeys).toEqual(["intervalMinutes","maxBytes","maxFiles","legacy","updates"]);
    for(const locale of locales){
      const copy=i18n[locale];
      for(const key of [...advancedKeys,"enabled","retentionDays"]){
        expect(copy[labelKeys[key]??key]).toBeTruthy();
        expect(copy[helpKeys[key]]).toBeTruthy();
      }
      for(const key of ["advanced","scan","scanned","details","check","installUpdate","unavailable","fileCount","unsaved","selected","cleanSelected","helpScanOnly","selectPage","selectionChanged","noRelease"])expect(copy[key]).toBeTruthy();
    }
  });
});
