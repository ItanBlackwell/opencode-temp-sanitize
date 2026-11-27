import { Plugin, SettingsPage, Ipc, Command } from "@opencode/plugin/gui";
import { createSignal, createEffect, onMount, onCleanup, Show, For } from "solid-js";
import { Sanitize } from "./rpc.js";
import { Schema } from "effect";
import { createUpdater } from "./desktop-updater.js";
import metadata from "../package.json";
import { i18n, parameterKeys, helpKeys } from "./i18n.js";
import { GIB, advancedKeys, labelKeys, maxValue, displayValue, storedValue, validPolicy, summarizeRows, formatStorage } from "./compact-view.js";
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
    const locale=()=>ctx.locale.locale();
    const number=value=>new Intl.NumberFormat(locale(),{maximumFractionDigits:1}).format(value);
    const date=value=>new Date(value).toLocaleString(locale());
    const label=key=>t(labelKeys[key]??key);
    const help=key=>t(helpKeys[key]);
    const metric=(key,value)=>t(key)+": "+number(value);
    function Help(props){
      return <ui.Tooltip placement="top" value={<span style={{"max-width":"280px","white-space":"normal","overflow-wrap":"anywhere",display:"block"}} dir={ctx.locale.direction?.()??"auto"}>{help(props.name)}</span>}>
        <button type="button" aria-label={label(props.name)+": "+help(props.name)}
          style={{display:"inline-flex",border:"0",background:"transparent",color:"var(--text-weak, currentColor)",cursor:"help","font-size":"14px","line-height":"1",padding:"3px","align-items":"center"}}>
          <span aria-hidden="true">ⓘ</span>
        </button>
      </ui.Tooltip>;
    }
    function ParameterTitle(props){
      return <span style={{display:"inline-flex","align-items":"center",gap:"4px","flex-wrap":"wrap"}}>{label(props.name)}<Help name={props.name}/></span>;
    }
    function Page(props){
      const [config,setConfig]=createSignal();
      const [saved,setSaved]=createSignal();
      const [busy,setBusy]=createSignal(false);
      const [error,setError]=createSignal("");
      const [rows,setRows]=createSignal();
      const [result,setResult]=createSignal();
      const [history,setHistory]=createSignal([]);
      const [confirm,setConfirm]=createSignal(false);
      const [advanced,setAdvanced]=createSignal(advancedKeys.includes(props.target));
      const [updates,setUpdates]=createSignal();
      const [updateBusy,setUpdateBusy]=createSignal(false);
      createEffect(()=>{if(advancedKeys.includes(props.target))setAdvanced(true);});
      let active=true;
      let timer;
      onCleanup(()=>{active=false;clearInterval(timer);});
      async function update(action){
        if(updateBusy()||!active)return;
        setUpdateBusy(true);
        try{const response=await action(ctx.main(Updates));if(active)setUpdates(response);}
        catch{if(active)setUpdates(old=>({...old,mode:old?.mode??"notify",state:"error",version:null}));}
        finally{if(active)setUpdateBusy(false);}
      }
      onMount(()=>{
        const poll=()=>void update(client=>client.get({}));
        poll();timer=setInterval(poll,3000);
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
        if(response.version!==metadata.version)throw new Error(t("restart"));
      }
      const run=async(fn)=>{
        if(busy()||!active)return;
        setBusy(true);setError("");
        try{await compatible();if(active)await fn();}
        catch(e){if(active)setError(String(e.message??e));}
        finally{if(active)setBusy(false);}
      };
      const refreshHistory=async()=>{const records=await call().history({});if(active)setHistory(records);};
      const load=async()=>{
        const policy=await call().settings({});
        if(!active)return;
        setConfig({...policy});setSaved(policy);
        await refreshHistory();
      };
      onMount(()=>run(load));
      const change=(key,value)=>{setConfig(old=>({...old,[key]:value}));setConfirm(false);};
      const dirty=()=>!!config()&&!!saved()&&JSON.stringify(config())!==JSON.stringify(saved());
      const valid=()=>validPolicy(config());
      const total=()=>summarizeRows(rows());
      const latest=()=>result()??history()[0];
      const updateDisabled=()=>updateBusy()||!updates()||["unavailable","restart","checking","installing"].includes(updates().state);
      const recordMode=item=>item.mode==="automatic"?t("automatic"):item.mode==="preview"?t("preview"):t("manual");
      const recordSummary=item=>[metric(item.dryRun?"candidates":"removed",item.dryRun?item.candidates:item.files),...(item.errors?[metric("warnings",item.errors)]:[])].join(" · ");
      const rowSummary=row=>[formatStorage(row.bytes,locale()),metric("fileCount",row.files),...(row.errors?[metric("warnings",row.errors)]:[])].join(" · ");
      function updateDescription(){
        const state=updates()?.state;
        if(state==="restart")return t("restart")+" "+(updates()?.version??"");
        if(state==="available")return t("available")+": "+updates().version;
        if(state==="current")return t("current");
        if(state==="error")return t("common.requestFailed");
        if(state==="unavailable")return t("unavailable");
        if(state==="checking"||state==="installing")return t("common.loading");
        return undefined;
      }
      function SwitchRow(props){
        return <ui.SettingsRow id={props.name} title={<ParameterTitle name={props.name}/>}>
          <ui.Switch label={label(props.name)} hideLabel disabled={busy()} checked={config()[props.name]} onChange={value=>change(props.name,value)}/>
        </ui.SettingsRow>;
      }
      function NumberRow(props){
        const size=props.name==="maxBytes";
        const value=()=>displayValue(props.name,config()[props.name]);
        let lastStored=config()[props.name];
        const [raw,setRaw]=createSignal(String(value()));
        createEffect(()=>{
          const next=config()[props.name];
          if(Object.is(next,lastStored))return;
          lastStored=next;setRaw(Number.isFinite(next)?String(value()):"");
        });
        return <ui.SettingsRow id={props.name} title={<ParameterTitle name={props.name}/>}>
          <input aria-label={label(props.name)} type="number" min={size?1/GIB:1} max={size?Number.MAX_SAFE_INTEGER/GIB:maxValue(props.name)} step={size?"any":"1"}
            disabled={busy()} aria-invalid={!Number.isFinite(config()[props.name])} value={raw()} onInput={e=>{setRaw(e.currentTarget.value);lastStored=storedValue(props.name,e.currentTarget.valueAsNumber);change(props.name,lastStored);}}
            style={{width:"92px","max-width":"100%","text-align":"end","font-variant-numeric":"tabular-nums",padding:"4px 6px",border:"1px solid var(--border-weak-base, currentColor)","border-radius":"4px",background:"var(--surface-base, transparent)",color:"inherit"}}/>
        </ui.SettingsRow>;
      }
      function ResultDetails(props){
        const item=()=>props.record;
        return <details style={{"margin-block":"6px","overflow-wrap":"anywhere"}}>
          <summary style={{cursor:"pointer"}}>{t("details")}</summary>
          <p>{date(item().time)} · {recordMode(item())}{item().dryRun?" · "+t("previewOnly"):""}</p>
          <p>{[metric("removed",item().files),metric("candidates",item().candidates),metric("dirs",item().dirs),metric("warnings",item().errors)].join(" · ")}</p>
          <Show when={item().sample?.length}>
            <pre dir="ltr" style={{"max-height":"180px",overflow:"auto","white-space":"pre-wrap","overflow-wrap":"anywhere"}}>{item().sample.join("\n")}</pre>
          </Show>
        </details>;
      }
      async function cleanup(preview){
        const record=await (preview?call().preview({}):call().clean({confirmed:true}));
        if(!active)return;
        setResult(record);setConfirm(false);
        if(!record.dryRun)setRows(undefined);
        await refreshHistory();
      }
      const scan=async()=>{const data=await call().analyze({});if(active)setRows(data);};
      return <ui.SettingsLayout title={t("title")} description={t("description")}>
        <Show when={error()}>
          <div role="alert" style={{display:"flex","flex-wrap":"wrap","align-items":"center",gap:"8px"}}>
            <span>{t("common.requestFailed")}</span>
            <ui.Button size="small" onClick={()=>run(load)} disabled={busy()}>{t("common.retry")}</ui.Button>
            <details style={{width:"100%","overflow-wrap":"anywhere"}}><summary>{t("details")}</summary><p>{error()}</p></details>
          </div>
        </Show>
        <Show when={config()} fallback={<Show when={!error()}><ui.Loader/></Show>}>
          <ui.SettingsSection title={t("policy")}>
            <SwitchRow name="enabled"/>
            <NumberRow name="retentionDays"/>
            <SwitchRow name="dryRun"/>
            <Show when={dirty()&&!advanced()}>
              <ui.SettingsRow title={t("policy")}>
                <ui.Button size="small" disabled={busy()} onClick={()=>{setConfig({...saved()});setConfirm(false);}}>{t("common.cancel")}</ui.Button>
                <ui.Button size="small" variant="contrast" disabled={busy()||!valid()} onClick={()=>run(async()=>{const policy=await call().save(config());if(active){setConfig({...policy});setSaved(policy);setConfirm(false);setResult(undefined);}})}>{t("common.save")}</ui.Button>
              </ui.SettingsRow>
            </Show>
          </ui.SettingsSection>
          <ui.SettingsSection title={t("storage")}>
            <ui.SettingsRow title={t("scanned")} description={total()?.errors?metric("warnings",total().errors):undefined}>
              <span style={{"font-variant-numeric":"tabular-nums","white-space":"nowrap"}}>{total()?formatStorage(total().bytes,locale()):"—"}</span>
              <ui.Button size="small" busy={busy()} onClick={()=>run(scan)}>{t("scan")}</ui.Button>
            </ui.SettingsRow>
            <ui.SettingsRow title={t(saved()?.dryRun?"previewOnly":"manual")}>
              <ui.Button size="small" variant={saved()?.dryRun?"contrast":"neutral"} disabled={busy()||dirty()} onClick={()=>run(()=>cleanup(true))}>{t("preview")}</ui.Button>
              <Show when={!saved()?.dryRun}>
                <ui.Button size="small" variant="danger" disabled={busy()||dirty()} onClick={()=>setConfirm(true)}>{t("clean")}</ui.Button>
              </Show>
            </ui.SettingsRow>
            <Show when={confirm()&&!saved()?.dryRun&&!dirty()}>
              <ui.SettingsRow title={t("confirmClean")} description={t("description")}>
                <ui.Button size="small" onClick={()=>setConfirm(false)} disabled={busy()}>{t("common.cancel")}</ui.Button>
                <ui.Button size="small" variant="danger" disabled={busy()} onClick={()=>run(()=>cleanup(false))}>{t("clean")}</ui.Button>
              </ui.SettingsRow>
            </Show>
            <Show when={latest()}>{item=><ui.SettingsRow title={recordMode(item())+(item().dryRun?" · "+t("previewOnly"):"")} description={date(item().time)}>{recordSummary(item())}</ui.SettingsRow>}</Show>
          </ui.SettingsSection>
          <details open={advanced()} onToggle={e=>setAdvanced(e.currentTarget.open)} style={{"margin-block":"4px"}}>
            <summary style={{cursor:"pointer","font-weight":"500",padding:"8px 0"}}>{t("advanced")}</summary>
            <ui.SettingsSection>
              <NumberRow name="intervalMinutes"/>
              <NumberRow name="maxBytes"/>
              <NumberRow name="maxFiles"/>
              <SwitchRow name="legacy"/>
              <ui.SettingsRow id="updates" title={<ParameterTitle name="updates"/>}>
                <ui.Select label={t("updates")} disabled={updateDisabled()} value={updates()?.mode??"notify"} options={[{value:"notify",label:t("notify")},{value:"auto",label:t("automatic")},{value:"manual",label:t("manual")}]} onChange={mode=>update(client=>client.setMode({mode}))}/>
              </ui.SettingsRow>
              <Show when={dirty()}><ui.SettingsRow title={t("policy")}><ui.Button size="small" disabled={busy()} onClick={()=>{setConfig({...saved()});setConfirm(false);}}>{t("common.cancel")}</ui.Button><ui.Button size="small" variant="contrast" disabled={busy()||!valid()} onClick={()=>run(async()=>{const policy=await call().save(config());if(active){setConfig({...policy});setSaved(policy);setConfirm(false);setResult(undefined);}})}>{t("common.save")}</ui.Button></ui.SettingsRow></Show>
            </ui.SettingsSection>
            <Show when={rows()?.length}>
              <details><summary style={{cursor:"pointer",padding:"8px 0"}}>{t("storage")} · {t("details")}</summary>
                <ui.SettingsSection>
                  <For each={rows()}>{row=><ui.SettingsRow title={row.name==="Legacy root files"?t("legacy"):row.name} description={rowSummary(row)}>{t(row.protected?"protected":"inactive")}</ui.SettingsRow>}</For>
                </ui.SettingsSection>
              </details>
            </Show>
            <Show when={latest()}>
              <ResultDetails record={latest()}/>
            </Show>
            <Show when={history().length}>
              <details><summary style={{cursor:"pointer",padding:"8px 0"}}>{t("history")} ({number(history().length)})</summary>
                <ui.SettingsSection><For each={history()}>{item=><ui.SettingsRow title={date(item.time)} description={recordMode(item)+(item.dryRun?" · "+t("previewOnly"):"")}>{recordSummary(item)}</ui.SettingsRow>}</For></ui.SettingsSection>
              </details>
            </Show>
          </details>
        </Show>
        <ui.SettingsSection>
          <ui.SettingsRow title={t("updates")+" · v"+metadata.version} description={updateDescription()}>
            <ui.Button size="small" disabled={updateDisabled()} onClick={()=>update(client=>client.check({}))}>{t("check")}</ui.Button>
            <Show when={updates()?.version&&["available","error"].includes(updates()?.state)}>
              <ui.Button size="small" variant="contrast" disabled={updateBusy()} onClick={()=>update(client=>client.install({}))}>{t("installUpdate")}</ui.Button>
            </Show>
          </ui.SettingsRow>
        </ui.SettingsSection>
      </ui.SettingsLayout>;
    }
    if (!SettingsPage) {
      console.warn("[temp-sanitize] SettingsPage API unavailable in this Desktop version");
      return;
    }
    ctx.add(SettingsPage,()=>({
      id:"temporary-files",icon:"server",title:t("title"),
      entries:parameterKeys.map(key=>({id:key,title:label(key),description:help(key),keywords:"temp sanitize "+t("title")+" "+label(key)})),
      render:input=> <Page target={input?.target}/>,
    }));
    if (Command) ctx.add(Command,()=>({
      id:"open-settings",title:"Temp Sanitize: "+t("title"),
      run:()=>ctx.layout.settings("temporary-files"),
    }));
    console.info("[temp-sanitize] settings page registered",metadata.version);
  }
});
