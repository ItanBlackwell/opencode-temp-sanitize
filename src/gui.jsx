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
    const help=key=>key==="enabled"?t("helpEnabled")+" "+t("helpScanOnly"):t(helpKeys[key]);
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
    function Actions(props){return <div style={{display:"flex","flex-wrap":"wrap","align-items":"center","justify-content":"flex-end",gap:"8px","min-width":"0"}}>{props.children}</div>;}
    function Page(props){
      const [config,setConfig]=createSignal();
      const [saved,setSaved]=createSignal();
      const [busy,setBusy]=createSignal(false);
      const [error,setError]=createSignal("");
      const [rows,setRows]=createSignal();
      const [scanRoot,setScanRoot]=createSignal("");
      const [result,setResult]=createSignal();
      const [previewPolicy,setPreviewPolicy]=createSignal();
      const [history,setHistory]=createSignal([]);
      const [confirm,setConfirm]=createSignal(false);
      const [snapshot,setSnapshot]=createSignal();
      const [page,setPage]=createSignal();
      const [listOpen,setListOpen]=createSignal(false);
      const [selection,setSelection]=createSignal(new Set());
      const [selectionNotice,setSelectionNotice]=createSignal(false);
      let epoch=0,polling=false;
      let candidateTimer;
      const [advanced,setAdvanced]=createSignal(advancedKeys.includes(props.target));
      const [updates,setUpdates]=createSignal();
      const [updateBusy,setUpdateBusy]=createSignal(false);
      createEffect(()=>{if(advancedKeys.includes(props.target))setAdvanced(true);});
      let active=true;
      let timer;
      onCleanup(()=>{active=false;epoch++;clearInterval(timer);clearInterval(candidateTimer);});
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
        candidateTimer=setInterval(()=>void pollCandidates(),5000);
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
        if(active){if(scanRoot()&&scanRoot()!==response.root)setRows(undefined);setScanRoot(response.root);}
      }
      const run=async(fn)=>{
        if(busy()||!active)return;
        epoch++;setBusy(true);setError("");
        try{await compatible();if(active)await fn();}
        catch(e){if(active)setError(String(e.message??e));}
        finally{if(active)setBusy(false);}
      };
      const refreshHistory=async()=>{const records=await call().history({});if(active)setHistory(records);};
      const load=async()=>{
        const policy=await call().settings({});
        if(!active)return;
        setConfig({...policy});setSaved(policy);setResult(undefined);setPreviewPolicy(undefined);
        await refreshHistory();
        await refreshCandidates();
      };
      onMount(()=>run(load));
      const clearResult=()=>{setResult(undefined);setPreviewPolicy(undefined);};
      const change=(key,value)=>{setConfig(old=>({...old,[key]:value}));setConfirm(false);clearResult();setSelection(new Set());setSelectionNotice(false);};
      const dirty=()=>!!config()&&!!saved()&&JSON.stringify(config())!==JSON.stringify(saved());
      const valid=()=>validPolicy(config());
      const cancelChanges=()=>{if(busy()||!dirty())return;setConfig({...saved()});setConfirm(false);clearResult();setSelection(new Set());return run(refreshCandidates);};
      const saveChanges=()=>{if(busy()||!dirty()||!valid())return;return run(async()=>{const policy=await call().save({...config()});if(active){setConfig({...policy});setSaved(policy);setConfirm(false);clearResult();await refreshCandidates();}});};
      const total=()=>summarizeRows(rows());
      const selectionCount=()=>selection().size;
      const canSelect=()=>!busy()&&!dirty()&&snapshot()?.matchesSaved===true;
      const pageItems=()=>page()?.items??[];
      const pageAll=()=>pageItems().length>0&&pageItems().every(item=>selection().has(item.id));
      const pageNew=()=>pageItems().filter(item=>!selection().has(item.id)).length;
      const clearSelection=()=>{setSelection(new Set());setConfirm(false);};
      function choose(id,checked){
        if(!canSelect())return;
        setSelection(previous=>{const next=new Set(previous);if(checked){if(next.size<500)next.add(id);}else next.delete(id);return next;});
        setConfirm(false);setSelectionNotice(false);
      }
      function choosePage(checked){
        if(!canSelect())return;
        const next=new Set(selection());
        if(checked&&next.size+pageNew()>500)return;
        for(const item of pageItems())checked?next.add(item.id):next.delete(item.id);
        setSelection(next);setConfirm(false);setSelectionNotice(false);
      }
      async function fetchPage(offset,token=epoch){
        const id=snapshot()?.id;
        if(!id)return;
        const response=await call().candidatePage({snapshotId:id,offset});
        if(active&&token===epoch&&snapshot()?.id===id)setPage(response);
      }
      async function refreshCandidates(token=epoch){
        const next=await call().candidates({});
        if(!active||token!==epoch)return;
        if(snapshot()?.id===next.id){setSnapshot(next);if(listOpen()&&next.id&&next.count&&!page())await fetchPage(0,token);return;}
        if(selectionCount())setSelectionNotice(true);
        clearSelection();setPage(undefined);setSnapshot(next);
        if(listOpen()&&next.id&&next.count)await fetchPage(0,token);
      }
      async function pollCandidates(){
        if(!active||busy()||dirty()||!config()||polling)return;
        polling=true;
        const token=epoch;
        try{await refreshCandidates(token);}catch{}finally{polling=false;}
      }
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
          <p>{date(item().time)} · {recordMode(item())}{item().dryRun&&item().mode!=="preview"?" · "+t("previewOnly"):""}</p>
          <p>{[metric("removed",item().files),metric("candidates",item().candidates),metric("dirs",item().dirs),metric("warnings",item().errors)].join(" · ")}</p>
          <Show when={item().sample?.length}>
            <pre dir="ltr" style={{"max-height":"180px",overflow:"auto","white-space":"pre-wrap","overflow-wrap":"anywhere"}}>{item().sample.join("\n")}</pre>
          </Show>
        </details>;
      }
      async function cleanup(mode){
        const draft=mode==="preview"?{...config()}:undefined;
        if(mode==="preview"&&!validPolicy(draft))return;
        if(mode!=="preview"&&(dirty()||confirm()!==mode))return;
        const selectedIds=[...selection()];
        const id=snapshot()?.id;
        if(mode==="selected"&&(!id||!selectedIds.length||!snapshot()?.matchesSaved))return;
        const record=await (mode==="preview"?call().preview(draft):mode==="selected"?call().cleanSelected({confirmed:true,snapshotId:id,ids:selectedIds}):call().clean({confirmed:true}));
        if(!active)return;
        setResult(record);setPreviewPolicy(draft);clearSelection();setSelectionNotice(false);
        if(!record.dryRun)setRows(undefined);
        await refreshHistory();await refreshCandidates();
      }
      const scan=async()=>{setRows(undefined);const data=await call().analyze({});if(active)setRows(data);};
      return <ui.SettingsLayout title={t("title")} description={t("description")} actions={
        <Show when={dirty()}>
          <div style={{display:"flex","flex-direction":"column","align-items":"flex-end",gap:"6px","max-width":"min(240px, 45vw)"}}>
            <span role="status" aria-live="polite" style={{"font-size":"11px","font-weight":"600",color:"var(--v2-text-text-base, currentColor)","text-align":"end","overflow-wrap":"anywhere"}}>{t("unsaved")}</span>
            <div role="group" aria-label={t("unsaved")} style={{display:"flex","flex-wrap":"wrap","justify-content":"flex-end","align-items":"center",gap:"8px"}}>
              <ui.Button size="small" disabled={busy()} onClick={cancelChanges}>{t("common.cancel")}</ui.Button>
              <ui.Button size="small" variant="contrast" disabled={busy()||!valid()} onClick={saveChanges}>{t("common.save")}</ui.Button>
            </div>
          </div>
        </Show>
      }>
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
          </ui.SettingsSection>
          <ui.SettingsSection title={t("storage")}>
            <ui.SettingsRow title={t("scanned")} description={<span style={{"font-variant-numeric":"tabular-nums","overflow-wrap":"anywhere"}}>{total()?formatStorage(total().bytes,locale()):"—"}{total()?.errors?" · "+metric("warnings",total().errors):""}</span>}>
              <div style={{"padding-inline-start":"12px","flex-shrink":"0"}}><ui.Button size="small" busy={busy()} onClick={()=>run(scan)}>{t("scan")}</ui.Button></div>
            </ui.SettingsRow>
            <ui.SettingsRow title={t("preview")}>
              <Actions>
                <ui.Button size="small" variant="neutral" disabled={busy()||!valid()} onClick={()=>run(()=>cleanup("preview"))}>{t("preview")}</ui.Button>
                <ui.Button size="small" variant="danger" disabled={busy()||dirty()} onClick={()=>setConfirm("all")}>{t("clean")}</ui.Button>
              </Actions>
            </ui.SettingsRow>
            <Show when={confirm()==="all"&&!dirty()}>
              <ui.SettingsRow title={t("confirmClean")} description={t("description")}>
                <Actions><ui.Button size="small" onClick={()=>setConfirm(false)} disabled={busy()}>{t("common.cancel")}</ui.Button>
                <ui.Button size="small" variant="danger" disabled={busy()} onClick={()=>run(()=>cleanup("all"))}>{t("clean")}</ui.Button></Actions>
              </ui.SettingsRow>
            </Show>
            <Show when={latest()}>{item=><ui.SettingsRow title={recordMode(item())+(item().dryRun&&item().mode!=="preview"?" · "+t("previewOnly"):"")} description={date(item().time)+(item()===result()&&previewPolicy()?" · "+label("retentionDays")+": "+number(previewPolicy().retentionDays):"")}>{recordSummary(item())}</ui.SettingsRow>}</Show>
          </ui.SettingsSection>
          <Show when={snapshot()?.id}>
            <ui.SettingsSection title={t("candidates")}>
              <ui.SettingsRow title={metric("fileCount",snapshot().count)} description={formatStorage(snapshot().bytes,locale())+" · "+label("retentionDays")+": "+number(snapshot().retentionDays)+" · "+date(snapshot().time)+(snapshot().errors?" · "+metric("warnings",snapshot().errors):"")}>
                <ui.Button size="small" variant="neutral" disabled={busy()} onClick={()=>{const open=!listOpen();setListOpen(open);if(open&&!page()&&snapshot().count)void run(()=>fetchPage(0));}}>{t("details")}</ui.Button>
              </ui.SettingsRow>
              <Show when={snapshot().legacyCount>0}><ui.SettingsRow title={t("legacy")} description={t("helpLegacy")}>{number(snapshot().legacyCount)}</ui.SettingsRow></Show>
              <Show when={selectionNotice()}><ui.SettingsRow title={t("selectionChanged")}/></Show>
              <Show when={listOpen()&&snapshot().count>0}>
                <ui.SettingsRow title={metric("selected",selectionCount())+" / 500"} description={dirty()?t("unsaved"):!snapshot()?.matchesSaved?t("preview"):undefined}>
                  <Actions>
                    <ui.Button size="small" disabled={busy()||!selectionCount()} onClick={clearSelection}>{t("common.cancel")}</ui.Button>
                    <ui.Button size="small" variant="danger" disabled={!canSelect()||!selectionCount()} onClick={()=>setConfirm("selected")}>{t("cleanSelected")}</ui.Button>
                  </Actions>
                </ui.SettingsRow>
                <Show when={confirm()==="selected"&&!dirty()&&snapshot()?.matchesSaved&&selectionCount()>0}>
                  <ui.SettingsRow title={t("confirmClean")} description={metric("selected",selectionCount())}>
                    <Actions><ui.Button size="small" disabled={busy()} onClick={()=>setConfirm(false)}>{t("common.cancel")}</ui.Button>
                    <ui.Button size="small" variant="danger" disabled={busy()} onClick={()=>run(()=>cleanup("selected"))}>{t("cleanSelected")}</ui.Button></Actions>
                  </ui.SettingsRow>
                </Show>
                <Show when={page()} fallback={<div style={{padding:"12px"}}><ui.Loader/></div>}>
                  <div style={{display:"flex","align-items":"center","justify-content":"space-between","flex-wrap":"wrap",gap:"8px",padding:"8px 0"}}>
                    <label style={{display:"flex","align-items":"center",gap:"8px"}}><input type="checkbox" checked={pageAll()} disabled={!canSelect()||(!pageAll()&&selectionCount()+pageNew()>500)} onChange={e=>choosePage(e.currentTarget.checked)}/>{t("selectPage")}</label>
                    <Actions>
                      <button type="button" aria-label={t("common.goBack")} disabled={busy()||page().offset===0} style={{padding:"4px 10px",cursor:"pointer"}} onClick={()=>run(()=>fetchPage(Math.max(0,page().offset-50)))}>‹</button>
                      <span style={{"font-variant-numeric":"tabular-nums","font-size":"12px"}}>{number(page().offset+1)}–{number(page().offset+pageItems().length)} / {number(snapshot().count)}</span>
                      <button type="button" aria-label={t("common.goForward")} disabled={busy()||page().offset+50>=snapshot().count} style={{padding:"4px 10px",cursor:"pointer"}} onClick={()=>run(()=>fetchPage(page().offset+50))}>›</button>
                    </Actions>
                  </div>
                  <div style={{"max-height":"320px","overflow-y":"auto","min-width":"0"}}>
                    <For each={pageItems()}>{item=><label title={item.path+" · "+date(item.modifiedAt)} style={{display:"flex","align-items":"center",gap:"8px",padding:"5px 0",borderBottom:"1px solid var(--v2-border-border-muted, transparent)","min-width":"0",cursor:"pointer"}}>
                      <input type="checkbox" aria-label={item.path} checked={selection().has(item.id)} disabled={!canSelect()||(!selection().has(item.id)&&selectionCount()>=500)} onChange={e=>choose(item.id,e.currentTarget.checked)} style={{"flex-shrink":"0"}}/>
                      <span dir="ltr" style={{flex:"1","min-width":"0",overflow:"hidden","text-overflow":"ellipsis","white-space":"nowrap","font-size":"12px"}}>{item.path}</span>
                      <span style={{"flex-shrink":"0","font-size":"11px","font-variant-numeric":"tabular-nums"}}>{formatStorage(item.bytes,locale())}</span>
                    </label>}</For>
                  </div>
                </Show>
              </Show>
            </ui.SettingsSection>
          </Show>
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
            </ui.SettingsSection>
            <Show when={scanRoot()}>
              <div dir="ltr" style={{"font-size":"12px",color:"var(--text-weak, currentColor)","overflow-wrap":"anywhere","margin-block":"6px"}}>{scanRoot()}</div>
            </Show>
            <Show when={rows()?.length}>
              <details><summary style={{cursor:"pointer",padding:"8px 0"}}>{t("storage")} · {t("details")}</summary>
                <ui.SettingsSection>
                  <For each={rows()}>{row=><ui.SettingsRow title={row.name==="Legacy root files"?"/":row.name} description={rowSummary(row)}>{t(row.protected?"protected":"inactive")}</ui.SettingsRow>}</For>
                </ui.SettingsSection>
              </details>
            </Show>
            <Show when={latest()}>
              <ResultDetails record={latest()}/>
            </Show>
            <Show when={history().length}>
              <details><summary style={{cursor:"pointer",padding:"8px 0"}}>{t("history")} ({number(history().length)})</summary>
                <ui.SettingsSection><For each={history()}>{item=><ui.SettingsRow title={date(item.time)} description={recordMode(item)+(item.dryRun&&item.mode!=="preview"?" · "+t("previewOnly"):"")}>{recordSummary(item)}</ui.SettingsRow>}</For></ui.SettingsSection>
              </details>
            </Show>
          </details>
        </Show>
        <ui.SettingsSection>
          <ui.SettingsRow title={t("updates")+" · v"+metadata.version} description={updateDescription()}>
            <Actions><ui.Button size="small" disabled={updateDisabled()} onClick={()=>update(client=>client.check({}))}>{t("check")}</ui.Button>
            <Show when={updates()?.version&&["available","error"].includes(updates()?.state)}>
              <ui.Button size="small" variant="contrast" disabled={updateBusy()} onClick={()=>update(client=>client.install({}))}>{t("installUpdate")}</ui.Button>
            </Show></Actions>
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
