/** Real browser over plain HTTP: Work Plan never covers the More menu that holds Terminal sessions; code copy works without navigator.clipboard.
 * On a phone both live elsewhere (bottom navigation, header overflow sheet): nothing floats over the conversation there. */
import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';
import {chromium} from 'playwright';import {SessionManager} from '@earendil-works/pi-coding-agent';
import {makeWorkspace,startServer} from '../server/test/harness.mjs';
import {openMore} from './open-more.mjs';
import os from 'node:os';
// A LAN address makes the page an insecure context, like plain-HTTP production.
const lan=Object.values(os.networkInterfaces()).flat().find(a=>a.family==='IPv4'&&!a.internal)?.address;
if(!lan)throw Error('No non-loopback IPv4 address for the insecure-context probe');
const root=await makeWorkspace();const agentDir=path.join(root,'.pi-agent');
const m=SessionManager.create(root,path.join(agentDir,'sessions'));
m.appendMessage({role:'user',content:[{type:'text',text:'Q'}]});m.appendSessionInfo('Copy fixture');
m.appendMessage({role:'assistant',api:'anthropic-messages',provider:'anthropic',model:'claude-sonnet-4-6',timestamp:Date.now(),stopReason:'stop',usage:{input:1,output:1,cacheRead:0,cacheWrite:0,totalTokens:2,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}},content:[{type:'text',text:'Run:\n\n```sh\nDOTENV_FILE=x ./.cicd/migrate.sh version\n```'}]});
const file=m.getSessionFile();
await fs.writeFile(file+'.work-plan.json',JSON.stringify({version:1,id:'p',title:'T',updatedAt:new Date().toISOString(),tasks:Array.from({length:9},(_,i)=>({id:'t'+i,title:'Task '+i,status:i<5?'done':'todo'}))}));
const {default:net}=await import('node:net');const port=await new Promise(r=>{const v=net.createServer().listen(0,()=>{const q=v.address().port;v.close(()=>r(q))})});
const s=await startServer(root,{sandbox:false,noExtensions:true,server:{allowedOrigins:[`http://${lan}:${port}`],port,host:'0.0.0.0',allowInsecureHttp:true,token:'probe-token-0123456789abcdef0123456789'}},{entry:path.resolve('cli/dist/pi-outpost.mjs'),env:{PI_OFFLINE:'1',ANTHROPIC_API_KEY:'x'}});
const b=await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH});
try{for(const width of [1280,390]){
 // Plain HTTP drops Secure cookies, so this insecure-context probe signs in the way scripts do: Bearer on every request.
 const ctx=await b.newContext({viewport:{width,height:800},extraHTTPHeaders:{Authorization:'Bearer probe-token-0123456789abcdef0123456789'}});const page=await ctx.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(s.base.replace('127.0.0.1',lan));
 assert.equal(await page.evaluate(()=>window.isSecureContext),false,'must reproduce insecure plain HTTP');
 const phone=width<768;
 if(phone){
  const nav=page.getByRole('navigation',{name:'Primary'});const navButton=n=>nav.getByRole('button',{name:n});
  await navButton('Sessions').click();await page.getByTestId('phone-sessions-sheet').getByText('Copy fixture',{exact:true}).click();
  await page.getByTestId('phone-sessions-sheet').waitFor({state:'detached'});
  await page.getByRole('button',{name:'Copy code'}).waitFor();
  assert.equal(await page.getByRole('button',{name:'Open Work Plan'}).count(),0,'floating Plan chip on a phone');
  assert.equal(await page.getByRole('button',{name:'Terminal sessions'}).count(),0,'Terminal sessions row on a phone');
  await page.getByRole('button',{name:'More controls'}).click();
  await page.getByTestId('compact-header-more').getByRole('button',{name:'Terminal sessions'}).waitFor();
  await page.keyboard.press('Escape');await page.getByTestId('compact-header-more').waitFor({state:'detached'});
  const onTop=async(locator,label)=>{const box=await locator.boundingBox();const hit=await page.evaluate(([x,y])=>{const el=document.elementFromPoint(x,y);return el?.closest('button')?.textContent??null},[box.x+box.width/2,box.y+box.height/2]);assert.equal(hit,await locator.textContent(),`${label} not on top`)};
  // The plan opens as a full sheet over the nav; stale taps on the covered nav must not stack or break it.
  await navButton(/Plan/).click();for(let i=0;i<6;i++){await navButton(/Plan/).evaluate(b=>b.click());}
  const planSheet=page.getByTestId('phone-plan-sheet');
  if(!(await planSheet.isVisible())) await navButton(/Plan/).click();
  await planSheet.getByRole('complementary',{name:'Work Plan'}).waitFor();
  await onTop(planSheet.getByRole('button',{name:'Close Work Plan'}),'Plan sheet close');
  await planSheet.getByRole('button',{name:'Close Work Plan'}).click();await planSheet.waitFor({state:'detached'});
  await onTop(navButton(/Plan/),'Plan nav after the sheet closes');
  await page.evaluate(()=>{window.__copied=null;document.addEventListener('copy',e=>{window.__copied=document.getSelection()?.toString()??null})});
  const copy=page.getByRole('button',{name:'Copy code'});await copy.click();await copy.click({force:true}).catch(()=>{});
  await page.getByRole('button',{name:'Copied'}).first().waitFor();
  assert.match(await page.evaluate(()=>window.__copied),/migrate\.sh version/);
  await page.getByRole('button',{name:/Copy code|Copied|Copy failed/}).first().dblclick();await page.waitForTimeout(1700);
  assert.equal(await page.getByRole('button',{name:'Copy code'}).count(),1,'copy button returns to idle after double click');
  assert.deepEqual(errors,[]);console.log(`PASS width ${width}: nothing floats on the phone, Plan in the nav opens a sheet, copy works on insecure HTTP`);await ctx.close();continue;
 }
 await page.getByRole('button',{name:'sessions',exact:true}).click();/* the menu's row, not the start screen's behind it */await page.getByRole('list',{name:'Saved sessions'}).getByText('Copy fixture',{exact:true}).first().click();
 // Terminal sessions is in the More menu at every width: neither the drawer nor the Plan chip may cover what opens it.
 const more=page.getByRole('button',{name:'More controls',exact:true});await more.waitFor();
 const apart=(a,c)=>a.x>=c.x+c.width||c.x>=a.x+a.width||a.y>=c.y+c.height||c.y>=a.y+a.height;
 const onTop=async(locator,label)=>{const box=await locator.boundingBox();const hit=await page.evaluate(([x,y])=>document.elementFromPoint(x,y)?.closest('button')?.textContent??null,[box.x+box.width/2,box.y+box.height/2]);assert.equal(hit,await locator.textContent(),`${label} not on top`)};
 const drawer=page.getByRole('complementary',{name:'Work Plan'});
 if(width>=768){await drawer.waitFor();assert.ok(apart(await drawer.boundingBox(),await more.boundingBox()),'open drawer covers More');
  const term=(await openMore(page)).getByRole('button',{name:'Terminal sessions'});await onTop(term,'Terminal sessions over the open drawer');
  await page.keyboard.press('Escape');await page.getByRole('dialog',{name:'Controls'}).waitFor({state:'detached'});
  await page.getByRole('button',{name:'Close Work Plan'}).click();}
 else if(await drawer.isVisible()) await page.getByRole('button',{name:'Close Work Plan'}).click();
 const plan=page.getByRole('button',{name:'Open Work Plan'});await plan.waitFor();
 assert.ok(apart(await plan.boundingBox(),await more.boundingBox()),'Plan chip overlaps More');
 await onTop(more,'More');
 await page.evaluate(()=>{window.__copied=null;document.addEventListener('copy',e=>{window.__copied=document.getSelection()?.toString()??null})});
 const copy=page.getByRole('button',{name:'Copy code'});await copy.click();await copy.click({force:true}).catch(()=>{});
 await page.getByRole('button',{name:'Copied'}).first().waitFor();
 assert.match(await page.evaluate(()=>window.__copied),/migrate\.sh version/);
 for(let i=0;i<7;i++){await page.getByRole('button',{name:/Open Work Plan|Close Work Plan/}).first().click();}
 await page.getByRole('button',{name:'Close Work Plan'}).click().catch(()=>{});
 const chip=page.getByRole('button',{name:'Open Work Plan'});await chip.waitFor();
 assert.ok(apart(await chip.boundingBox(),await more.boundingBox()),'overlap after rapid toggles');
 await page.getByRole('button',{name:/Copy code|Copied|Copy failed/}).first().dblclick();await page.waitForTimeout(1700);
 assert.equal(await page.getByRole('button',{name:'Copy code'}).count(),1,'copy button returns to idle after double click');
 assert.deepEqual(errors,[]);console.log(`PASS width ${width}: no overlap, copy works on insecure HTTP`);await ctx.close();
}}catch(e){console.log(s.log().split('\n').filter(l=>/reject|ws|origin|token/i.test(l)).slice(-8).join('\n'));throw e}finally{await b.close();await s.stop();}
