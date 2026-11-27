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
  maxFiles:positive, legacy:boolean,
});
const row = object({name:string,files:count,bytes:count,protected:boolean,errors:count});
const inventory = object({id:string,time:string,count,files:count,bytes:count,errors:count});
const inventoryPage = object({snapshotId:string,offset:count,items:{type:"array",items:row,maxItems:50}});
const record = object({
  time:string,mode:{type:"string",enum:["automatic","manual","preview"]},dryRun:boolean,
  files:count,dirs:count,candidates:count,errors:count,sample:array(string),
});
const summary = object({id:string,time:string,count,bytes:count,errors:count,legacyCount:count,retentionDays:count,matchesSaved:boolean});
const candidate = object({id:count,path:string,bytes:count,modifiedAt:string});
const page = object({snapshotId:string,offset:count,items:{type:"array",items:candidate,maxItems:50}});
const method = (input, output) => ({input, output, errors:{operation_failed:object({method:string})}});
export const Sanitize = Rpc.define({
  id:"temp-sanitize",
  methods:{
    protocol:method(empty,object({version:string,root:string})),
    settings:method(empty,policy),
    save:method(policy,policy),
    analyze:method(empty,inventory),
    storagePage:method(object({snapshotId:string,offset:count}),inventoryPage),
    preview:method(policy,record),
    clean:method(object({confirmed:{type:"boolean",const:true}}),record),
    history:method(empty,array(record)),
    candidates:method(empty,summary),
    candidatePage:method(object({snapshotId:string,offset:count}),page),
    cleanSelected:method(object({confirmed:{type:"boolean",const:true},snapshotId:string,ids:{type:"array",items:count,minItems:1,maxItems:500,uniqueItems:true}}),record),
  },
  events:{},
});
