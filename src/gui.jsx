import { Plugin, SettingsPage, Ipc, Command } from "@opencode/plugin/gui";
import { createSignal, onMount, onCleanup, Show, For } from "solid-js";
import { Sanitize } from "./rpc.js";
import { Schema } from "effect";
import { createUpdater } from "./desktop-updater.js";
import metadata from "../package.json";
import { i18n, parameterKeys, helpKeys } from "./i18n.js";
const UpdateStatus=Schema.Struct({mode:Schema.String,state:Schema.String,version:Schema.NullOr(Schema.String),checkedAt:Schema.Number});
const Updates=Ipc.define({id:"temp-sanitize.updates.v1",state:UpdateStatus,methods:{
  get:{output:UpdateStatus},check:{output:UpdateStatus},install:{output:UpdateStatus},
  setMode:{input:Schema.Struct({mode:Schema.String}),output:UpdateStatus}
}});

export default Plugin.define({
  i18n,
  main(ctx){
    const updater=createUpdater(metadata.version);
    ctx.provide(Updates,{state:updater.status,get:updater.status,check:updater.check,install:updater.install,setMode:({mode})=>updater.setMode(mode)});
    updater.start();
    return ()=>updater.stop();
  },
  setup(ctx){
    const ui=ctx.ui;
    const t=(key,params)=>ctx.t(key,params);
    const number=value=>new Intl.NumberFormat(ctx.locale.locale(),{maximumFractionDigits:1}).format(value);
    const date=value=>new Date(value).toLocaleString(ctx.locale.locale());
    const help=key=>t(helpKeys[key]);
    const flags=["enabled","dryRun","legacy"];
    const numbers=["retentionDays","intervalMinutes","maxBytes","maxFiles"];
    function Help(props){
      return <ui.Tooltip placement="top" value={<span style={{"max-width":"280px","white-space":"normal","overflow-wrap":"anywhere",display:"block"}} dir={ctx.locale.direction?.()??"auto"}>{help(props.name)}</span>}>
        <button type="button" aria-label={t(props.name)+": "+help(props.name)}
          style={{display:"inline-flex",border:"0",background:"transparent",color:"var(--text-weak, currentColor)",cursor:"help","font-size":"15px","line-height":"1",padding:"4px","align-items":"center"}}>
          <span aria-hidden="true">ⓘ</span>
        </button>
      </ui.Tooltip>;
    }
    function ParameterTitle(props){
      return <span style={{display:"inline-flex","align-items":"center",gap:"4px","flex-wrap":"wrap"}}>{t(props.name)}<Help name={props.name}/></span>;
    }
    function Page(){
      const [config,setConfig]=createSignal();
      const [saved,setSaved]=createSignal();
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
            // Keep raw technical detail in the diagnostic message.
            throw new Error(name+": "+String(error?.message??error)+(type?" ["+type+"]":""));
          }
        }]));
      };
      async function compatible(){
        const response=await call().protocol({});
        if(response.version!==metadata.version)throw new Error(t("restart"));
      }
      const run=async(fn)=>{if(busy())return;setBusy(true);setError("");try{await compatible();await fn();}catch(e){setError(String(e.message??e));}finally{setBusy(false);}};
      const refresh=async()=>{setRows(await call().analyze({}));setHistory(await call().history({}));};
      const load=async()=>{const policy=await call().settings({});setConfig({...policy});setSaved(policy);await refresh();};
      onMount(()=>run(load));
      const change=(key,value)=>{setConfig(old=>({...old,[key]:value}));setConfirm(false);};
      const dirty=()=>!!config()&&!!saved()&&JSON.stringify(config())!==JSON.stringify(saved());
      const max=key=>key==="retentionDays"?3650:key==="intervalMinutes"?1440:Number.MAX_SAFE_INTEGER;
      const valid=()=>!!config()&&numbers.every(key=>Number.isSafeInteger(config()[key])&&config()[key]>=1&&config()[key]<=max(key));
      const updateDisabled=()=>updateBusy()||!updates()||["unavailable","restart","checking","installing"].includes(updates().state);
      function updateDescription(){
        const state=updates()?.state;
        if(state==="restart")return t("restart")+" "+(updates()?.version??"");
        if(state==="available")return t("available")+": "+updates().version;
        if(state==="current")return t("current");
        if(state==="error")return t("common.requestFailed");
        if(state==="unavailable")return t("settings.plugins.unsupported");
        if(state==="checking")return t("settings.plugins.checking");
        if(state==="installing")return t("settings.plugins.updating");
        if(state==="idle")return t("settings.plugins.check");
        return t("common.loading");
      }
      const recordMode=item=>item.mode==="automatic"?t("automatic"):item.mode==="preview"?t("preview"):t("manual");
      const metric=(label,value)=>t(label)+": "+number(value);
      function Result(props){
        const item=()=>props.record;
        return <div style={{padding:"8px","overflow-wrap":"anywhere"}}>
          <p>{date(item().time)} · {recordMode(item())}{item().dryRun?" · "+t("dryRun"):""}</p>
          <p>{[metric("removed",item().files),metric("candidates",item().candidates),metric("dirs",item().dirs),metric("warnings",item().errors)].join(" · ")}</p>
          <Show when={item().sample?.length}>
            <details><summary>{t("candidates")} ({number(item().sample.length)})</summary><pre dir="ltr" style={{"white-space":"pre-wrap","overflow-wrap":"anywhere"}}>{item().sample.join("\n")}</pre></details>
          </Show>
        </div>;
      }
      return <ui.SettingsLayout title={t("title")} description={t("description")}>
        <Show when={error()}><p role="alert">{t("common.requestFailed")}: {error()}</p><ui.Button onClick={()=>run(load)}>{t("common.retry")}</ui.Button></Show>
        <ui.SettingsSection title={t("updates")}>
          <ui.SettingsRow id="updates" title={<span style={{display:"inline-flex","align-items":"center",gap:"4px"}}>{t("settings.about.version",{version:metadata.version})}<Help name="updates"/></span>} description={updateDescription()}>
            <select aria-label={t("updates")} disabled={updateDisabled()} value={updates()?.mode??"notify"} onChange={e=>update(client=>client.setMode({mode:e.currentTarget.value}))}>
              <option value="notify">{t("notify")}</option><option value="auto">{t("automatic")}</option><option value="manual">{t("manual")}</option>
            </select>
            <ui.Button disabled={updateDisabled()} onClick={()=>update(client=>client.check({}))}>{t("settings.plugins.check")}</ui.Button>
            <Show when={updates()?.version&&["available","error"].includes(updates()?.state)}>
              <ui.Button disabled={updateBusy()} onClick={()=>update(client=>client.install({}))}>{t("settings.plugins.update")}</ui.Button>
            </Show>
          </ui.SettingsRow>
        </ui.SettingsSection>
        <Show when={config()} fallback={<Show when={!error()}><ui.Loader/></Show>}>
          <ui.SettingsSection title={t("policy")}>
            <For each={flags}>{key=><ui.SettingsRow id={key} title={<ParameterTitle name={key}/>}><ui.Switch label={t(key)} hideLabel checked={config()[key]} onChange={value=>change(key,value)}/></ui.SettingsRow>}</For>
            <For each={numbers}>{key=><ui.SettingsRow id={key} title={<ParameterTitle name={key}/>}><input aria-label={t(key)} type="number" min="1" max={max(key)} step="1" value={Number.isFinite(config()[key])?config()[key]:""} onInput={e=>change(key,e.currentTarget.valueAsNumber)}/></ui.SettingsRow>}</For>
            <ui.SettingsRow title={t("policy")}><ui.Button disabled={busy()||!valid()||!dirty()} onClick={()=>run(async()=>{const policy=await call().save(config());setConfig({...policy});setSaved(policy);setConfirm(false);})}>{t("common.save")}</ui.Button></ui.SettingsRow>
          </ui.SettingsSection>
          <ui.SettingsSection title={t("storage")}>
            <For each={rows()}>{row=><ui.SettingsRow title={row.name==="Legacy root files"?t("legacy"):row.name} description={[t("palette.group.files")+": "+number(row.files),number(row.bytes/1048576)+" MiB",...(row.errors?[metric("warnings",row.errors)]:[])].join(" · ")}>{t(row.protected?"protected":"inactive")}</ui.SettingsRow>}</For>
            <ui.SettingsRow title={t("storage")}><ui.Button disabled={busy()} onClick={()=>run(refresh)}>{t("settings.plugins.reload")}</ui.Button></ui.SettingsRow>
            <ui.SettingsRow title={t("preview")} description={t("helpDry")}><ui.Button disabled={busy()||dirty()} onClick={()=>run(async()=>{setResult(await call().preview({}));setConfirm(false);await refresh();})}>{t("preview")}</ui.Button></ui.SettingsRow>
            <ui.SettingsRow title={t("clean")} description={saved()?.dryRun?t("helpDry"):undefined}><ui.Button disabled={busy()||dirty()} variant="danger" onClick={()=>setConfirm(true)}>{t("clean")}</ui.Button></ui.SettingsRow>
            <Show when={confirm()}><ui.SettingsRow title={t("confirmClean")} description={saved()?.dryRun?t("helpDry"):t("description")}><ui.Button disabled={busy()||dirty()} variant="danger" onClick={()=>run(async()=>{setConfirm(false);setResult(await call().clean({confirmed:true}));await refresh();})}>{t("ui.common.confirm")}</ui.Button><ui.Button onClick={()=>setConfirm(false)}>{t("common.cancel")}</ui.Button></ui.SettingsRow></Show>
            <Show when={result()}><Result record={result()}/></Show>
          </ui.SettingsSection>
          <ui.SettingsSection title={t("history")}>
            <For each={history()}>{item=><ui.SettingsRow title={date(item.time)} description={recordMode(item)+(item.dryRun?" · "+t("dryRun"):"")+" · "+metric("warnings",item.errors)}>{metric("removed",item.files)+" / "+metric("candidates",item.candidates)}</ui.SettingsRow>}</For>
          </ui.SettingsSection>
        </Show>
      </ui.SettingsLayout>;
    }
    if (!SettingsPage) {
      console.warn("[temp-sanitize] SettingsPage API unavailable in this Desktop version");
      return;
    }
    ctx.add(SettingsPage,{
      id:"temporary-files",icon:"server",
      get title(){return t("title");},
      get entries(){return parameterKeys.map(key=>({id:key,title:t(key),description:help(key),keywords:"temp sanitize "+t("title")+" "+t(key)}));},
      render:()=> <Page/>,
    });
    if (Command) ctx.add(Command,()=>({
      id:"open-settings",title:"Temp Sanitize: "+t("title"),
      run:()=>ctx.layout.settings("temporary-files"),
    }));
    console.info("[temp-sanitize] settings page registered",metadata.version);
  }
});
