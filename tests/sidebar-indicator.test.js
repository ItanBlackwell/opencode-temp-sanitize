import {describe,it,expect,vi} from "vitest";
import {inlinePlacement,attachIndicator,INDICATOR_COLOR} from "../src/sidebar-indicator.js";

const rect=(left,top,width,height)=>({left,top,width,height,right:left+width,bottom:top+height});
describe("sidebar indicator placement",()=>{
  it("fits after Usage Dashboard and the docked native updater",()=>{
    expect(inlinePlacement(rect(0,0,160,500),rect(4,460,32,32),[rect(43,462,28,28)])).toEqual({left:78,top:460});
  });
  it("ignores buttons on other rows and declines narrow layouts",()=>{
    expect(inlinePlacement(rect(0,0,160,500),rect(4,460,32,32),[rect(43,400,28,28)])).toEqual({left:43,top:460});
    expect(inlinePlacement(rect(0,0,100,500),rect(4,460,32,32),[rect(43,462,28,28)])).toBeNull();
    expect(inlinePlacement(rect(0,0,160,500),rect(4,490,32,32),[])).toBeNull();
  });
  it("mounts one control, opens the list, hides when disabled and disposes on abort",async()=>{
    function node(tag,box){
      return {tag,children:[],style:{cssText:""},attrs:{},events:{},parentNode:null,
        get isConnected(){return this===body||!!this.parentNode?.isConnected;},
        getClientRects(){return box?[box]:[];},getBoundingClientRect(){return box;},
        appendChild(child){child.remove();this.children.push(child);child.parentNode=this;return child;},
        remove(){if(this.parentNode){const p=this.parentNode;p.children=p.children.filter(x=>x!==this);this.parentNode=null;}},
        setAttribute(k,v){this.attrs[k]=String(v);},addEventListener(k,v){this.events[k]=v;},
        querySelector(){return null;},querySelectorAll(){return [];}
      };
    }
    const body=node("body"),portal=node("portal",rect(0,0,160,500));
    const usage=node("usage",rect(4,460,32,32)),native=node("update",rect(43,462,28,28));
    body.appendChild(portal);portal.appendChild(usage);portal.appendChild(native);
    portal.classList={contains:()=>true};
    portal.querySelector=()=>usage;portal.querySelectorAll=()=>[native];
    const doc={body,createElement:tag=>node(tag),createElementNS:(_,tag)=>node(tag),querySelector:()=>({children:[portal]})};
    const win={setInterval:vi.fn(()=>1),clearInterval:vi.fn(),setTimeout:vi.fn(()=>2),clearTimeout:vi.fn(),addEventListener:vi.fn(),removeEventListener:vi.fn()};
    const controller=new AbortController();
    let visible=true;
    const open=vi.fn();
    const mounted=attachIndicator({doc,win,signal:controller.signal,open,read:async()=>({visible,count:2,bytes:64}),label:s=>String(s.count)});
    await Promise.resolve();await Promise.resolve();
    const wrapper=body.children.find(x=>x.attrs["data-temp-sanitize-indicator"]);
    expect(wrapper).toBeDefined();
    expect(wrapper.style.cssText).toContain("left:78px");
    const button=wrapper.children[0];
    expect(button.attrs["aria-label"]).toBe("2");
    expect(button.children[0].children[0].attrs.stroke).toBe(INDICATOR_COLOR);
    button.events.click();
    expect(open).toHaveBeenCalledTimes(1);
    await mounted.refresh();
    expect(body.children.filter(x=>x.attrs["data-temp-sanitize-indicator"])).toHaveLength(1);
    visible=false;await mounted.refresh();expect(wrapper.parentNode).toBeNull();
    visible=true;await mounted.refresh();expect(wrapper.parentNode).toBe(body);
    controller.abort();
    expect(wrapper.parentNode).toBeNull();
    expect(win.clearInterval).toHaveBeenCalledWith(1);
    expect(portal.children).toEqual([usage,native]);
    expect(usage.style.cssText).toBe("");expect(native.style.cssText).toBe("");
  });
});
