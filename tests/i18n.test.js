import { describe,it,expect } from "vitest";
import { i18n,locales,keys,parameterKeys,helpKeys } from "../src/i18n.js";
describe("Desktop localization",()=>{
  it("includes all 63 locales from OpenCode's desktop-native registry",()=>{
    expect(locales).toEqual("en zh zht ko de es fr da ja pl ru uk bs ar he no br th tr hi nl id vi it ur pa az fi sv am bg bn ca cs dv dz el et fa fo hr hu hy is ka km lo lt lv mk mn ms my ne ro si sk sl sq sr tg tk uz".split(" "));
    expect(Object.keys(i18n)).toEqual(locales);
    expect(new Set(locales).size).toBe(63);
  });
  it.each(locales)("has complete translated copy in %s",(locale)=>{
    const messages=i18n[locale];
    expect(Object.keys(messages)).toEqual(keys);
    expect(Object.values(messages).every(v=>typeof v==="string"&&v.trim().length>0)).toBe(true);
    for(const key of parameterKeys){
      expect(messages[key]).toBeTruthy();
      expect(messages[helpKeys[key]]).toBeTruthy();
    }
    if(locale!=="en"){
      expect(messages.title).not.toEqual(i18n.en.title);
      expect(messages.helpDry).not.toEqual(i18n.en.helpDry);
    }
  });
  it("keeps explicit non-destructive warnings in English and Russian",()=>{
    expect(i18n.en.helpBytes).toContain("never forces deletion");
    expect(i18n.en.helpDry).toContain("even with manual cleanup");
    expect(i18n.ru.helpDry).toContain("не удаляются");
    expect(i18n.ru.helpLegacy).toContain("никогда не удаляет");
  });
});
