#!/usr/bin/env node
/** Built app, real browser: the Agents panel manages pi-subagents files in an isolated
 * agent directory holding a fake package (with a package agent and a stand-in for
 * pi-subagents' RPC) and three skills. At 1280 desktop, 390 phone and 1133 touch it
 * creates a global agent, attaches two skills (file reads `skills: alpha, beta`), detaches
 * all (`skills: false`), shows the project override of the package agent, runs the agent,
 * and deletes it. Monkey pass: double Save, rapid checkbox toggles, an edit on disk while
 * the panel is open (conflict, file keeps the external change), and touch sizes/overflow.
 * The written file is then loaded by the installed pi-subagents' own loader when present.
 * Offline fixture, no model calls. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {chromium} from 'playwright';
import {makeWorkspace,startServer} from '../server/test/harness.mjs';
import {installedSubagents} from '../server/test/subagentPackage.mjs';
import {leaveStartScreen} from './leave-start-screen.mjs';

const root=await fs.realpath(await makeWorkspace({'README.md':'readme\n'}));
const agentDir=path.join(root,'.pi-agent');
const home=path.join(root,'home');await fs.mkdir(home);
for(const skill of ['alpha','beta','gamma']){
 await fs.mkdir(path.join(agentDir,'skills',skill),{recursive:true});
 await fs.writeFile(path.join(agentDir,'skills',skill,'SKILL.md'),`---\nname: ${skill}\ndescription: ${skill} skill\n---\n${skill} body\n`);
}
const pkg=path.join(root,'fake-pkg');const spawns=path.join(root,'spawns.jsonl');
await fs.mkdir(path.join(pkg,'agents'),{recursive:true});
await fs.writeFile(path.join(pkg,'package.json'),JSON.stringify({name:'fake-agents-pkg',version:'1.0.0',type:'module',keywords:['pi-package'],pi:{extensions:['./rpc.js'],subagents:{agents:['./agents']}}}));
await fs.writeFile(path.join(pkg,'agents','scout.md'),'---\ndescription: Package scout\ncolor: teal\n---\n\nScout things.\n');
await fs.writeFile(path.join(pkg,'rpc.js'),`import {appendFileSync} from 'node:fs';
export default (pi)=>{
 pi.events.on('subagents:rpc:ping',(d)=>pi.events.emit('subagents:rpc:ping:reply:'+d.requestId,{success:true,data:{version:2}}));
 pi.events.on('subagents:rpc:spawn',(d)=>{appendFileSync(${JSON.stringify(spawns)},JSON.stringify({type:d.type,prompt:d.prompt})+'\\n');pi.events.emit('subagents:rpc:spawn:reply:'+d.requestId,{success:true,data:{id:'fake-1'}});});
};
`);
await fs.writeFile(path.join(agentDir,'settings.json'),JSON.stringify({packages:[pkg]}));
await fs.mkdir(path.join(root,'.pi','agents'),{recursive:true});
await fs.writeFile(path.join(root,'.pi','agents','scout.md'),'---\ndescription: Project scout\n---\n\nScout this repo.\n');

const agentFile=(name)=>path.join(agentDir,'agents',`${name}.md`);
const read=(name)=>fs.readFile(agentFile(name),'utf8');
async function until(check,label,timeout=10000){
 const end=Date.now()+timeout;let last;
 for(;;){try{const v=await check();if(v)return v;}catch(e){last=e}
  if(Date.now()>end)throw new Error(`timed out: ${label}${last?` (${last.message})`:''}`);await new Promise(r=>setTimeout(r,100));}
}

let server,browser;const errors=[];const results=[];
try{
 server=await startServer(root,{sandbox:false},{entry:path.resolve('cli/dist/pi-outpost.mjs'),env:{HOME:home,USERPROFILE:home,PI_OFFLINE:'1',ANTHROPIC_API_KEY:'fixture-no-model-calls'}});
 browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH});
 for(const viewport of [{width:1280,height:800},{width:390,height:844,phone:true},{width:1133,height:744,touch:true}]){
  const {width,phone=false,touch=false}=viewport;const coarse=phone||touch;
  const context=await browser.newContext({viewport:{width,height:viewport.height},hasTouch:coarse,isMobile:false});
  const page=await context.newPage();page.on('pageerror',e=>errors.push(`${width}: ${e.message}`));
  await page.goto(server.base);await leaveStartScreen(page);
  if(phone){await page.getByRole('button',{name:'More controls'}).click();await page.getByTestId('compact-header-more').getByRole('button',{name:'Agents',exact:true}).click();}
  else{
   const opener=page.getByRole('banner').getByRole('button',{name:'Agents',exact:true});
   if(coarse){const b=await opener.boundingBox();assert.ok(b.height>=43.5&&b.width>=43.5,`${width}: Agents button ${b.width}x${b.height}`);}
   await opener.click();
  }
  const panel=page.getByTestId(phone?'agents-sheet':'agents-dialog');
  await panel.getByRole('list',{name:'Agents'}).waitFor();

  // Project override of the package agent, and the package card is read-only.
  const cards=panel.getByTestId('agent-card');
  const pkgCard=cards.filter({hasText:'Package scout'});const projectCard=cards.filter({hasText:'Project scout'});
  await projectCard.getByText('Overrides package').waitFor();
  await pkgCard.getByText('Overridden by project').waitFor();
  assert.equal(await pkgCard.getByRole('button',{name:/^Edit/}).count(),0,`${width}: package agent offers Edit`);
  assert.equal(await pkgCard.getByRole('button',{name:'Copy to global'}).count(),1);

  const name=`helper-${width}`;
  await panel.getByRole('button',{name:'+ New agent'}).click();
  await panel.getByLabel('Agent name').fill(name);
  await panel.getByRole('button',{name:'Create',exact:true}).click();
  await panel.getByRole('heading',{name,exact:true}).waitFor();
  await until(()=>read(name),'created file');

  const skills=panel.getByRole('list',{name:'Skills'});
  const box=(label)=>skills.getByRole('checkbox',{name:new RegExp(`^${label}`)});
  const save=async(expectNotice=true)=>{await panel.getByRole('button',{name:'Save',exact:true}).click();if(expectNotice)await panel.getByText(`Saved ${name}`).waitFor();};
  await panel.getByRole('radio',{name:'Only selected'}).check();
  await box('alpha').check();await box('beta').check();
  await save();
  assert.match(await read(name),/^skills: alpha, beta$/m,`${width}: two skills`);

  await box('alpha').uncheck();await box('beta').uncheck();
  await save();
  assert.match(await read(name),/^skills: false$/m,`${width}: detach all`);
  await panel.getByText(`Saved ${name}`).waitFor({state:'detached'}).catch(()=>{});

  // Monkey: rapid toggles land on the last state; a double Save writes once without a conflict.
  for(let i=0;i<7;i++)await box('gamma').click();
  assert.equal(await box('gamma').isChecked(),true,`${width}: rapid toggles`);
  await panel.getByLabel('Description').fill(`Helper at ${width}`);
  await panel.getByRole('button',{name:'Save',exact:true}).dblclick();
  await panel.getByText(`Saved ${name}`).waitFor();
  const afterDouble=await read(name);
  assert.match(afterDouble,/^skills: gamma$/m);
  assert.match(afterDouble,new RegExp(`^description: Helper at ${width}$`,'m'));
  assert.equal(await panel.getByRole('alert').count(),0,`${width}: double save raised ${await panel.getByRole('alert').allTextContents()}`);

  // Monkey: an edit on disk while the panel is open is a conflict, and the disk wins until reload.
  const external=afterDouble.replace(/^description: .*$/m,'description: edited on disk\nmemory: project');
  await fs.writeFile(agentFile(name),external);
  await panel.getByLabel('Description').fill('panel edit');
  await panel.getByRole('button',{name:'Save',exact:true}).click();
  await panel.getByRole('alert').filter({hasText:'changed on disk'}).waitFor();
  assert.equal(await read(name),external,`${width}: conflict overwrote the external edit`);
  await panel.getByRole('button',{name:'Reload from disk'}).click();
  assert.equal(await panel.getByLabel('Description').inputValue(),'edited on disk');
  await panel.getByText('memory:').waitFor();

  if(width===1280){
   const real=await installedSubagents(agentDir);
   if(real){
    const loaded=real.load(root).get(name);
    assert.ok(loaded,'installed pi-subagents loads the panel-written agent');
    assert.deepEqual(loaded.skills,['gamma']);assert.equal(loaded.memory,'project');assert.equal(loaded.description,'edited on disk');
    results.push({installedPackageLoads:true});
   }else results.push({installedPackageLoads:'skipped: pi-subagents not installed'});
  }

  // Rename keeps file and name in step; Disable from the card writes enabled: false, Enable removes it.
  if(width===1280){
   await panel.getByRole('button',{name:'Rename',exact:true}).click();
   await panel.getByLabel('Agent name').fill(`${name}-r`);
   await panel.getByRole('button',{name:'Rename agent'}).click();
   await panel.getByRole('heading',{name:`${name}-r`,exact:true}).waitFor();
   assert.equal(await fs.access(agentFile(name)).then(()=>true,()=>false),false,'old file left behind');
   assert.match(await read(`${name}-r`),new RegExp(`^name: ${name}-r$`,'m'));
   await fs.rename(agentFile(`${name}-r`),agentFile(name)).then(()=>fs.writeFile(agentFile(name),(external)));
   await panel.getByRole('button',{name:'All agents'}).click();
   await panel.getByRole('button',{name:'Refresh'}).click();
   await panel.getByRole('button',{name:`Disable ${name}`}).click();
   await until(async()=>/^enabled: false$/m.test(await read(name)),'enabled: false');
   await panel.getByRole('button',{name:`Enable ${name}`}).click();
   await until(async()=>!/^enabled:/m.test(await read(name)),'enabled removed');
   await panel.getByRole('button',{name:`Edit ${name} (Global)`}).click();
  }

  // Run through the stand-in RPC on this project's runtime.
  await panel.getByLabel('Run prompt').fill('check README');
  await panel.getByRole('button',{name:'Run',exact:true}).click();
  await panel.getByText('Started as fake-1').waitFor();
  const runs=(await fs.readFile(spawns,'utf8')).trim().split('\n').map(l=>JSON.parse(l));
  assert.deepEqual(runs.at(-1),{type:name,prompt:'check README'});

  // Touch sizes and overflow inside the panel.
  const metrics=await panel.evaluate((el,coarse)=>{
   const vw=document.documentElement.clientWidth;
   const small=coarse?[...el.querySelectorAll('button,label:has(input)')].filter(b=>{const r=b.getBoundingClientRect();return r.width&&r.height&&(r.height<43.5||(b.tagName==='BUTTON'&&r.width<43.5))}).map(b=>`${b.textContent.trim().slice(0,30)} ${Math.round(b.getBoundingClientRect().width)}x${Math.round(b.getBoundingClientRect().height)}`):[];
   const out=[...el.querySelectorAll('*')].filter(n=>{const r=n.getBoundingClientRect();return r.width&&(r.right>vw+0.5||r.left<-0.5)}).length;
   return {small,out,doc:document.documentElement.scrollWidth,vw};
  },coarse);
  assert.deepEqual(metrics.small,[],`${width}: controls below 44px`);
  assert.equal(metrics.out,0,`${width}: ${metrics.out} elements off screen`);
  if(process.env.SHOTS)await page.screenshot({path:path.join(process.env.SHOTS,`agent-manager-${width}.png`),fullPage:false});

  page.once('dialog',d=>d.accept());
  await panel.getByRole('button',{name:'Delete',exact:true}).click();
  await panel.getByRole('list',{name:'Agents'}).waitFor();
  await until(async()=>!(await fs.access(agentFile(name)).then(()=>true,()=>false)),'deleted file');
  assert.equal(await cards.filter({hasText:`Helper at`}).count(),0);
  if(width===1280){
   // Monkey: the file is deleted on disk while its editor is open.
   await panel.getByRole('button',{name:'+ New agent'}).click();
   await panel.getByLabel('Agent name').fill('doomed');
   await panel.getByRole('button',{name:'Create',exact:true}).click();
   await panel.getByRole('heading',{name:'doomed',exact:true}).waitFor();
   await fs.rm(agentFile('doomed'));
   await panel.getByLabel('Description').fill('too late');
   await panel.getByRole('button',{name:'Save',exact:true}).click();
   await panel.getByRole('alert').filter({hasText:'no longer exists'}).waitFor();
   await panel.getByRole('list',{name:'Agents'}).waitFor();
   assert.equal(await fs.access(agentFile('doomed')).then(()=>true,()=>false),false,'a save recreated a deleted file');
  }
  await panel.getByRole('button',{name:'Close agents'}).click();
  await panel.waitFor({state:'detached'});
  results.push({width,skills:['alpha, beta','false','gamma'],conflict:true,run:true,deleted:true,overflow:metrics.out});
  await context.close();
 }
 assert.deepEqual(errors,[]);
 console.log(JSON.stringify({result:'passed',results,errors}));
}catch(error){console.log(server?.log().split('\n').slice(-20).join('\n'));throw error}
finally{await browser?.close();await server?.stop();await fs.rm(root,{recursive:true,force:true})}
