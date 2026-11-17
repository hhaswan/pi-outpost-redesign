#!/usr/bin/env node
/** Built app, real browser: a parent session's sub-agent children start collapsed when
 * the sessions menu opens (even for the current session), expand on their toggle, stay
 * expanded on the next opening, and the list never overflows. Checked at 1280 (header
 * dropdown) and 390 (phone Sessions sheet). Offline fixture, no model calls. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {chromium} from 'playwright';
import {SessionManager} from '@earendil-works/pi-coding-agent';
import {makeWorkspace,startServer} from '../server/test/harness.mjs';
import {leaveStartScreen} from './leave-start-screen.mjs';

const root=await fs.realpath(await makeWorkspace({'a.md':'alpha\n'}));
const bridges=path.join(root,'bridges');await fs.mkdir(bridges,{mode:0o700});
const sessionsDir=path.join(root,'.pi-agent','sessions');
function seed(name,parent){
 const m=SessionManager.create(root,sessionsDir);
 m.appendMessage({role:'user',content:[{type:'text',text:`${name} question`}]});m.appendSessionInfo(name);
 m.appendMessage({role:'assistant',api:'anthropic-messages',provider:'anthropic',model:'claude-sonnet-4-6',timestamp:Date.now(),stopReason:'stop',
  usage:{input:1,output:1,cacheRead:0,cacheWrite:0,totalTokens:2,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}},content:[{type:'text',text:`answer to ${name}`}]});
 return m.getSessionFile();
}
const parent=seed('Parent talk');
for(const n of [1,2,3]){
 const file=seed(`Child ${n}`);
 const lines=(await fs.readFile(file,'utf8')).split(/\r?\n/);
 lines[0]=JSON.stringify({...JSON.parse(lines[0]),parentSession:parent});
 await fs.writeFile(file,lines.join('\n'));
}

let server,browser;const errors=[];const results=[];
try{
 server=await startServer(root,{sandbox:false,noExtensions:true},{entry:path.resolve('cli/dist/pi-outpost.mjs'),env:{HOME:path.join(root,'home'),PI_OFFLINE:'1',ANTHROPIC_API_KEY:'fixture-no-model-calls',PI_OUTPOST_BRIDGE_DIR:bridges}});
 browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH});
 for(const width of [1280,390]){
  const phone=width<768;
  const context=await browser.newContext({viewport:{width,height:800},hasTouch:phone,isMobile:phone});
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  await page.goto(server.base);await leaveStartScreen(page);
  const surface=phone?page.getByTestId('phone-sessions-sheet'):page.locator('body');
  const open=async()=>{
   if(phone)await page.getByRole('navigation',{name:'Primary'}).getByRole('button',{name:'Sessions',exact:false}).click();
   else await page.getByRole('button',{name:'sessions',exact:true}).click();
   await surface.getByRole('list',{name:'Saved sessions'}).waitFor();
  };
  const close=async()=>{
   if(phone)await surface.getByRole('button',{name:'Close'}).last().click();
   else await page.getByRole('button',{name:'sessions',exact:true}).click();
   await page.getByRole('list',{name:'Saved sessions'}).waitFor({state:'detached'});
  };
  // Make the parent the current session: the case that used to open expanded.
  await open();await surface.getByText('Parent talk',{exact:true}).click();
  await page.getByText('answer to Parent talk',{exact:true}).waitFor({timeout:15000});
  await page.getByRole('list',{name:'Saved sessions'}).waitFor({state:'detached'});

  await open();
  const toggle=surface.getByRole('button',{name:'3 sub-agents of Parent talk'});
  assert.equal(await toggle.getAttribute('aria-expanded'),'false',`${width}: children open expanded`);
  assert.equal((await toggle.textContent()).trim(),'▸ 3 sub-agents');
  assert.equal(await surface.getByText('Child 1',{exact:true}).count(),0,`${width}: child visible while collapsed`);
  assert.equal(await surface.getByText('Parent talk',{exact:true}).locator('xpath=ancestor::button[1]').getAttribute('aria-current'),'true');
  const box=await toggle.boundingBox();
  if(phone)assert.ok(box.width>=43.5&&box.height>=43.5,`${width}: toggle ${box.width}x${box.height} below 44px`);

  await toggle.click();
  assert.equal(await toggle.getAttribute('aria-expanded'),'true');
  const children=surface.getByRole('list',{name:'Children of Parent talk'});
  for(const n of [1,2,3])await children.getByText(`Child ${n}`,{exact:true}).waitFor();
  if(process.env.SHOTS)await page.screenshot({path:path.join(process.env.SHOTS,`session-tree-${width}.png`)});
  const overflow=await page.evaluate(()=>{
   const vw=document.documentElement.clientWidth;
   const doc=Math.max(document.documentElement.scrollWidth,document.body.scrollWidth);
   const list=document.querySelector('[aria-label="Saved sessions"]').parentElement;
   const out=[...document.querySelectorAll('[aria-label="Saved sessions"] *')].filter(el=>{const r=el.getBoundingClientRect();return r.width&&(r.right>vw+0.5||r.left<-0.5)}).length;
   return {doc,vw,list:list.scrollWidth-list.clientWidth,out};
  });
  assert.ok(overflow.doc<=overflow.vw+1,`${width}: document ${overflow.doc}px in ${overflow.vw}px`);
  assert.ok(overflow.list<=1,`${width}: session list scrolls sideways by ${overflow.list}px`);
  assert.equal(overflow.out,0,`${width}: ${overflow.out} session list elements off screen`);

  await close();await open();
  assert.equal(await surface.getByRole('button',{name:'3 sub-agents of Parent talk'}).getAttribute('aria-expanded'),'true',`${width}: expanded state forgotten`);
  await close();
  results.push({width,collapsedOnOpen:true,expands:true,remembered:true,toggle:[Math.round(box.width),Math.round(box.height)],overflow});
  await context.close();
 }
 assert.deepEqual(errors,[]);
 console.log(JSON.stringify({result:'passed',results,errors}));
}catch(error){console.log(server?.log().split('\n').slice(-15).join('\n'));throw error}
finally{await browser?.close();await server?.stop();await fs.rm(root,{recursive:true,force:true})}
