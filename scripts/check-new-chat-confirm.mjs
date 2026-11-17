#!/usr/bin/env node
/** Built app, real browser: "+ new" asks before leaving a conversation. Cancel, Escape and
 * the backdrop keep it; confirming starts one new chat however fast the clicks. During a
 * running turn the question says the agent keeps working, and confirming moves only this
 * tab onto a side session: the turn finishes in the project's main session, unaborted,
 * and its answer is there on return. Desktop 1280 and phone 390, monkey clicks.
 * Embedded runtime on a scripted provider (no model calls, PI_OFFLINE); private stores. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium, devices} from 'playwright';
import {connect,makeWorkspace,startServer} from '../server/test/harness.mjs';
import {leaveStartScreen} from './leave-start-screen.mjs';
import {openMore} from './open-more.mjs';

const PROVIDER=fileURLToPath(new URL('../server/test/fixtures/side-sessions-provider.mjs',import.meta.url));
const MODEL={provider:'side-sessions-test',id:'side-sessions-test'};
const root=await fs.realpath(await makeWorkspace({'a.md':'alpha\n'}));
// The observer watches another project: a second client on this one would share the tab's conversation.
const other=path.join(root,'other-project');await fs.mkdir(other);
const stores={};for(const name of ['bridges','handoffs','reservations']){stores[name]=path.join(root,name);await fs.mkdir(stores[name],{mode:0o700});}
// The provider holds a `HOLD` turn until this file exists; removed again for the next one.
const releaseFile=path.join(root,'release-held-turns');
const release=()=>fs.writeFile(releaseFile,'go\n');
const rearm=()=>fs.rm(releaseFile,{force:true});

let server,browser,observer;const errors=[];
const selection=p=>p.evaluate(()=>{const k=Object.keys(sessionStorage).find(k=>k.startsWith('pi-outpost:workspace:v2:'));return k?JSON.parse(sessionStorage.getItem(k)):null});
const shows=async(p,text)=>{await p.getByText(text,{exact:true}).first().waitFor({timeout:15000});};
const gone=async(p,text)=>{await p.getByText(text,{exact:true}).first().waitFor({state:'detached',timeout:15000});};
const dialog=p=>p.getByRole('alertdialog',{name:'New chat'});
const ask=async(p,phone)=>{
 if(phone){await p.getByRole('button',{name:'More controls'}).click();await p.getByRole('dialog',{name:'Controls'}).getByRole('button',{name:'+ new',exact:true}).click();}
 else await p.getByRole('button',{name:'+ new',exact:true}).click();
 await dialog(p).waitFor({timeout:5000});
};
const send=async(p,text)=>{await p.locator('footer textarea').first().fill(text);await p.keyboard.press('Enter');};
const activity=()=>observer.received.filter(m=>m.type==='workspace_activity').at(-1)?.workspaces??[];
const mainActivity=()=>activity().find(w=>w.id===root)?.activity;
const sides=()=>activity().filter(w=>w.sideOf===root);
async function until(check,what,ms=15000){const end=Date.now()+ms;while(Date.now()<end){if(await check())return;await new Promise(r=>setTimeout(r,100));}throw new Error(`timed out: ${what}`);}

const named=(p,name)=>p.getByRole('alertdialog',{name});
const openTree=async p=>{await (await openMore(p)).getByRole('button',{name:'tree',exact:true}).click();};

/** Switch, tree navigation, fork, edit and compact each ask first; Cancel/Escape/backdrop keep the conversation. */
async function otherPaths(p,phone,label,current){
 // Switch: from the sessions dropdown, or the phone's Sessions sheet.
 // Any saved conversation but the one shown: its row's main button, not marked current.
 const pick=async()=>{
  if(phone)await p.getByRole('navigation',{name:'Primary'}).getByRole('button',{name:/Sessions/}).click();
  else await p.getByRole('button',{name:'sessions',exact:true}).click();
  await p.getByRole('list',{name:'Saved sessions'}).locator('li > div > button:first-child:not([aria-current])').first().click();
 };
 await pick();
 assert.equal(await named(p,'Open conversation').getByText('Open this conversation? The current one stays in Sessions.',{exact:true}).count(),1,`${label}: switch text`);
 await named(p,'Open conversation').getByRole('button',{name:'Cancel'}).click();
 await shows(p,current);
 // Busy: the question adds that the agent keeps working; cancelled, the turn finishes.
 await rearm();await send(p,`HOLD ${label} again`);await p.getByRole('button',{name:'Stop the agent',exact:true}).waitFor({timeout:15000});
 await pick();
 assert.equal(await named(p,'Open conversation').getByText('Open this conversation? The current one stays in Sessions. The agent is still working; it keeps running in its own session.',{exact:true}).count(),1,`${label}: busy switch text`);
 for(let i=0;i<3;i++)await p.keyboard.press('Escape');
 await named(p,'Open conversation').waitFor({state:'detached'});
 // While it works, the tree offers no fork: a fork would replace the running session.
 await openTree(p);
 assert.ok(await p.getByRole('button',{name:/fork/}).first().isDisabled(),`${label}: fork offered mid-turn`);
 await p.keyboard.press('Escape');if(phone&&await p.getByRole('dialog',{name:'Controls'}).isVisible())await p.keyboard.press('Escape');
 await release();await shows(p,`ok: HOLD ${label} again`);
 // A fork is not offered while the agent works (the server refuses it too); idle, it asks.
 await openTree(p);
 const fork=p.getByRole('button',{name:/fork/}).first();
 await fork.click();
 assert.equal(await named(p,'Fork conversation').getByText('Fork from this point? A new conversation starts from here; the current one stays in Sessions.',{exact:true}).count(),1,`${label}: fork text`);
 await p.waitForTimeout(600);await p.mouse.click(5,5);await named(p,'Fork conversation').waitFor({state:'detached'});
 await shows(p,`ok: HOLD ${label} again`);
 // Tree navigation.
 await openTree(p);
 await p.getByTitle(/restore the conversation at this point|go back to this point/).first().click();
 assert.equal(await named(p,'Go back').getByText('Go back to this point? Later messages stay in the tree.',{exact:true}).count(),1,`${label}: navigate text`);
 await named(p,'Go back').getByRole('button',{name:'Cancel'}).click();
 await shows(p,`ok: HOLD ${label} again`);
 // Compact: from the context control in the model bar.
 await p.getByTitle(/click to compact/i).click();
 assert.equal(await named(p,'Compact conversation').getByText('Compact this conversation? Older messages are summarized to free context; the full history stays in the session file.',{exact:true}).count(),1,`${label}: compact text`);
 await named(p,'Compact conversation').getByRole('button',{name:'Cancel'}).click();
 assert.equal(await p.getByText('compacting…').count(),0,`${label}: compaction started anyway`);
 // Edit: Cancel keeps the draft; Resend, double clicked, sends once.
 const edited=`${label} edited ask`;
 await p.getByRole('button',{name:'Edit this prompt'}).last().click();
 await p.getByRole('textbox',{name:'Edit prompt'}).fill(edited);
 await p.getByRole('button',{name:'send',exact:true}).click();
 assert.equal(await named(p,'Resend prompt').getByText('Resend this edited prompt? Messages after it move to a branch.',{exact:true}).count(),1,`${label}: edit text`);
 await named(p,'Resend prompt').getByRole('button',{name:'Cancel'}).click();
 assert.equal(await p.getByRole('textbox',{name:'Edit prompt'}).inputValue(),edited,`${label}: the draft survived Cancel`);
 await p.getByRole('button',{name:'send',exact:true}).click();
 await named(p,'Resend prompt').getByRole('button',{name:'Resend'}).dblclick();
 await shows(p,`ok: ${edited}`);
 assert.equal(await p.getByText(`ok: ${edited}`,{exact:true}).count(),1,`${label}: the edit was sent once`);
 // Fork, confirmed: a new conversation from that point, its prompt back in the composer.
 await openTree(p);
 await p.getByRole('button',{name:/fork/}).last().click();
 await named(p,'Fork conversation').getByRole('button',{name:'Fork'}).click();
 await gone(p,`ok: ${edited}`);
 assert.match(await p.locator('footer textarea').first().inputValue(),/\S/,`${label}: the forked prompt is back in the composer`);
}

