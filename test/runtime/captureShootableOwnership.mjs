import fs from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { ownershipCases, runShootableOwnershipScenario } from './shootableOwnershipScenario.mjs';
// Run from the repository root. The reference directory must contain exact Git source bytes.
const root=process.argv[2];
const destination=process.argv[3];
if(!root || !destination) throw new Error('Usage: node test/runtime/captureShootableOwnership.mjs <exact-main-directory> <output.json>');
const rev='7d796145b9a972f9da5e399a6802e86f8450ea83';
const entry=fs.readFileSync('test/runtime/shootableOwnershipModules.ts','utf8').replaceAll('../../src/',root+'/src/');
const built=await build({stdin:{contents:entry,resolveDir:process.cwd(),loader:'ts'},bundle:true,platform:'node',format:'esm',write:false,metafile:true,logLevel:'silent'});
const inputs=[];
for(const file of Object.keys(built.metafile.inputs)) {
 const absolute=path.resolve(file);
 if(!absolute.startsWith(root+'/src/')) continue;
 const relative=path.relative(root,absolute);
 const bytes=fs.readFileSync(absolute);
 const expected=execFileSync('git',['show',`${rev}:${relative}`],{maxBuffer:16*1024*1024});
 if(!bytes.equals(expected))throw new Error(`Reference source drift: ${relative}`);
 inputs.push({file:relative,sha256:createHash('sha256').update(bytes).digest('hex')});
}
const api=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
const cases=[];
for(const scenario of ownershipCases) { const result=runShootableOwnershipScenario(api,scenario); cases.push(result); console.log(scenario, result.checkpoints.length); }
const output={scenarioSha256:createHash('sha256').update(fs.readFileSync('test/runtime/shootableOwnershipScenario.mjs')).digest('hex'),node:process.version,kind:'cssquake-shootable-main-characterization',reference:rev,scope:'Deterministic controller and mesh publication; mock mesh handles, no native or visual parity claim.',inputs:inputs.sort((a,b)=>a.file.localeCompare(b.file)),cases};
// One checkpoint per line keeps the bound input manifest and scenarios reviewable.
const {cases:capturedCases,...metadata}=output;
const prefix=JSON.stringify(metadata,null,2).slice(0,-2);
const caseJson=capturedCases.map(({checkpoints,...header})=>`    {${JSON.stringify(header).slice(1,-1)},\n      \"checkpoints\": [\n${checkpoints.map(value=>'        '+JSON.stringify(value)).join(',\n')}\n      ]}`).join(',\n');
fs.writeFileSync(destination,prefix+',\n  \"cases\": [\n'+caseJson+'\n  ]\n}\n');
