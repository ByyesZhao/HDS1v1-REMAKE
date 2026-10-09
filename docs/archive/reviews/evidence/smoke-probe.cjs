// Diagnostic copy of the checked-in smoke fixture, transformed in memory only.
// --stage-only fixes the mock input path; default also fixes the expected count.
const fs=require('node:fs'),path=require('node:path'),{Module}=require('node:module');
const filename=path.resolve(__dirname,'../../../../runtime/plugin-smoke.cjs');
const source=fs.readFileSync(filename,'utf8');
if(!source.includes('stage=input.stage')||!source.includes('requests !== 4'))throw Error('baseline smoke fixture changed');
let probe=source.replace('stage=input.stage','stage=input.context.stage');
if(!process.argv.includes('--stage-only'))probe=probe.replace('requests !== 4','requests !== 3').replace('expected four daily environment steps, received','expected three model calls for an empty week, received');
const m=new Module(filename,module);m.filename=filename;m.paths=Module._nodeModulePaths(path.dirname(filename));m._compile(probe,filename);

