export const GIB=1024**3;
export const advancedKeys=["intervalMinutes","maxBytes","maxFiles","legacy","updates"];
export const labelKeys={retentionDays:"keepDays",dryRun:"previewOnly",maxBytes:"sizeWarning",maxFiles:"fileWarning"};
export function maxValue(key){
  return key==="retentionDays"?3650:key==="intervalMinutes"?1440:Number.MAX_SAFE_INTEGER;
}
export function displayValue(key,value){
  return key==="maxBytes"?value/GIB:value;
}
export function storedValue(key,value){
  if(!Number.isFinite(value)||value<=0)return NaN;
  const stored=key==="maxBytes"?Math.round(value*GIB):value;
  return Number.isSafeInteger(stored)&&stored>=1&&stored<=maxValue(key)?stored:NaN;
}
export function validPolicy(policy){
  if(!policy)return false;
  return ["enabled","legacy","showIndicator"].every(key=>typeof policy[key]==="boolean") &&
    ["retentionDays","intervalMinutes","maxBytes","maxFiles"].every(key=>Number.isSafeInteger(policy[key])&&policy[key]>=1&&policy[key]<=maxValue(key));
}
export function summarizeRows(rows){
  if(!Array.isArray(rows))return undefined;
  return rows.reduce((total,row)=>({bytes:total.bytes+row.bytes,files:total.files+row.files,errors:total.errors+row.errors}),{bytes:0,files:0,errors:0});
}
export function formatStorage(bytes,locale){
  const units=["B","KiB","MiB","GiB","TiB","PiB"];
  let value=bytes,index=0;
  while(value>=1024&&index<units.length-1){value/=1024;index++;}
  return new Intl.NumberFormat(locale,{maximumFractionDigits:index?1:0}).format(value)+" "+units[index];
}
