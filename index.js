/**
 * OpenCode 2 plugin entry: gives each project its own temporary directory under
 * OpenCode's shared one. See README.md for behaviour, src/project-tmp.js for the logic.
 */
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { projectSlug, rewriteTmpHint } from "./src/project-tmp.js";
import { sweepDir, sweepProjects } from "./src/sweep.js";

const SWEEP_INTERVAL_MS = 60 * 60 * 1000;
function positive(name, fallback) {
  const value = process.env[name];
  if (value === undefined) return fallback;
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw new Error("Invalid " + name);
  return number;
}

export default {
  id: "temp-sanitize",
  async setup(ctx) {
    // Core creates this directory before plugins load, so realpath must succeed;
    // core advertises the realpath'd form in the prompt.
    const sharedTmp = fs.realpathSync(path.join(os.tmpdir(), "opencode"));
    const projectTmp = path.join(sharedTmp, projectSlug(ctx.location.project, os.homedir()));
    fs.mkdirSync(projectTmp, { recursive: true });

    if (fs.lstatSync(projectTmp).isSymbolicLink() || fs.realpathSync(projectTmp) !== projectTmp) {
      throw new Error("Unsafe project temporary directory");
    }
    const maxAge = positive("OPENCODE_SANITIZE_DAYS", 7) * 86400000;
    const options = {
      dryRun: process.env.OPENCODE_SANITIZE_DRY_RUN === "1",
      maxBytes: positive("OPENCODE_SANITIZE_MAX_BYTES", 2 * 1024 ** 3),
      maxFiles: positive("OPENCODE_SANITIZE_MAX_FILES", 100000),
      report: (error, target) => console.warn("[temp-sanitize] cleanup " + (error?.message ?? "would delete") + ": " + target),
    };
    const lease = path.join(projectTmp, ".sanitize-lease-" + process.pid + "-" + randomUUID());
    fs.writeFileSync(lease, "", { flag: "wx" });
    const warned = new Set();
    await ctx.session.hook("context", (input) => {
      if (rewriteTmpHint(input.system, sharedTmp, projectTmp)) return;
      if (warned.has(input.sessionID)) return;
      warned.add(input.sessionID);
      // The plugin API exposes no server-side logger; console output reaches the
      // OpenCode log. Not fatal on purpose: a missing hint only means models fall
      // back to the shared directory, which must not break the session.
      console.warn(
        `[temp-sanitize] tmp hint not found in system prompt (session ${input.sessionID}); ` +
          "OpenCode wording may have changed, models will use the shared tmp directory",
      );
    });

    await ctx.shell.hook("create.before", (input) => {
      input.env.TMPDIR = projectTmp;
      input.env.TEMP = projectTmp;
      input.env.TMP = projectTmp;
    });

    // The OpenCode service runs for days and calls setup once, hence the timer.
    // Cleanup is housekeeping: a failure is logged and retried on the next tick
    // instead of crashing the shared service from a timer callback.
    let running;
    const sweep = () => {
      if (running) return running;
      running = (async () => {
        const result = await sweepProjects(sharedTmp, Date.now(), maxAge, options);
        // Root files have no session ownership metadata. Only opt in on exclusive hosts.
        if (process.env.OPENCODE_SANITIZE_LEGACY === "1") {
          await sweepDir(sharedTmp, Date.now(), maxAge, { ...options, flat: true });
        }
        if (result.files || result.dirs) console.info("[temp-sanitize] cleanup", result);
      })().catch((error) => {
        console.warn(`[temp-sanitize] cleanup of ${sharedTmp} failed: ${error.message}`);
      }).finally(() => { running = undefined; });
      return running;
    };
    const timer = setInterval(sweep, SWEEP_INTERVAL_MS);
    timer.unref();
    sweep();
    return async () => {
      clearInterval(timer);
      await running;
      fs.rmSync(lease, { force: true });
    };
  },
};