/** A held turn in `p`'s conversation; "+ new" during it; the turn finishes in main, unaborted. */
async function busyFlow(p,phone,label){
 await rearm();
 const question=`HOLD ${label}`;
 await send(p,question);
 await p.getByRole('button',{name:'Stop the agent',exact:true}).waitFor({timeout:15000});
 if(!phone){
  // The header's π mark pulses while the agent works, and keeps still under reduced motion.
  await p.waitForFunction(()=>document.querySelector('[data-testid=pi-mark]')?.dataset.working==='true');
  assert.equal(await p.getByTestId('pi-mark').evaluate(el=>getComputedStyle(el).animationName),'pulse',`${label}: the π mark is still mid-turn`);
  await p.emulateMedia({reducedMotion:'reduce'});
  assert.equal(await p.getByTestId('pi-mark').evaluate(el=>getComputedStyle(el).animationName),'none',`${label}: the π mark moves under reduced motion`);
  await p.emulateMedia({reducedMotion:'no-preference'});
 }
 const before=(await selection(p))?.id??root;
 await ask(p,phone);
 assert.equal(await dialog(p).getByText('The agent is still working. It keeps running in its own session; this tab starts a new chat.').count(),1,`${label}: busy text`);
 await dialog(p).getByRole('button',{name:'Start new chat'}).dblclick();
 await gone(p,question);
 const after=await selection(p);
 assert.match(after.id,/#side-/,`${label}: the tab moved onto a side session`);
 assert.notEqual(after.id,before);
 await until(()=>activity().find(w=>w.id===before)?.activity==='working',`${label}: the turn still runs`);
 await release();
 await until(()=>activity().find(w=>w.id===before)?.activity==='idle',`${label}: the turn finished`);
 // Back via the project picker: the answer is there, and the turn was not cut short.
 await p.getByTitle(/^Project:/).click();
 await p.getByTestId(before===root?'project-row':'side-session-row').getByRole('menuitem').first().click();
 await shows(p,`ok: ${question}`);
 assert.equal(await p.getByText(/aborted/i).count(),0,`${label}: nothing aborted`);
 return after.id;
}

try{
 server=await startServer(root,{sandbox:false,extensionPaths:[PROVIDER],allowedModels:[MODEL]},{entry:path.resolve('cli/dist/pi-outpost.mjs'),env:{HOME:path.join(root,'home'),PI_OFFLINE:'1',ANTHROPIC_API_KEY:'fixture-no-model-calls',SIDE_SESSIONS_RELEASE:releaseFile,PI_OUTPOST_BRIDGE_DIR:stores.bridges,PI_OUTPOST_HANDOFF_DIR:stores.handoffs,PI_OUTPOST_RESERVATION_DIR:stores.reservations}});
 observer=connect(server.wsUrl());await observer.waitFor('hello');observer.send({type:'open_project',root:other});await observer.waitFor(m=>m.type==='workspace_switched'&&m.workspace?.root===other);
 browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH});
 const results={};

 for(const [label,options,phone] of [['desktop',{viewport:{width:1280,height:800}},false],['phone',{...devices['iPhone 13'],viewport:{width:390,height:844}},true]]){
  const context=await browser.newContext(options);
  const p=await context.newPage();p.on('pageerror',e=>errors.push(e.message));
  await p.goto(server.base);await leaveStartScreen(p);await p.getByTitle(/^Project:/).waitFor();
  // The start screen may have joined a side session: begin on the project's main one.
  if((await selection(p))?.id!==root){await p.getByTitle(/^Project:/).click();await p.getByTestId('project-row').getByRole('menuitem').click();await until(async()=>(await selection(p))?.id===root,`${label}: on the main session`);}
  const first=`${label} first question`;
  await send(p,first);await shows(p,`ok: ${first}`);
  const start=(await selection(p)).id;

  // Cancel, Escape spam and the backdrop keep the conversation.
  await ask(p,phone);
  assert.equal(await dialog(p).getByText('Start a new chat? The current conversation stays in Sessions.').count(),1,`${label}: idle text`);
  if(phone){for(const name of ['Cancel','Start new chat']){const box=await dialog(p).getByRole('button',{name}).boundingBox();assert.ok(box.height>=44,`${label}: ${name} is ${box.height}px tall`);}}
  await dialog(p).getByRole('button',{name:'Cancel'}).click();
  await dialog(p).waitFor({state:'detached'});
  await ask(p,phone);for(let i=0;i<5;i++)await p.keyboard.press('Escape');
  await dialog(p).waitFor({state:'detached'});
  // A double click on "+ new" leaves the question up (its second click lands on the backdrop).
  if(!phone){await p.getByRole('button',{name:'+ new',exact:true}).dblclick();await p.waitForTimeout(300);assert.equal(await dialog(p).count(),1,`${label}: a double click took the question away`);await p.waitForTimeout(400);await p.mouse.click(5,5);await dialog(p).waitFor({state:'detached'});}
  await ask(p,phone);await p.waitForTimeout(600);await p.mouse.click(5,5);
  await dialog(p).waitFor({state:'detached'});
  await shows(p,`ok: ${first}`);assert.equal((await selection(p)).id,start,`${label}: still on the same conversation`);

  // Confirm, double clicked: one new chat, in place (alone and idle).
  const sidesBefore=sides().length;
  await ask(p,phone);await dialog(p).getByRole('button',{name:'Start new chat'}).dblclick();
  await gone(p,`ok: ${first}`);
  await p.waitForTimeout(1200);
  assert.equal((await selection(p)).id,start,`${label}: an idle lone tab starts the new chat in place`);
  assert.equal(sides().length,sidesBefore,`${label}: no side session for an idle change`);
  assert.equal(await dialog(p).count(),0);
  // An empty conversation has nothing to lose: no question.
  await (phone?p.getByRole('button',{name:'More controls'}).click().then(()=>p.getByRole('dialog',{name:'Controls'}).getByRole('button',{name:'+ new',exact:true}).click()):p.getByRole('button',{name:'+ new',exact:true}).click());
  await p.waitForTimeout(400);assert.equal(await dialog(p).count(),0,`${label}: empty conversation asked anyway`);

  // During a running turn.
  const side=await busyFlow(p,phone,label);
  // Every other path that leaves or rewrites the conversation.
  await otherPaths(p,phone,label,`ok: HOLD ${label}`);

  // Monkey: "+ new" asked, then the tab is moved elsewhere before answering — the question goes with it.
  await p.getByTitle(/^Project:/).click();
  await p.getByTestId('side-session-row').filter({hasText:/./}).getByRole('menuitem').first().click();
  await until(async()=>(await selection(p))?.id!==root,`${label}: back on a side session`);
  const onSide=(await selection(p)).id;
  await send(p,`${label} side words`);await shows(p,`ok: ${label} side words`);
  await ask(p,phone);
  observer.send({type:'close_project',root,id:onSide});
  await until(async()=>(await selection(p))?.id===root,`${label}: moved to the project when its side closed`);
  await dialog(p).waitFor({state:'detached',timeout:5000});
  await p.waitForTimeout(800);
  assert.equal((await selection(p)).id,root,`${label}: the unanswered question started nothing`);
  results[label]={start,side,sidesNow:sides().length};
  await context.close();
 }

 assert.deepEqual(errors,[]);
 console.log(JSON.stringify({result:'passed',...results,errors}));
}catch(error){console.log(server?.log().split('\n').slice(-20).join('\n'));throw error}
finally{observer?.close();await browser?.close();await server?.stop();await fs.rm(root,{recursive:true,force:true})}
