import { Rpc } from "@opencode/plugin/rpc";

const object = (properties) => ({
  type: "object", properties, required: Object.keys(properties), additionalProperties: false,
});
const string = {type:"string"};
const boolean = {type:"boolean"};
const count = {type:"integer", minimum:0};
const positive = {type:"integer", minimum:1, maximum:Number.MAX_SAFE_INTEGER};
const array = (items) => ({type:"array", items});
const empty = object({});
const policy = object({
  enabled:boolean, retentionDays:{...positive,maximum:3650},
  intervalMinutes:{...positive,maximum:1440}, maxBytes:positive,
  maxFiles:positive, legacy:boolean, dryRun:boolean,
});
const row = object({name:string,files:count,bytes:count,protected:boolean,errors:count});
const record = object({
  time:string,mode:{type:"string",enum:["automatic","manual","preview"]},dryRun:boolean,
  files:count,dirs:count,candidates:count,errors:count,sample:array(string),
});
export const Sanitize = Rpc.define({
  id:"temp-sanitize",
  methods:{
    protocol:{input:empty,output:object({version:string})},
    settings:{input:empty,output:policy},
    save:{input:policy,output:policy},
    analyze:{input:empty,output:array(row)},
    preview:{input:empty,output:record},
    clean:{input:object({confirmed:{type:"boolean",const:true}}),output:record},
    history:{input:empty,output:array(record)},
  },
  events:{},
});
