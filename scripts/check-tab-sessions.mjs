#!/usr/bin/env node
/** Built app, real browser tabs: two tabs on one project hold different conversations.
 * A conversation change in one tab moves only that tab onto its own side session.
 * Offline fixture, no model calls; the bridge registry is a private temp dir. */
import {confirmIfAsked} from './open-more.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {chromium} from 'playwright';
import {SessionManager} from '@earendil-works/pi-coding-agent';
import {connect,makeWorkspace,startServer} from '../server/test/harness.mjs';

const root=await fs.realpath(await makeWorkspace({'a.md':'alpha\n'}));
const other=path.join(root,'other-project');await fs.mkdir(other);
const stores={};for(const name of ['bridges']){stores[name]=path.join(root,name);await fs.mkdir(stores[name],{mode:0o700});}
const usage={input:1,output:1,cacheRead:0,cacheWrite:0,totalTokens:2,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}};
function seed(name,question){
 const m=SessionManager.create(root,path.join(root,'.pi-agent','sessions'));
 m.appendMessage({role:'user',content:[{type:'text',text:question}]});m.appendSessionInfo(name);
 m.appendMessage({role:'assistant',api:'anthropic-messages',provider:'anthropic',model:'claude-sonnet-4-6',timestamp:Date.now(),stopReason:'stop',usage,content:[{type:'text',text:`answer to ${question}`}]});
 return m.getSessionFile();
}
seed('Alpha talk','alpha question');seed('Beta talk','beta question');seed('Gamma talk','gamma question');

let server,browser,observer;const errors=[];
const selection=p=>p.evaluate(()=>{const k=Object.keys(sessionStorage).find(k=>k.startsWith('pi-outpost:workspace:v2:'));return k?JSON.parse(sessionStorage.getItem(k)):null});
const shows=async(p,text)=>{await p.getByText(text,{exact:true}).first().waitFor({timeout:15000});};
const lacks=async(p,text)=>assert.equal(await p.getByText(text,{exact:true}).count(),0,`unexpected "${text}"`);
// Opening another conversation asks first when one is on screen: confirm it.
const openSession=async(p,name)=>{await p.getByRole('button',{name:'sessions',exact:true}).click();await p.getByText(name,{exact:true}).first().click();await confirmIfAsked(p,'Open conversation','Open');};
// A new tab opens on the start screen: join a conversation from its Recent list.
const joinRecent=async(p,name)=>{await p.getByTestId('start-recent-row').filter({hasText:name}).click();await p.getByTestId('start-screen').waitFor({state:'detached'});};
// "+ new" asks first when there is a conversation on screen: confirm it.
const newConversation=async p=>{await p.getByRole('button',{name:'+ new',exact:true}).click({timeout:5000});await p.getByRole('alertdialog',{name:'New chat'}).getByRole('button',{name:'Start new chat'}).click({timeout:2000}).catch(()=>{});};
try{
 server=await startServer(root,{sandbox:false,noExtensions:true},{entry:path.resolve('cli/dist/pi-outpost.mjs'),env:{HOME:path.join(root,'home'),PI_OFFLINE:'1',ANTHROPIC_API_KEY:'fixture-no-model-calls',PI_OUTPOST_BRIDGE_DIR:stores.bridges}});
 observer=connect(server.wsUrl());await observer.waitFor('hello');observer.send({type:'open_project',root:other});await observer.waitFor(m=>m.type==='workspace_switched'&&m.workspace?.root===other);
 browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH});
 const context=await browser.newContext({viewport:{width:1280,height:800}});
 const tab=async()=>{const p=await context.newPage();p.on('pageerror',e=>errors.push(e.message));await p.goto(server.base);await p.getByTitle(/^Project:/).waitFor();return p;};

 // Tab 1 on another project; tab 2 alone on the project switches in place to Alpha.
 const tab1=await tab();await tab1.getByTitle(/^Project:/).click();await tab1.getByRole('menuitem').filter({hasText:'other-project'}).click();await tab1.getByTitle(/^Project: other-project/).waitFor();
 const tab2=await tab();await openSession(tab2,'Alpha talk');await shows(tab2,'alpha question');
 assert.equal((await selection(tab2)).id,root,'a lone tab changes conversation in place');

 // Tab 3 joins Alpha from the start screen: it mirrors it. Switching to Beta moves only tab 3.
 const tab3=await tab();await joinRecent(tab3,'Alpha talk');await shows(tab3,'alpha question');
 await openSession(tab3,'Beta talk');await shows(tab3,'beta question');await lacks(tab3,'alpha question');
 const side3=await selection(tab3);assert.equal(side3.root,root);assert.notEqual(side3.id,root,'tab 3 moved onto its own side session');
 await shows(tab2,'alpha question');await lacks(tab2,'beta question');assert.equal((await selection(tab2)).id,root);

 // Reload: tab 3 comes back to its own conversation.
 await tab3.reload();await shows(tab3,'beta question');assert.deepEqual(await selection(tab3),side3);await lacks(tab3,'alpha question');
 await shows(tab2,'alpha question');

 // "+ new" in tab 3 (alone on its side) and in a new tab sharing Alpha with tab 2.
 await newConversation(tab3);await tab3.getByText('beta question',{exact:true}).waitFor({state:'detached',timeout:15000});
 await tab3.close();
 const tab4=await tab();await joinRecent(tab4,'Alpha talk');await shows(tab4,'alpha question');
 // Monkey: spam "+ new" while the split is being built.
 for(let i=0;i<6;i++)await newConversation(tab4).catch(()=>{});
 await tab4.getByText('alpha question',{exact:true}).waitFor({state:'detached',timeout:15000});
 const side4=await selection(tab4);assert.notEqual(side4.id,root,'tab 4 split from tab 2 on "+ new"');
 await shows(tab2,'alpha question');assert.equal((await selection(tab2)).id,root);
 await tab4.waitForTimeout(1500);
 const sides=observer.received.filter(m=>m.type==='workspace_activity').at(-1).workspaces.filter(w=>w.sideOf&&w.root===root);
 assert.ok(sides.length<=2,`"+ new" spam built ${sides.length} side sessions`);

 // Monkey: both tabs switch to Gamma at once. One runtime may hold it; the other is refused.
 await Promise.all([openSession(tab2,'Gamma talk'),openSession(tab4,'Gamma talk')]);
 await tab2.waitForTimeout(2500);
 const gamma=await Promise.all([tab2,tab4].map(p=>p.getByText('answer to gamma question',{exact:true}).count()));
 assert.ok(gamma.filter(Boolean).length<=1,'two runtimes opened one conversation file');
 if(!gamma[0])await shows(tab2,'answer to alpha question');

 // Close and reopen: a fresh tab starts on the start screen, not tab 4's side.
 await tab4.close();const tab5=await tab();await tab5.getByTestId('start-screen').waitFor();assert.equal(await selection(tab5),null);
 await tab1.getByTitle(/^Project: other-project/).waitFor();
 assert.deepEqual(errors,[]);
 console.log(JSON.stringify({result:'passed',switchSplit:true,reloadKeepsSide:true,newSplit:true,spamSides:sides.length,concurrentGamma:gamma,errors}));
}catch(error){console.log(server?.log().split('\n').slice(-15).join('\n'));throw error}
finally{observer?.close();await browser?.close();await server?.stop();await fs.rm(root,{recursive:true,force:true})}
