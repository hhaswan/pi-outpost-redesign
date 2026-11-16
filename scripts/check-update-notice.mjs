/** Built app: the server's update notice stays one compact line on phones, and the model chip shows the model id. */
import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';import {chromium} from 'playwright';
import {makeWorkspace,startServer} from '../server/test/harness.mjs';
const root=await makeWorkspace({'README.md':'# x'});const fake=path.join(root,'npm.mjs');
await fs.writeFile(fake,"console.log('99.0.0');");
const dirs={};for(const k of ['BRIDGE']){dirs[`PI_OUTPOST_${k}_DIR`]=path.join(root,k.toLowerCase());await fs.mkdir(dirs[`PI_OUTPOST_${k}_DIR`],{mode:0o700});}
const s=await startServer(root,{sandbox:false,noExtensions:true},{entry:path.resolve('cli/dist/pi-outpost.mjs'),env:{...dirs,PI_OFFLINE:'1',ANTHROPIC_API_KEY:'x'}});
const b=await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH});
try{for(const [w,h] of [[320,620],[390,844]]){const p=await b.newPage({viewport:{width:w,height:h}});
 // Inject the live server's update notice into the real WebSocket stream.
 await p.routeWebSocket(/\/ws/,ws=>{const server=ws.connectToServer();server.onMessage(m=>ws.send(m));ws.onMessage(m=>server.send(m));setTimeout(()=>ws.send(JSON.stringify({type:'outpost_update',notice:{running:'0.62.0',latest:'0.62.3',instruction:'Custom build: merge the upstream release into the custom repository, rebuild, verify, then deploy. Do not install the stock npm package.',copy:'pi-outpost update --check',releaseNotes:'https://example.invalid'}})),1500);});
 await p.goto(s.base);
 await p.getByTestId('update-notice').waitFor({timeout:30000});
 const r=await p.evaluate(()=>{const n=document.querySelector('[data-testid=update-notice]').getBoundingClientRect();const nav=document.querySelector('nav[aria-label]')?.getBoundingClientRect();const m=document.querySelector('[aria-label=Model]');return {notice:Math.round(n.height),navBottom:nav&&Math.round(nav.bottom),inner:innerHeight,docH:document.documentElement.scrollHeight,model:m?.innerText,modelW:Math.round(m?.getBoundingClientRect().width)}});
 console.log(w,JSON.stringify(r));
 assert.ok(r.notice<=60,`update notice is ${r.notice}px tall at ${w}px`);assert.equal(r.docH,r.inner,'page must not scroll');assert.equal(r.navBottom,r.inner);
 assert.ok(!r.model.startsWith('anthropic/'),`phone model chip shows the provider: ${r.model}`);
 await p.getByRole('button',{name:'Dismiss the update notice'}).click();await p.getByTestId('update-notice').waitFor({state:'detached'});await p.screenshot({path:`.local/notice-${w}.png`});await p.close();}}
finally{await b.close();await s.stop();}
