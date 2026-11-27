import fs from "node:fs/promises";
import path from "node:path";

export const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
export const isProjectDir = (name) => /^(global|.+-[0-9a-f]{8})$/.test(name);

// A live process protects its entire project, including idle sessions.
export async function protectedProject(dir) {
  for (const name of await fs.readdir(dir)) {
    if (!/^\.sanitize-lease-\d+-[a-f0-9-]+$/.test(name)) continue;
    const pid = Number(name.split("-")[2]);
    try {
      process.kill(pid, 0);
      return true;
    } catch (error) {
      if (error.code !== "ESRCH") return true;
    }
  }
  return false;
}

export async function sweepDir(dir, now, maxAgeMs = MAX_AGE_MS, options = {}) {
  const removed = { files: 0, dirs: 0 };
  const candidates = [];
  let bytes = 0;
  let count = 0;
  const report = options.report ?? (() => {});
  async function safe(action, target) {
    try {
      return await action();
    } catch (error) {
      if (error.code !== "ENOENT" && error.code !== "ENOTEMPTY") report(error, target);
      return undefined;
    }
  }
  async function walk(folder, root = false) {
    const stat = await safe(() => fs.lstat(folder), folder);
    if (!stat?.isDirectory() || stat.isSymbolicLink()) return;
    const entries = await safe(() => fs.readdir(folder, { withFileTypes: true }), folder);
    if (!entries) return;
    for (const entry of entries) {
      if (entry.name === "uploads" || entry.name.startsWith(".sanitize-")) continue;
      const target = path.join(folder, entry.name);
      if (entry.isDirectory()) {
        if (!options.flat) await walk(target);
      } else {
        const s = await safe(() => fs.lstat(target), target);
        if (!s || (!s.isFile() && !s.isSymbolicLink())) continue;
        count++;
        bytes += s.size;
        const age = now - Math.max(s.atimeMs, s.mtimeMs);
        if (age > maxAgeMs) candidates.push({ target, s, age });
      }
    }
    if (!root) folders.push(folder);
  }
  const folders = [];
  await walk(dir, true);
  candidates.sort((a, b) => b.age - a.age);
  for (const { target, s } of candidates) {
    if (options.guard && await options.guard()) break;
    if (options.dryRun) {
      report(null, target);
      continue;
    }
    await safe(async () => {
      const current = await fs.lstat(target);
      if (current.ino !== s.ino || current.dev !== s.dev ||
          current.mtimeMs !== s.mtimeMs || current.atimeMs !== s.atimeMs ||
          current.size !== s.size || (!current.isFile() && !current.isSymbolicLink())) return;
      const parent = await fs.realpath(path.dirname(target));
      const relative = path.relative(dir, parent);
      if (relative === ".." || relative.startsWith(".." + path.sep) || path.isAbsolute(relative)) return;
      await fs.unlink(target);
      removed.files++;
      bytes -= s.size;
      count--;
    }, target);
  }
  if (!options.dryRun) {
    for (const folder of folders) {
      if (options.guard && await options.guard()) break;
      await safe(async () => {
        await fs.rmdir(folder);
        removed.dirs++;
      }, folder);
    }
  }
  if (bytes > (options.maxBytes ?? Infinity) || count > (options.maxFiles ?? Infinity)) {
    report(new Error("Soft quota exceeded: " + bytes + " bytes, " + count + " files; protected/recent files retained"), dir);
  }
  return removed;
}

export async function sweepProjects(sharedTmp, now, maxAgeMs = MAX_AGE_MS, options = {}) {
  const total = { files: 0, dirs: 0 };
  const entries = await fs.readdir(sharedTmp, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory() || !isProjectDir(entry.name)) continue;
    const dir = path.join(sharedTmp, entry.name);
    try {
      if (await protectedProject(dir)) continue;
      const removed = await sweepDir(dir, now, maxAgeMs, {
        ...options, guard: () => protectedProject(dir),
      });
      total.files += removed.files;
      total.dirs += removed.dirs;
    } catch (error) {
      options.report?.(error, dir);
    }
  }
  return total;
}
