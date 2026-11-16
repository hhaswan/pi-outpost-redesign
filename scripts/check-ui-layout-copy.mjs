/** Real browser over plain HTTP: Work Plan never covers Terminal sessions; code copy works without navigator.clipboard. */
import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';
import {chromium} from 'playwright';import {SessionManager} from '@earendil-works/pi-coding-agent';
import {makeWorkspace,startServer} from '../server/test/harness.mjs';
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
 const ctx=await b.newContext({viewport:{width,height:800}});const page=await ctx.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(s.base.replace('127.0.0.1',lan)+'?token=probe-token-0123456789abcdef0123456789');
 assert.equal(await page.evaluate(()=>window.isSecureContext),false,'must reproduce insecure plain HTTP');
 await page.getByRole('button',{name:'sessions',exact:true}).click();await page.getByText('Copy fixture',{exact:true}).click();
 const term=page.getByRole('button',{name:'Terminal sessions'});await term.waitFor();
 const apart=(a,c)=>a.x>=c.x+c.width||c.x>=a.x+a.width||a.y>=c.y+c.height||c.y>=a.y+a.height;
 const drawer=page.getByRole('complementary',{name:'Work Plan'});
 if(width>=768){await drawer.waitFor();assert.ok(apart(await drawer.boundingBox(),await term.boundingBox()),'open drawer covers Terminal sessions');await page.getByRole('button',{name:'Close Work Plan'}).click();}
 else if(await drawer.isVisible()) await page.getByRole('button',{name:'Close Work Plan'}).click();
 const plan=page.getByRole('button',{name:'Open Work Plan'});await plan.waitFor();
 assert.ok(apart(await plan.boundingBox(),await term.boundingBox()),'Plan chip overlaps Terminal sessions');
 assert.equal(await page.evaluate(()=>document.elementFromPoint(...(()=>{const r=[...document.querySelectorAll('button')].find(b=>b.textContent==='Terminal sessions').getBoundingClientRect();return [r.x+r.width/2,r.y+r.height/2]})())?.textContent),'Terminal sessions','Terminal sessions not on top');
 await page.evaluate(()=>{window.__copied=null;document.addEventListener('copy',e=>{window.__copied=document.getSelection()?.toString()??null})});
 const copy=page.getByRole('button',{name:'Copy code'});await copy.click();await copy.click({force:true}).catch(()=>{});
 await page.getByRole('button',{name:'Copied'}).first().waitFor();
 assert.match(await page.evaluate(()=>window.__copied),/migrate\.sh version/);
 for(let i=0;i<7;i++){await page.getByRole('button',{name:/Open Work Plan|Close Work Plan/}).first().click();}
 await page.getByRole('button',{name:'Close Work Plan'}).click().catch(()=>{});
 const chip=page.getByRole('button',{name:'Open Work Plan'});await chip.waitFor();
 assert.ok(apart(await chip.boundingBox(),await term.boundingBox()),'overlap after rapid toggles');
 await page.getByRole('button',{name:/Copy code|Copied|Copy failed/}).first().dblclick();await page.waitForTimeout(1700);
 assert.equal(await page.getByRole('button',{name:'Copy code'}).count(),1,'copy button returns to idle after double click');
 assert.deepEqual(errors,[]);console.log(`PASS width ${width}: no overlap, copy works on insecure HTTP`);await ctx.close();
}}catch(e){console.log(s.log().split('\n').filter(l=>/reject|ws|origin|token/i.test(l)).slice(-8).join('\n'));throw e}finally{await b.close();await s.stop();}
