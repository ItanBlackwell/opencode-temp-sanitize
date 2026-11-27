// Only owns the Temp Sanitize control. Never moves Usage Dashboard or OpenCode nodes.
export const INDICATOR_SIZE=32;
export const INDICATOR_GAP=7;
export const INDICATOR_COLOR="#e4ad59";
const SIDEBAR='aside[data-slot="vertical-tabs-sidebar"]';
const MOUNT=SIDEBAR+' [data-slot="vertical-tabs-mount"]';
const USAGE='[data-pv-usage-trigger]';
const USAGE_WRAPPER='[data-pv-usage-sidebar]';
const FOOTER='[data-slot="vertical-tabs-footer"]';
const UPDATE='[data-slot="titlebar-update"]';
const TOP='[data-slot="titlebar-tabs"]';

export function sidebarPortal(doc){
  const mount=doc.querySelector(MOUNT);
  return Array.from(mount?.children??[]).find(child=>child.classList?.contains("size-full")&&child.classList?.contains("flex-col"))??null;
}
function rect(el){
  if(!el?.isConnected||!el.getClientRects?.().length||typeof el.getBoundingClientRect!=="function")return null;
  const r=el.getBoundingClientRect();
  return r.width>0&&r.height>0&&[r.left,r.right,r.top,r.bottom].every(Number.isFinite)?r:null;
}
export function inlinePlacement(frame,anchor,neighbors=[],size=INDICATOR_SIZE,gap=INDICATOR_GAP){
  if(!frame||!anchor)return null;
  const center=(anchor.top+anchor.bottom)/2;
  let right=anchor.right;
  for(const n of neighbors){
    if(n&&n.top<center+size/2&&n.bottom>center-size/2)right=Math.max(right,n.right);
  }
  const left=Math.round(right+gap),top=Math.round(center-size/2);
  if(left<frame.left||left+size>frame.right-3||top<frame.top||top+size>frame.bottom)return null;
  return {left,top};
}
export function indicatorGraphic(doc){
  const ns="http://www.w3.org/2000/svg";
  const svg=doc.createElementNS(ns,"svg");
  for(const [k,v] of Object.entries({viewBox:"0 0 50 50",width:28,height:28,"aria-hidden":"true",fill:"none"}))svg.setAttribute(k,String(v));
  const add=(tag,attrs)=>{const node=doc.createElementNS(ns,tag);for(const [k,v] of Object.entries(attrs))node.setAttribute(k,String(v));svg.appendChild(node);};
  add("circle",{cx:25,cy:25,r:22,stroke:INDICATOR_COLOR,"stroke-width":6});
  add("path",{d:"M15 18h20 M21 18v-3a3 3 0 0 1 3-3h2a3 3 0 0 1 3 3v3 M17 22l1.5 13a3 3 0 0 0 3 3h7a3 3 0 0 0 3-3L33 22 M22 23v9 M28 23v9",stroke:"currentColor","stroke-width":2.6,"stroke-linecap":"round","stroke-linejoin":"round"});
  return svg;
}
export function attachIndicator({read,open,label,signal,doc=globalThis.document,win=globalThis.window,pollMs=5000}){
  if(!doc?.body||!win)return {refresh:()=>{},dispose:()=>{}};
  const wrapper=doc.createElement("div");
  wrapper.setAttribute("data-temp-sanitize-indicator","true");
  const button=doc.createElement("button");
  button.type="button";
  button.style.cssText="box-sizing:border-box;width:32px;height:32px;min-width:32px;display:flex;align-items:center;justify-content:center;cursor:pointer;flex-shrink:0;border-radius:50%;background:transparent;color:var(--v2-text-text-base,currentColor);border:0;padding:0;appearance:none";
  button.appendChild(indicatorGraphic(doc));wrapper.appendChild(button);
  let state,disposed=false,reading=false,again=false,timer,scheduled,observer,geometryObserver;
  let observedGeometry=[];
  let placementKey="",parent=null;
  function hide(){wrapper.remove();parent=null;placementKey="";geometryObserver?.disconnect();observedGeometry=[];}
  function place(target,css,key){
    if(disposed||!state?.visible||!target){hide();return;}
    if(parent!==target||wrapper.parentNode!==target){target.appendChild(wrapper);parent=target;}
    if(placementKey!==key){wrapper.style.cssText=css;placementKey=key;}
    const title=label(state);button.title=title;button.setAttribute("aria-label",title);
  }
  const fixed=(point)=>place(doc.body,"position:fixed;display:flex;align-items:center;justify-content:center;width:32px;height:32px;z-index:34;left:"+point.left+"px;top:"+point.top+"px","fixed:"+point.left+":"+point.top);
  function observeGeometry(nodes){
    if(!geometryObserver)return;
    const next=nodes.filter(Boolean);
    if(next.length===observedGeometry.length&&next.every((node,i)=>node===observedGeometry[i]))return;
    geometryObserver.disconnect();observedGeometry=next;
    for(const node of next)geometryObserver.observe(node,{attributes:true,attributeFilter:["style","class","hidden"]});
  }
  function layout(){
    scheduled=undefined;
    if(disposed||!state?.visible||signal?.aborted){hide();return;}
    const portal=sidebarPortal(doc);
    if(portal){
      const portalFrame=rect(portal);
      if(!portalFrame){hide();return;}
      const sidebar=doc.querySelector(SIDEBAR),sidebarFrame=rect(sidebar);
      const frame=sidebarFrame?{left:Math.max(portalFrame.left,sidebarFrame.left),right:Math.min(portalFrame.right,sidebarFrame.right),top:Math.max(portalFrame.top,sidebarFrame.top),bottom:Math.min(portalFrame.bottom,sidebarFrame.bottom)}:portalFrame;
      const usageNode=portal.querySelector(USAGE);
      const nativeNodes=Array.from(portal.querySelectorAll(FOOTER+" "+UPDATE));
      observeGeometry([portal,sidebarFrame?sidebar:null,usageNode,...nativeNodes]);
      const usage=rect(usageNode);
      const native=nativeNodes.map(rect).filter(Boolean);
      // If Usage Dashboard docked its updater, reserve the actual occupied space.
      // A later/earlier plugin mount is handled by the next layout sync.
      const anchor=usage??native.at(-1);
      const point=inlinePlacement(frame,anchor,native);
      if(point){fixed(point);return;}
      // Narrow or collapsed sidebar: own row only; never restyle the other controls.
      if(frame.right-frame.left<40){hide();return;}
      place(portal,"box-sizing:border-box;flex:0 0 auto;min-height:36px;display:flex;align-items:center;justify-content:flex-start;padding:2px 4px;"+(usage?"":"margin-top:auto;"),usage?"row":"standalone-row");
      return;
    }
    if(doc.querySelector(SIDEBAR)){hide();return;}
    const top=Array.from(doc.querySelectorAll(TOP)).some(el=>!el.closest('[data-slot="mobile-tabs-drawer"]')&&rect(el));
    if(!top){hide();return;}
    const frame={left:0,right:win.innerWidth,top:0,bottom:win.innerHeight};
    const usageNode=doc.querySelector(USAGE_WRAPPER+" "+USAGE);
    observeGeometry([usageNode]);
    const usage=rect(usageNode);
    const point=usage?inlinePlacement(frame,usage,[]):{left:16,top:win.innerHeight-48};
    if(point&&point.top>=0&&point.left+32<=frame.right)fixed(point);else hide();
  }
  function scheduleLayout(){if(disposed||scheduled!==undefined||!state?.visible)return;scheduled=win.setTimeout(layout,80);}
  async function refresh(){
    if(disposed)return;
    if(reading){again=true;return;}
    reading=true;
    try{
      const next=await read();
      if(disposed||signal?.aborted)return;
      state=next;
      if(state?.visible)layout();else hide();
    }catch{state=undefined;hide();}
    finally{reading=false;if(again&&!disposed){again=false;void refresh();}}
  }
  function relevant(change){
    const selector=SIDEBAR+","+FOOTER+","+USAGE_WRAPPER+","+TOP;
    return !!(change.target?.closest?.(FOOTER+","+USAGE_WRAPPER)||
      [...(change.addedNodes??[]),...(change.removedNodes??[])].some(node=>node?.matches?.(selector)||node?.querySelector?.(selector)));
  }
  button.addEventListener("click",()=>{if(!disposed&&state?.visible)open();});
  button.addEventListener("mouseenter",()=>{if(state?.visible){const title=label(state);button.title=title;button.setAttribute("aria-label",title);}});
  win.addEventListener("resize",scheduleLayout);
  if(typeof win.MutationObserver==="function"){
    geometryObserver=new win.MutationObserver(()=>scheduleLayout());
    observer=new win.MutationObserver(changes=>{if(state?.visible&&changes.some(relevant))scheduleLayout();});
    observer.observe(doc.body,{childList:true,subtree:true});
  }
  function dispose(){
    if(disposed)return;disposed=true;observer?.disconnect();geometryObserver?.disconnect();win.removeEventListener("resize",scheduleLayout);
    win.clearInterval(timer);if(scheduled!==undefined)win.clearTimeout(scheduled);hide();signal?.removeEventListener("abort",dispose);
  }
  if(signal?.aborted){dispose();return {refresh,dispose};}
  signal?.addEventListener("abort",dispose,{once:true});
  timer=win.setInterval(()=>void refresh(),pollMs);
  void refresh();
  return {refresh,dispose};
}
