#!/usr/bin/env node
/** Built app, real browser: a new tab opens on the start screen, never on the server
 * default project's conversation. Recent conversations across open projects (five at
 * most) and per-project new-chat chips; a choice is remembered, so a reload restores it
 * directly with no start-screen frame — a side session included. Phone and desktop,
 * monkey clicks. Offline fixture, no model calls; private stores. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {chromium} from 'playwright';
import {SessionManager} from '@earendil-works/pi-coding-agent';
import {connect,makeWorkspace,startServer} from '../server/test/harness.mjs';
import {FAKE} from '../server/test/multiProjectHarness.mjs';

const root=await fs.realpath(await makeWorkspace({'a.md':'alpha\n'}));
const beta=path.join(root,'project-b');const gamma=path.join(root,'project-c');
await fs.mkdir(beta);await fs.mkdir(gamma);
const stores={};for(const name of ['bridges','handoffs','reservations']){stores[name]=path.join(root,name);await fs.mkdir(stores[name],{mode:0o700});}
const usage={input:1,output:1,cacheRead:0,cacheWrite:0,totalTokens:2,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}};
const sessionDir=cwd=>path.join(root,'.pi-agent','sessions',`--${path.resolve(cwd).replace(/^[/\\]/,'').replace(/[/\\:]/g,'-')}--`);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function seed(cwd,name,question){
 const m=SessionManager.create(cwd,sessionDir(cwd));
 m.appendMessage({role:'user',content:[{type:'text',text:question}]});m.appendSessionInfo(name);
 m.appendMessage({role:'assistant',api:'anthropic-messages',provider:'anthropic',model:'claude-sonnet-4-6',timestamp:Date.now(),stopReason:'stop',usage,content:[{type:'text',text:`answer ${name}`}]});
 await sleep(20);
}
// Oldest first: the default project's talk falls outside the five newest.
await seed(root,'Default talk','DEFAULT-PROJECT-TEXT');
for(const n of [1,2,3,4])await seed(beta,`B talk ${n}`,`B-TEXT-${n}`);
await seed(gamma,'C talk 1','C-TEXT-1');

// From the first frame: any forbidden text, or the start screen, ever in the DOM.
const watch=()=>{
 window.__seen=[];
 const check=()=>{
  const forbid=JSON.parse(sessionStorage.getItem('probe:forbid')||'["DEFAULT-PROJECT-TEXT"]');
  const t=document.body?.innerText??'';
  for(const f of forbid)if(t.includes(f)&&!window.__seen.includes(f))window.__seen.push(f);
  if(sessionStorage.getItem('probe:no-start')&&document.querySelector('[data-testid=start-screen]')&&!window.__seen.includes('START'))window.__seen.push('START');
 };
 new MutationObserver(check).observe(document,{subtree:true,childList:true,characterData:true,attributes:true});
};

let server,busy,browser,observer;const errors=[];
const selection=p=>p.evaluate(()=>{const k=Object.keys(sessionStorage).find(k=>k.startsWith('pi-outpost:workspace:v2:'));return k?JSON.parse(sessionStorage.getItem(k)):null});
const shows=async(p,text)=>{await p.getByText(text,{exact:true}).first().waitFor({timeout:15000});};
const lacks=async(p,text)=>assert.equal(await p.getByText(text,{exact:true}).count(),0,`unexpected "${text}"`);
const seen=p=>p.evaluate(()=>window.__seen);
const row=(p,name)=>p.getByTestId('start-recent-row').filter({hasText:name});
const chip=(p,name)=>p.getByTestId('start-project-chip').filter({hasText:new RegExp(`^${name}$`)});
const project=async(p,name)=>p.getByTitle(new RegExp(`^Project: ${name}`)).waitFor({timeout:15000});
const startGone=p=>p.getByTestId('start-screen').waitFor({state:'detached',timeout:15000});
async function reloadWatched(p,forbid,expect){
 await p.evaluate(f=>{sessionStorage.setItem('probe:forbid',JSON.stringify(f));sessionStorage.setItem('probe:no-start','1');},forbid);
 await p.reload();await shows(p,expect);await p.waitForTimeout(1200);
 assert.deepEqual(await seen(p),[],`reload showed ${JSON.stringify(await seen(p))} before "${expect}"`);
}
try{
 server=await startServer(root,{sandbox:false,noExtensions:true,openProjects:[beta,gamma]},{entry:path.resolve('cli/dist/pi-outpost.mjs'),env:{HOME:path.join(root,'home'),PI_OFFLINE:'1',ANTHROPIC_API_KEY:'fixture-no-model-calls',PI_OUTPOST_BRIDGE_DIR:stores.bridges,PI_OUTPOST_HANDOFF_DIR:stores.handoffs,PI_OUTPOST_RESERVATION_DIR:stores.reservations}});
 // The default project's live conversation has a name and a Work Plan: the start screen must show neither.
 {const pre=connect(server.wsUrl());await pre.waitFor('hello');const ls=()=>{pre.send({type:'list_sessions'});return pre.waitFor('sessions')};
  const def=(await ls()).sessions.find(x=>x.name==='Default talk');// The plan exists before the switch, so the server loads it with the conversation.
  await fs.writeFile(def.path+'.work-plan.json',JSON.stringify({version:1,id:'p',title:'P',updatedAt:new Date().toISOString(),tasks:[{id:'t',title:'T',status:'done'}]}));
  pre.send({type:'switch_session',path:def.path});await pre.waitFor(m=>m.type==='session_replaced'&&m.sessionId===def.id&&!!m.workPlan);pre.close();
  // Opening it may touch the file: keep it the oldest, as seeded.
  const old=new Date(Date.now()-3600_000);await fs.utimes(def.path,old,old);}
 browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH});
 const desktop=await browser.newContext({viewport:{width:1280,height:800}});
 await desktop.addInitScript(watch);
 const tab=async(context=desktop)=>{const p=await context.newPage();p.on('pageerror',e=>errors.push(e.message));await p.goto(server.base);await p.getByTestId('start-screen').waitFor({timeout:15000});await p.getByTestId('start-recent-row').first().waitFor({timeout:15000});return p;};

 // Fresh tab: start screen, five rows, nothing of the default project, composer hidden.
 const tab1=await tab();
 assert.equal(await tab1.getByTestId('start-recent-row').count(),5,'five recent rows');
 assert.match(await tab1.getByTestId('start-recent-row').first().innerText(),/C talk 1/,'newest first');
 assert.equal(await row(tab1,'Default talk').count(),0,'the oldest falls outside five');
 assert.equal(await tab1.locator('footer').isHidden(),true,'no composer on the start screen');
 assert.equal(await tab1.getByRole('button',{name:'Open Work Plan'}).count()+await tab1.getByRole('complementary',{name:'Work Plan'}).count(),0,'Work Plan of the unchosen conversation');
 assert.ok(!(await tab1.locator('header').first().innerText()).includes('Default talk'),'header shows the unchosen conversation title');
 assert.deepEqual(await seen(tab1),[],'default conversation never shown');
 assert.equal(await selection(tab1),null,'nothing remembered yet');
 observer=connect(server.wsUrl());
 const hello=await observer.waitFor('hello');observer.close();
 assert.equal(hello.workspaces.find(w=>w.root===gamma)?.activity,'stopped','listing did not start a stopped project');
 await tab1.reload();await tab1.getByTestId('start-screen').waitFor({timeout:15000});

 // Monkey: double click a row. Lands in project B on that conversation; remembered.
 // Project B's own current conversation (its newest) must not show on the way.
 await tab1.evaluate(()=>sessionStorage.setItem('probe:forbid',JSON.stringify(['DEFAULT-PROJECT-TEXT','B-TEXT-4'])));
 await row(tab1,'B talk 3').dblclick();
 await startGone(tab1);await project(tab1,'project-b');await shows(tab1,'B-TEXT-3');
 assert.equal((await selection(tab1)).id,beta);
 assert.deepEqual(await seen(tab1),[],'another conversation shown on the way to B talk 3');
 for(let i=0;i<2;i++)await reloadWatched(tab1,['DEFAULT-PROJECT-TEXT','B-TEXT-4'],'B-TEXT-3');
 assert.equal((await selection(tab1)).id,beta);

 // New tab: B talk 3 is live (idle) in project B. Opening B talk 4 splits onto a side session; reload restores the side.
 const tab2=await tab();
 assert.match(await row(tab2,'B talk 3').innerText(),/idle/,'live status shown');
 await tab2.evaluate(()=>sessionStorage.setItem('probe:forbid',JSON.stringify(['DEFAULT-PROJECT-TEXT','B-TEXT-3'])));
 await row(tab2,'B talk 4').click();
 await startGone(tab2);await shows(tab2,'B-TEXT-4');await lacks(tab2,'B-TEXT-3');
 assert.deepEqual(await seen(tab2),[],'another conversation shown on the way to B talk 4');
 const side=await selection(tab2);assert.equal(side.root,beta);assert.notEqual(side.id,beta,'side session remembered');
 for(let i=0;i<2;i++)await reloadWatched(tab2,['DEFAULT-PROJECT-TEXT','B-TEXT-3'],'B-TEXT-4');
 assert.deepEqual(await selection(tab2),side);
 await shows(tab1,'B-TEXT-3');

 // New tab: chip for the stopped project C starts a new empty chat there; reload keeps it.
 const tab3=await tab();
 await tab3.evaluate(()=>sessionStorage.setItem('probe:forbid',JSON.stringify(['DEFAULT-PROJECT-TEXT','C-TEXT-1'])));
 await chip(tab3,'project-c').dblclick();
 await startGone(tab3);await project(tab3,'project-c');
 await tab3.getByText('Send a message to start the agent.').waitFor({timeout:15000});
 assert.equal(await tab3.locator('footer').isHidden(),false,'composer back');
 assert.equal((await selection(tab3)).id,gamma);
 assert.deepEqual(await seen(tab3),[],'project C\'s previous conversation shown on the way');
 for(let i=0;i<2;i++){await reloadWatched(tab3,['DEFAULT-PROJECT-TEXT','C-TEXT-1'],'Send a message to start the agent.');await project(tab3,'project-c');}

 // Monkey: click a chip before hello arrives and keep clicking; then a row and a chip in one burst.
 const tab4=await desktop.newPage();tab4.on('pageerror',e=>errors.push(e.message));
 await tab4.addInitScript(()=>{const t=setInterval(()=>{const c=document.querySelector('[data-testid=start-project-chip]');if(c){c.click();c.click();}if(document.querySelector('main')&&!document.querySelector('[data-testid=start-screen]')&&c===null&&window.__clicked)clearInterval(t);if(c)window.__clicked=true;},1);setTimeout(()=>clearInterval(t),8000);});
 await tab4.goto(server.base,{waitUntil:'commit'});
 await startGone(tab4);await tab4.getByText('Send a message to start the agent.').waitFor({timeout:15000});
 assert.deepEqual(await seen(tab4),[],'monkey chip clicks showed the default conversation');
 const tab5=await tab();
 await tab5.evaluate(()=>{const r=[...document.querySelectorAll('[data-testid=start-recent-row]')].find(e=>e.textContent.includes('C talk 1'));const c=[...document.querySelectorAll('[data-testid=start-project-chip]')].find(e=>e.textContent==='project-b');r.click();c.click();r.click();});
 await startGone(tab5);await shows(tab5,'C-TEXT-1');await project(tab5,'project-c');
 await tab5.waitForTimeout(800);await shows(tab5,'C-TEXT-1');

 // Phone: same content in the transcript area, touch targets at least 44px, no sideways scroll.
 const phone=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true});
 await phone.addInitScript(watch);
 const p1=await tab(phone);
 const boxes=await p1.$$eval('[data-testid=start-recent-row],[data-testid=start-project-chip],[data-testid=start-open-project]',els=>els.map(e=>e.getBoundingClientRect().height));
 assert.ok(boxes.length>=8&&boxes.every(h=>h>=44),`touch targets ${boxes}`);
 assert.ok(await p1.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),'no horizontal overflow');
 // No conversation is chosen yet: the connected one's title and Plan badge must not show.
 assert.equal(await p1.getByRole('navigation',{name:'Primary'}).getByText(/\d+\/\d+/).count(),0,'Plan badge of the unchosen conversation');
 assert.ok(!(await p1.locator('header').first().innerText()).includes('Default talk'),'header shows the unchosen conversation title');
 await row(p1,'B talk 2').tap();
 await startGone(p1);await shows(p1,'B-TEXT-2');
 await reloadWatched(p1,['DEFAULT-PROJECT-TEXT'],'B-TEXT-2');

 // Mid-turn: a scripted runtime whose turn never ends. Reloads restore the running turn directly.
 await phone.close();
 const busyDir=path.join(root,'busy');await fs.mkdir(busyDir);const busyB=path.join(busyDir,'busy-b');await fs.mkdir(busyB);
 const fakeConfig=path.join(busyDir,'fake-rpc.json');
 await fs.writeFile(fakeConfig,JSON.stringify({state:{sessionId:'scripted',isStreaming:false},commands_:{prompt:{after:[{type:'agent_start'}]}}}));
 busy=await startServer(busyDir,{openProjects:[busyB],sandbox:false,noExtensions:true,agentRuntime:{mode:'rpc',executable:process.execPath,args:[FAKE],startupTimeoutMs:10000}},{entry:path.resolve('cli/dist/pi-outpost.mjs'),env:{FAKE_PI_RPC_CONFIG:fakeConfig,HOME:path.join(root,'home'),PI_OFFLINE:'1',PI_OUTPOST_BRIDGE_DIR:stores.bridges,PI_OUTPOST_HANDOFF_DIR:stores.handoffs,PI_OUTPOST_RESERVATION_DIR:stores.reservations}});
 const b1=await desktop.newPage();b1.on('pageerror',e=>errors.push(e.message));await b1.goto(busy.base);
 await chip(b1,'busy-b').click();await startGone(b1);await project(b1,'busy-b');
 await b1.locator('footer textarea, footer [contenteditable=true]').first().fill('RUNNING-TURN');await b1.keyboard.press('Enter');
 const stop=b1.getByRole('button',{name:'Stop the agent',exact:true});await stop.waitFor({timeout:15000});
 for(let i=0;i<2;i++){
  await b1.evaluate(()=>{sessionStorage.setItem('probe:forbid','[]');sessionStorage.setItem('probe:no-start','1');});
  await b1.reload();await stop.waitFor({timeout:15000});await project(b1,'busy-b');await b1.waitForTimeout(800);
  assert.deepEqual(await seen(b1),[],'reload mid-turn showed the start screen');
 }

 assert.deepEqual(errors,[]);
 console.log(JSON.stringify({result:'passed',recentRows:5,reloadsWithoutStartScreen:9,midTurnRestored:true,sideSessionRestored:true,stoppedProjectNotStarted:true,phone:true,errors}));
}catch(error){console.log(server?.log().split('\n').slice(-15).join('\n'));throw error}
finally{observer?.close();await browser?.close();await busy?.stop();await server?.stop();await fs.rm(root,{recursive:true,force:true})}
