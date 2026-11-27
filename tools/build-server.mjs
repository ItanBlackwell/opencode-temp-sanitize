import { build } from "esbuild";
await build({entryPoints:["index.js"],bundle:true,platform:"node",target:"node22",format:"esm",outfile:"dist/server.mjs"});
