/**
 * OpenCode 2 plugin entry: gives each project its own temporary directory under
 * OpenCode's shared one. See README.md for behaviour, src/project-tmp.js for the logic.
 */
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { projectSlug, rewriteTmpHint } from "./src/project-tmp.js";
import { acquireManager } from "./src/manager.js";
import { Sanitize } from "./src/rpc.js";
import metadata from "./package.json" with { type: "json" };

// Bound recurring diagnostics per server process, not per session or project.
let warnedPrompt=false,loggedRegistration=false;
const warnedMethods=new Set();

export default {
  id: "temp-sanitize",
  async setup(ctx) {
    // Core creates this directory before plugins load, so realpath must succeed;
    // core advertises the realpath'd form in the prompt.
    const tempRoot = path.join(os.tmpdir(), "opencode");
    const promptTmp = fs.realpathSync(tempRoot);
    const sharedTmp = fs.realpathSync.native(tempRoot);
    const projectTmp = path.join(sharedTmp, projectSlug(ctx.location.project, os.homedir()));
    fs.mkdirSync(projectTmp, { recursive: true });

    if (fs.lstatSync(projectTmp).isSymbolicLink() || path.relative(projectTmp, fs.realpathSync.native(projectTmp)) !== "") {
      throw new Error("Unsafe project temporary directory");
    }
    const lease = path.join(projectTmp, ".sanitize-lease-" + process.pid + "-" + randomUUID());
    fs.writeFileSync(lease, "", { flag: "wx" });
    let release,registration;
    try {
    await ctx.session.hook("context", (input) => {
      if (rewriteTmpHint(input.system, promptTmp, projectTmp)) return;
      if (promptTmp !== sharedTmp && rewriteTmpHint(input.system, sharedTmp, projectTmp)) return;
      if (warnedPrompt) return;
      warnedPrompt = true;
      // The plugin API exposes no server-side logger; console output reaches the
      // OpenCode log. Not fatal on purpose: a missing hint only means models fall
      // back to the shared directory, which must not break the session.
      console.warn(
        `[temp-sanitize] tmp hint not found in system prompt; ` +
          "OpenCode wording may have changed, models will use the shared tmp directory",
      );
    });

    await ctx.shell.hook("create.before", (input) => {
      input.env.TMPDIR = projectTmp;
      input.env.TEMP = projectTmp;
      input.env.TMP = projectTmp;
    });

    const configHome = process.platform === "win32"
      ? (process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"))
      : (process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"));
    const acquired = acquireManager(sharedTmp, path.join(configHome, "opencode-temp-sanitize"));
    const manager=acquired.manager;
    release=acquired.release;
      const handlers = {
        protocol: () => ({version:metadata.version,root:sharedTmp}),
        settings: () => manager.settings(),
        save: input => manager.save(input),
        analyze: () => manager.analyze(),
        storageSummary: () => manager.storageSummary(),
        storagePage: input => manager.storagePage(input),
        preview: input => manager.preview(input),
        clean: input => manager.clean(input),
        history: () => manager.history(),
        candidates: () => manager.candidates(),
        candidatePage: input => manager.candidatePage(input),
        cleanSelected: input => manager.cleanSelected(input),
      };
      // OpenCode's promise adapter invokes Effect.tryPromise: even synchronous
      // handlers must return a Promise, otherwise the host raises rpc.internal.
      const asyncHandlers = Object.fromEntries(Object.entries(handlers).map(([name, handler]) => [
        name, async (input, context) => {
          try { return await handler(input); }
          catch (error) {
            if(!warnedMethods.has(name)){warnedMethods.add(name);console.warn("[temp-sanitize] RPC " + name + " failed:", error.message);}
            if (context?.error) return context.error("operation_failed", "Temporary Files: " + name + " failed. See server log.", {method:name});
            throw error;
          }
        },
      ]));
      if (!ctx.rpc?.register) throw new Error("Temp Sanitize requires the OpenCode server RPC API");
      registration = await ctx.rpc.register(Sanitize, asyncHandlers);
      if(!loggedRegistration){loggedRegistration=true;console.info("[temp-sanitize] RPC registered", metadata.version);}
    } catch (error) {
      try{await release?.();}finally{fs.rmSync(lease,{force:true});}
      throw error;
    }
    return async () => {
      try { await registration?.dispose?.(); }
      finally { try { await release(); } finally { fs.rmSync(lease, {force:true}); } }
    };
  },
};
