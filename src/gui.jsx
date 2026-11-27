import { Plugin, SettingsPage, Ipc, Command } from "@opencode/plugin/gui";
import { createSignal, onMount, onCleanup, Show, For } from "solid-js";
import { Sanitize } from "./rpc.js";
import { Schema } from "effect";
import { createUpdater } from "./desktop-updater.js";
import metadata from "../package.json";
const UpdateStatus=Schema.Struct({mode:Schema.String,state:Schema.String,version:Schema.NullOr(Schema.String),checkedAt:Schema.Number});
const Updates=Ipc.define({id:"temp-sanitize.updates.v1",state:UpdateStatus,methods:{
  get:{output:UpdateStatus},check:{output:UpdateStatus},install:{output:UpdateStatus},
  setMode:{input:Schema.Struct({mode:Schema.String}),output:UpdateStatus}
}});

export default Plugin.define({
  main(ctx){
    const updater=createUpdater(metadata.version);
    ctx.provide(Updates,{state:updater.status,get:updater.status,check:updater.check,install:updater.install,setMode:({mode})=>updater.setMode(mode)});
    updater.start();
    return ()=>updater.stop();
  },
  setup(ctx){
    const ui=ctx.ui;
    function Page(){
      const [config,setConfig]=createSignal();
      const [busy,setBusy]=createSignal(false);
      const [error,setError]=createSignal("");
      const [rows,setRows]=createSignal([]);
      const [result,setResult]=createSignal();
      const [history,setHistory]=createSignal([]);
      const [confirm,setConfirm]=createSignal(false);
      const [updates,setUpdates]=createSignal();
      const [updateBusy,setUpdateBusy]=createSignal(false);
      async function update(action){
        if(updateBusy())return;
        setUpdateBusy(true);
        try{setUpdates(await action(ctx.main(Updates)));}
        catch{setUpdates(old=>({...old,mode:old?.mode??"notify",state:"error",version:null}));}
        finally{setUpdateBusy(false);}
      }
      onMount(()=>{
        const poll=()=>void update(client=>client.get({}));
        poll();const timer=setInterval(poll,3000);
        onCleanup(()=>clearInterval(timer));
      });
      const call=()=> {
        const rpc=ctx.client.rpc(Sanitize);
        return Object.fromEntries(Object.keys(Sanitize.methods).map(name=>[name,async (input)=>{
          try{return await rpc[name](input);}
          catch(error){
            const type=error?.type??error?.cause?.type??error?.data?.type;
            throw new Error(name+": "+String(error?.message??error)+(type?" ["+type+"]":""));
          }
        }]));
      };
      async function compatible(){
        const response=await call().protocol({});
        if(response.version!==metadata.version)throw new Error("Restart OpenCode and its background server to synchronize plugin versions.");
      }
      const run=async(fn)=>{if(busy())return;setBusy(true);setError("");try{await compatible();await fn();}catch(e){setError(String(e.message??e));}finally{setBusy(false);}};
      const refresh=async()=>{setRows(await call().analyze({}));setHistory(await call().history({}));};
      onMount(()=>run(async()=>{setConfig(await call().settings({}));await refresh();}));
      const change=(key,value)=>{setConfig(old=>({...old,[key]:value}));setConfirm(false);};
      const numbers=[["retentionDays","Retention (days)"],["intervalMinutes","Interval (minutes)"],["maxBytes","Soft quota (bytes)"],["maxFiles","Soft quota (files)"]];
      const flags=[["enabled","Automatic cleanup"],["dryRun","Dry-run mode"],["legacy","Preview legacy root files"]];
      return <ui.SettingsLayout title="Temporary Files" description="Manage server-side temporary storage. Active projects and uploads are protected.">
        <Show when={error()}><p role="alert">{error()} Check the indicated RPC method and server log.</p><ui.Button onClick={()=>run(async()=>{setConfig(await call().settings({}));await refresh();})}>Retry connection</ui.Button></Show>
        <ui.SettingsSection title="Updates">
          <ui.SettingsRow title={"Installed version "+metadata.version} description={updates()?.state==="restart"?"Restart OpenCode and its server to activate "+updates()?.version:updates()?.state==="available"?"Available: "+updates()?.version:updates()?.state==="error"?"Update check or installation failed. Retry or use the Portable ZIP.":updates()?.state==="unavailable"?"Use a Windows Portable installation.":updates()?.state??"Checking support…"}>
            <select aria-label="Update mode" disabled={updateBusy()||!updates()||["unavailable","restart","checking","installing"].includes(updates().state)} value={updates()?.mode??"notify"} onChange={e=>update(client=>client.setMode({mode:e.currentTarget.value}))}>
              <option value="notify">Notify me</option><option value="auto">Automatic</option><option value="manual">Manual</option>
            </select>
            <ui.Button disabled={updateBusy()||!updates()||["unavailable","restart","checking","installing"].includes(updates().state)} onClick={()=>update(client=>client.check({}))}>Check</ui.Button>
            <Show when={updates()?.version&&["available","error"].includes(updates()?.state)}>
              <ui.Button disabled={updateBusy()} onClick={()=>update(client=>client.install({}))}>Install update</ui.Button>
            </Show>
          </ui.SettingsRow>
        </ui.SettingsSection>
        <Show when={config()}>
          <ui.SettingsSection title="Cleanup policy">
            <For each={flags}>{([key,label])=><ui.SettingsRow id={key} title={label}><ui.Switch label={label} checked={config()[key]} onChange={value=>change(key,value)}/></ui.SettingsRow>}</For>
            <For each={numbers}>{([key,label])=><ui.SettingsRow id={key} title={label}><input aria-label={label} type="number" min="1" step="1" value={config()[key]} onInput={e=>change(key,e.currentTarget.valueAsNumber)}/></ui.SettingsRow>}</For>
            <ui.SettingsRow title="Save policy" description="Applied on the server without restarting"><ui.Button disabled={busy()} onClick={()=>run(async()=>{setConfig(await call().save(config()));setConfirm(false);})}>Save settings</ui.Button></ui.SettingsRow>
          </ui.SettingsSection>
          <ui.SettingsSection title="Storage overview">
            <For each={rows()}>{row=><ui.SettingsRow title={row.name} description={row.files+" files · "+(row.bytes/1048576).toFixed(1)+" MiB"+(row.errors?" · incomplete scan":"")}>{row.protected?"Protected":"Inactive"}</ui.SettingsRow>}</For>
            <ui.SettingsRow title="Analyze storage"><ui.Button disabled={busy()} onClick={()=>run(refresh)}>Refresh</ui.Button></ui.SettingsRow>
            <ui.SettingsRow title="Preview saved policy"><ui.Button disabled={busy()} onClick={()=>run(async()=>{setResult(await call().preview({}));setConfirm(false);await refresh();})}>Preview cleanup</ui.Button></ui.SettingsRow>
            <ui.SettingsRow title="Manual cleanup" description="Uses saved settings, including dry-run."><ui.Button disabled={busy()} variant="danger" onClick={()=>setConfirm(true)}>Clean now</ui.Button></ui.SettingsRow>
            <Show when={confirm()}><ui.SettingsRow title="Confirm cleanup of eligible inactive-project files"><ui.Button disabled={busy()} variant="danger" onClick={()=>run(async()=>{setConfirm(false);setResult(await call().clean({confirmed:true}));await refresh();})}>Confirm</ui.Button><ui.Button onClick={()=>setConfirm(false)}>Cancel</ui.Button></ui.SettingsRow></Show>
            <Show when={result()}><pre style={{"white-space":"pre-wrap","overflow-wrap":"anywhere"}}>{JSON.stringify(result(),null,2)}</pre></Show>
          </ui.SettingsSection>
          <ui.SettingsSection title="Recent cleanup history (current server process)">
            <For each={history()}>{item=><ui.SettingsRow title={item.time} description={item.mode+(item.dryRun?" · dry run":"")+" · "+item.errors+" warnings"}>{item.files} removed / {item.candidates} candidates</ui.SettingsRow>}</For>
          </ui.SettingsSection>
        </Show>
      </ui.SettingsLayout>;
    }
    if (!SettingsPage) {
      console.warn("[temp-sanitize] SettingsPage API unavailable in this Desktop version");
      return;
    }
    ctx.add(SettingsPage,{
      id:"temporary-files",icon:"server",title:"Temporary Files",
      entries:[{id:"enabled",title:"Automatic cleanup",keywords:"temp sanitize storage cleanup"}],
      render:()=> <Page/>,
    });
    if (Command) ctx.add(Command,{
      id:"open-settings",title:"Temp Sanitize: Open settings",
      run:()=>ctx.layout.settings("temporary-files"),
    });
    console.info("[temp-sanitize] Temporary Files settings page registered",metadata.version);
  }
});
