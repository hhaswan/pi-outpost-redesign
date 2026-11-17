#!/usr/bin/env node
/** Built app, real browser: reloading a tab whose project is not the server's default
 * never shows another conversation on the way back to its own (no default-project
 * flash, no project-main flash under a side session). A selection whose project was
 * closed falls back with the notice. Offline fixture, no model calls; private stores. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {chromium} from 'playwright';
import {SessionManager} from '@earendil-works/pi-coding-agent';
import {connect,makeWorkspace,startServer} from '../server/test/harness.mjs';

const root=await fs.realpath(await makeWorkspace({'a.md':'alpha\n'}));
const other=path.join(root,'project-b');await fs.mkdir(other);
const stores={};for(const name of ['bridges','handoffs','reservations']){stores[name]=path.join(root,name);await fs.mkdir(stores[name],{mode:0o700});}
const usage={input:1,output:1,cacheRead:0,cacheWrite:0,totalTokens:2,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}};
// Same directory the server lists (server/src/externalCliHistory.ts cliSessionDirectory).
const sessionDir=cwd=>path.join(root,'.pi-agent','sessions',`--${path.resolve(cwd).replace(/^[/\\]/,'').replace(/[/\\:]/g,'-')}--`);
function seed(cwd,name,question){
 const m=SessionManager.create(cwd,sessionDir(cwd));
 m.appendMessage({role:'user',content:[{type:'text',text:question}]});m.appendSessionInfo(name);
 m.appendMessage({role:'assistant',api:'anthropic-messages',provider:'anthropic',model:'claude-sonnet-4-6',timestamp:Date.now(),stopReason:'stop',usage,content:[{type:'text',text:`answer ${name}`}]});
}
seed(root,'Default talk','DEFAULT-PROJECT-TEXT');seed(other,'B talk','PROJECT-B-TEXT');seed(other,'Side talk','SIDE-TEXT');

// Every DOM change from the first frame: record any forbidden text that was ever visible.
const watch=()=>{
 const forbid=JSON.parse(sessionStorage.getItem('probe:forbid')||'[]');window.__seen=[];
 const check=()=>{const t=document.body?.innerText??'';for(const f of forbid)if(t.includes(f)&&!window.__seen.includes(f))window.__seen.push(f);};
 new MutationObserver(check).observe(document,{subtree:true,childList:true,characterData:true});
};

let server,browser,observer;const errors=[];
const selection=p=>p.evaluate(()=>{const k=Object.keys(sessionStorage).find(k=>k.startsWith('pi-outpost:workspace:v2:'));return k?JSON.parse(sessionStorage.getItem(k)):null});
const shows=async(p,text)=>{await p.getByText(text,{exact:true}).first().waitFor({timeout:15000});};
const lacks=async(p,text)=>assert.equal(await p.getByText(text,{exact:true}).count(),0,`unexpected "${text}"`);
const openSession=async(p,name)=>{await p.getByRole('button',{name:'sessions',exact:true}).click();await p.getByRole('list',{name:'Saved sessions'}).getByText(name,{exact:true}).first().click();};
const toProject=async(p,name)=>{await p.getByTitle(/^Project:/).click();await p.getByRole('menuitem').filter({hasText:name}).first().click();await p.getByTitle(new RegExp(`^Project: ${name}`)).waitFor();};
async function reloadWatched(p,forbid,expect){
 await p.evaluate(f=>sessionStorage.setItem('probe:forbid',JSON.stringify(f)),forbid);
 await p.reload();await shows(p,expect);await p.waitForTimeout(1500);
 const seen=await p.evaluate(()=>window.__seen);
 assert.deepEqual(seen,[],`reload flashed ${JSON.stringify(seen)} before "${expect}"`);
 await shows(p,expect);
 return seen;
}
try{
 server=await startServer(root,{sandbox:false,noExtensions:true},{entry:path.resolve('cli/dist/pi-outpost.mjs'),env:{HOME:path.join(root,'home'),PI_OFFLINE:'1',ANTHROPIC_API_KEY:'fixture-no-model-calls',PI_OUTPOST_BRIDGE_DIR:stores.bridges,PI_OUTPOST_HANDOFF_DIR:stores.handoffs,PI_OUTPOST_RESERVATION_DIR:stores.reservations}});
 observer=connect(server.wsUrl());await observer.waitFor('hello');observer.send({type:'open_project',root:other});await observer.waitFor(m=>m.type==='workspace_switched'&&m.workspace?.root===other);
 // Leave: a socket on B main would make tab B's session switch split onto a side.
 observer.close();
 browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH});
 const context=await browser.newContext({viewport:{width:1280,height:800}});
 await context.addInitScript(watch);
 const tab=async()=>{const p=await context.newPage();p.on('pageerror',e=>errors.push(e.message));await p.goto(server.base);await p.getByTitle(/^Project:/).waitFor();return p;};

 // Default project A main holds DEFAULT-PROJECT-TEXT; B main holds PROJECT-B-TEXT.
 const tabA=await tab();await openSession(tabA,'Default talk');await shows(tabA,'DEFAULT-PROJECT-TEXT');
 const tabB=await tab();await toProject(tabB,'project-b');await openSession(tabB,'B talk');await shows(tabB,'PROJECT-B-TEXT');
 assert.equal((await selection(tabB)).id,other,'tab B sits on project B main');
 // Side tab: joins B main, then opens another conversation and splits onto a side session.
 const tabS=await tab();await toProject(tabS,'project-b');await shows(tabS,'PROJECT-B-TEXT');
 await openSession(tabS,'Side talk');await shows(tabS,'SIDE-TEXT');await lacks(tabS,'PROJECT-B-TEXT');
 const side=await selection(tabS);assert.equal(side.root,other);assert.notEqual(side.id,other,'tab S on its own side session');

 const runs=[];
 for(let i=0;i<2;i++){
  await reloadWatched(tabB,['DEFAULT-PROJECT-TEXT'],'PROJECT-B-TEXT');assert.equal((await selection(tabB)).id,other);
  await reloadWatched(tabS,['DEFAULT-PROJECT-TEXT','PROJECT-B-TEXT'],'SIDE-TEXT');assert.deepEqual(await selection(tabS),side);
  runs.push(i);
 }
 // Monkey: reload twice in a row before the first settles.
 await tabS.evaluate(()=>sessionStorage.setItem('probe:forbid',JSON.stringify(['DEFAULT-PROJECT-TEXT','PROJECT-B-TEXT'])));
 await tabS.reload({waitUntil:'commit'});await tabS.reload();await shows(tabS,'SIDE-TEXT');await tabS.waitForTimeout(1500);
 assert.deepEqual(await tabS.evaluate(()=>window.__seen),[],'double reload flashed another conversation');
 await shows(tabA,'DEFAULT-PROJECT-TEXT');

 // Project B closed, tab B's saved selection still names it: reload falls back to the default project with the notice.
 await tabS.close();
 observer=connect(server.wsUrl());await observer.waitFor('hello');
 observer.send({type:'close_project',root:other});
 await observer.waitFor(m=>m.type==='workspace_activity'&&!m.workspaces.some(w=>w.root===other));
 // Closing moved tab B and re-saved its selection: point it back at the closed project.
 await tabB.evaluate(b=>{sessionStorage.setItem('probe:forbid','[]');const k=Object.keys(sessionStorage).find(k=>k.startsWith('pi-outpost:workspace:v2:'));sessionStorage.setItem(k,JSON.stringify({root:b,id:b}));},other);
 await tabB.reload();
 await shows(tabB,'DEFAULT-PROJECT-TEXT');
 await tabB.getByText(/no longer available|Could not restore/).first().waitFor({timeout:15000});
 assert.equal((await selection(tabB)).root,root,'fallback remembered as the default project');

 assert.deepEqual(errors,[]);
 console.log(JSON.stringify({result:'passed',reloadsWithoutFlash:runs.length*2,doubleReload:true,closedProjectFallback:true,errors}));
}catch(error){console.log(server?.log().split('\n').slice(-15).join('\n'));throw error}
finally{observer?.close();await browser?.close();await server?.stop();await fs.rm(root,{recursive:true,force:true})}
