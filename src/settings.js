import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

export const defaults = Object.freeze({enabled:false, retentionDays:7, intervalMinutes:60, maxBytes:2147483648, maxFiles:100000, legacy:false});
export function validate(value) {
  if (!value || typeof value !== "object") throw new Error("Invalid settings");
  const result = {};
  for (const key of Object.keys(defaults)) {
    const v = value[key];
    if (typeof defaults[key] === "boolean" ? typeof v !== "boolean" : !Number.isSafeInteger(v) || v < 1) throw new Error("Invalid " + key);
    result[key] = v;
  }
  if (result.retentionDays > 3650 || result.intervalMinutes > 1440) throw new Error("Interval or retention out of range");
  return result;
}
// A previous preview-only installation must never start deleting on upgrade.
export function migrate(value) {
  if(value && Object.hasOwn(value,"dryRun") && typeof value.dryRun!=="boolean")throw new Error("Invalid legacy dryRun");
  if(value?.dryRun === true) return validate({...value,enabled:false});
  return validate(value);
}
export function settingsStore(directory) {
  const file = path.join(directory, "settings.json");
  return {
    async read() {
      try { return migrate(JSON.parse(await fs.readFile(file, "utf8"))); }
      catch (e) { if (e.code === "ENOENT") return {...defaults}; throw e; }
    },
    async write(value) {
      const data = validate(value);
      await fs.mkdir(directory, {recursive:true, mode:0o700});
      const temp = file + "." + randomUUID();
      try {
        await fs.writeFile(temp, JSON.stringify({...data,dryRun:!data.enabled}, null, 2), {flag:"wx", mode:0o600});
        await fs.rename(temp, file);
      } finally { await fs.rm(temp, {force:true}); }
      return data;
    }
  };
}
