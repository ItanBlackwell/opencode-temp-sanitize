import { Plugin, SettingsPage } from "@opencode/plugin/gui";
import { createSignal, onMount, Show, For } from "solid-js";
import { Sanitize } from "./rpc.js";
export default Plugin.define({
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
      const call=()=>ctx.client.rpc(Sanitize);
      const run=async(fn)=>{if(busy())return;setBusy(true);setError("");try{await fn();}catch(e){setError(String(e.message??e));}finally{setBusy(false);}};
      const refresh=async()=>{setRows(await call().analyze({}));setHistory(await call().history({}));};
      onMount(()=>run(async()=>{setConfig(await call().settings({}));await refresh();}));
      const change=(key,value)=>{setConfig(old=>({...old,[key]:value}));setConfirm(false);};
      const numbers=[["retentionDays","Retention (days)"],["intervalMinutes","Interval (minutes)"],["maxBytes","Soft quota (bytes)"],["maxFiles","Soft quota (files)"]];
      const flags=[["enabled","Automatic cleanup"],["dryRun","Dry-run mode"],["legacy","Preview legacy root files"]];
      return <ui.SettingsLayout title="Temporary Files" description="Manage server-side temporary storage. Active projects and uploads are protected.">
        <Show when={error()}><p role="alert">{error()}</p></Show>
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
    ctx.add(SettingsPage,{id:"temporary-files",title:"Temporary Files",render:()=> <Page/>});
  }
});
