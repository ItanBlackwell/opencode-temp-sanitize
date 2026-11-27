// OpenCode Desktop locale IDs from packages/app/src/runtime/i18n/desktop-native.ts.
import { western } from "./i18n-western.js";
import { eastern } from "./i18n-eastern.js";
import { other } from "./i18n-other.js";
import { extra } from "./i18n-extra.js";
import { compactKeys, compactRows } from "./i18n-compact.js";

export const locales = "en zh zht ko de es fr da ja pl ru uk bs ar he no br th tr hi nl id vi it ur pa az fi sv am bg bn ca cs dv dz el et fa fo hr hu hy is ka km lo lt lv mk mn ms my ne ro si sk sl sq sr tg tk uz".split(" ");
const baseKeys = ("title description policy enabled retentionDays intervalMinutes maxBytes maxFiles dryRun legacy updates notify automatic manual storage preview clean confirmClean protected inactive history warnings removed candidates dirs current available restart helpEnabled helpRetention helpInterval helpBytes helpFiles helpDry helpLegacy helpUpdate").split(" ");
export const keys = [...baseKeys,...compactKeys];
const rows = {...western,...eastern,...other,...extra};
export const i18n = Object.fromEntries(locales.map(locale => {
  const base=rows[locale]?.split("|");
  const compact=compactRows[locale]?.split("|");
  if(!base||base.length!==baseKeys.length||!compact||compact.length!==compactKeys.length||[...base,...compact].some(v=>!v.trim()))throw new Error("Invalid Temp Sanitize locale: "+locale);
  const values=[...base,...compact];
  return [locale,Object.fromEntries(keys.map((key,i)=>[key,values[i].trim()]))];
}));
export const parameterKeys = ["enabled","retentionDays","intervalMinutes","maxBytes","maxFiles","dryRun","legacy","updates"];
export const helpKeys = {enabled:"helpEnabled",retentionDays:"helpRetention",intervalMinutes:"helpInterval",maxBytes:"helpBytes",maxFiles:"helpFiles",dryRun:"helpDry",legacy:"helpLegacy",updates:"helpUpdate"};
