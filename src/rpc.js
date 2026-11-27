import { Rpc } from "@opencode/plugin/rpc";
export const Sanitize = Rpc.define({
  id:"temp-sanitize",
  methods:{
    protocol:{input:{type:"object",additionalProperties:false},output:{type:"object",properties:{version:{type:"string"}},required:["version"],additionalProperties:false}},
    settings:{input:{type:"object",additionalProperties:false}},
    save:{input:{type:"object",properties:{enabled:{type:"boolean"},retentionDays:{type:"integer"},intervalMinutes:{type:"integer"},maxBytes:{type:"integer"},maxFiles:{type:"integer"},legacy:{type:"boolean"},dryRun:{type:"boolean"}},required:["enabled","retentionDays","intervalMinutes","maxBytes","maxFiles","legacy","dryRun"],additionalProperties:false}},
    analyze:{input:{type:"object",additionalProperties:false}},
    preview:{input:{type:"object",additionalProperties:false}},
    clean:{input:{type:"object",properties:{confirmed:{const:true}},required:["confirmed"],additionalProperties:false}},
    history:{input:{type:"object",additionalProperties:false}}
  }
});
