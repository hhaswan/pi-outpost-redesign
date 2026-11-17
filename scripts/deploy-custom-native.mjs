import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash,createPublicKey,X509Certificate} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import WebSocket from 'ws';
import {chromium} from 'playwright';
import {get as httpGet} from 'node:http';
import {get as httpsGet} from 'node:https';
import {DEPLOY_ADDRESS,lockIngress,unlockIngress} from './native-deploy-network.mjs';
import {checkAgentImages} from './check-agent-images.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
// --previous-config names the file the running service was started with, when the restart changes
// its transport or token (the HTTPS cutover): the idle check talks to the running server with it.
const previousIndex=process.argv.indexOf('--previous-config');
const previousConfigPath=previousIndex>0?path.resolve(process.argv[previousIndex+1]??''):undefined;
const args=process.argv.slice(2).filter((arg,index,all)=>arg!=='--check'&&arg!=='--previous-config'&&all[index-1]!=='--previous-config');
if(!args[0])throw Error('Usage: node scripts/deploy-custom-native.mjs <config.json> [service.service] [--check] [--previous-config <config.json>]');
const configPath=path.resolve(args[0]);
const service=args[1]??'pi-outpost.service';
if(!/^[a-zA-Z0-9@_.-]+\.service$/.test(service))throw Error('Invalid systemd service name');
if(process.platform!=='linux'||process.getuid?.()!==0)throw Error('Native deployment requires Linux root');
const source=path.join(root,'cli/dist');
const resultPath=path.join(root,'.local/deploy-result.json');
// Pi auto-discovers *.js and *.ts in the global extension directory, not *.mjs.
const extension=path.join(process.env.HOME??'/root','.pi/agent/extensions/pi-outpost-cli-bridge.js');
const config=JSON.parse(await fs.readFile(configPath,'utf8'));
const port=config.server.port;
if(!Number.isInteger(port)||port<1||port>65535||!['0.0.0.0','127.0.0.1'].includes(config.server.host))throw Error('This native deployment supports an explicit IPv4 listener only');
// How to reach a server started with a configuration: HTTPS trusting only its own CA file, and the
// Bearer token, which creates no browser session. Verification stays on; nothing is ignored.
const endpoint=c=>({scheme:c.server.tls?'https':'http',authorization:`Bearer ${c.server.token}`,...(c.server.tls?.caFile?{ca:readFileSync(path.resolve(path.dirname(configPath),c.server.tls.caFile))}:{}),...(c.server.tls?{certFile:path.resolve(path.dirname(configPath),c.server.tls.certFile)}:{})});
const next=endpoint(config);
const previousConfig=previousConfigPath?JSON.parse(await fs.readFile(previousConfigPath,'utf8')):config;
if(previousConfig.server.port!==port)throw Error('The previous configuration must use the same port');
/** The server the helpers talk to: the running one until it is stopped, then the one this config starts. */
let live=endpoint(previousConfig);
// TLS material must survive a re-clone, a rebuild and every release swap: it lives in the user
// config directory, never in this checkout (and so never in .local/native-releases). Read only here.
if(config.server.tls){
 const inside=file=>{const relative=path.relative(root,path.resolve(path.dirname(configPath),file));return !relative.startsWith('..')&&!path.isAbsolute(relative);};
 for(const key of ['certFile','keyFile','caFile'])if(config.server.tls[key]&&inside(config.server.tls[key]))throw Error(`server.tls.${key} is inside the repository; keep TLS files in ~/.config/pi-outpost/tls so a re-clone or redeploy cannot lose them`);
 // The serving certificate must chain to the CA the devices trust, and be in date, before any restart.
 if(next.ca){const ca=new X509Certificate(next.ca),leaf=new X509Certificate(readFileSync(next.certFile));
  if(!leaf.checkIssued(ca)||!leaf.verify(ca.publicKey))throw Error('server.tls.certFile is not signed by server.tls.caFile: run "pi-outpost tls renew"');
  const days=Math.ceil((Date.parse(leaf.validTo)-Date.now())/86400000);if(days<=0)throw Error('The server certificate has expired: run "pi-outpost tls renew"');
  if(days<30)console.warn(`The server certificate expires in ${days} days: run "pi-outpost tls renew"`);}
}
const commit=execFileSync('git',['rev-parse','--short','HEAD'],{cwd:root,encoding:'utf8'}).trim();
const suffix=`${commit}-${Date.now()}`;
// A stock global npm upgrade cannot overwrite this service's selected release.
const release=path.join(root,'.local/native-releases',suffix);
const target=path.join(release,'dist');
const dropIn=path.join('/etc/systemd/system',`${service}.d`,'90-custom-build.conf');
const backup=path.join(root,'.local',`service-before-${suffix}.conf`);
const unitArg=value=>'\"'+value.replaceAll('%','%%').replaceAll('\\','\\\\').replaceAll('\"','\\\"')+'\"';
if([process.execPath,target,configPath].some(value=>/[\r\n\0]/.test(value)))throw Error('Unsafe path in service command');
const extensionBackup=path.join(root,'.local',`cli-bridge-before-${suffix}.js`);
const hash=async p=>createHash('sha256').update(await fs.readFile(p)).digest('hex');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const record={commit,service,status:'preflight',checks:[],backup,startedAt:new Date().toISOString()};
const save=async()=>fs.writeFile(resultPath,JSON.stringify(record,null,2),{mode:0o600});
const systemctl=(...args)=>execFileSync('/usr/bin/systemctl',args,{encoding:'utf8',timeout:240000,stdio:['ignore','pipe','pipe']});
async function waitHealthy(){
 for(let i=0;i<180;i++){try{const healthy=await new Promise((resolve,reject)=>{const request=(live.scheme==='https'?httpsGet:httpGet)({host:'127.0.0.1',port,path:'/health',localAddress:DEPLOY_ADDRESS,...(live.ca?{ca:live.ca}:{})},response=>{response.resume();resolve(response.statusCode===200);});request.setTimeout(1500,()=>request.destroy(Error('Health timeout')));request.on('error',reject);});if(healthy)return;}catch{}await delay(1000);}
 throw Error('Health check failed');
}
async function connection(workspace){
 const socket=new WebSocket(`${live.scheme==='https'?'wss':'ws'}://127.0.0.1:${port}/ws${workspace?`?workspace=${encodeURIComponent(workspace)}`:''}`,{localAddress:DEPLOY_ADDRESS,headers:{Authorization:live.authorization},...(live.ca?{ca:live.ca}:{})});
 const queue=[],waiters=[];
 socket.on('message',data=>{let message;try{message=JSON.parse(data);}catch{return;}const waiter=waiters.find(w=>w.test(message));if(waiter){waiters.splice(waiters.indexOf(waiter),1);clearTimeout(waiter.timer);waiter.resolve(message);}else queue.push(message);});
 const fail=error=>{for(const waiter of waiters.splice(0)){clearTimeout(waiter.timer);waiter.reject(error);}};
 socket.on('error',fail);socket.on('close',()=>fail(Error('Deployment WebSocket closed')));
 const next=(test,timeout=180000)=>new Promise((resolve,reject)=>{const found=queue.findIndex(test);if(found>=0){resolve(queue.splice(found,1)[0]);return;}if(socket.readyState>=WebSocket.CLOSING){reject(Error('Deployment WebSocket closed'));return;}const waiter={test,resolve,reject,timer:setTimeout(()=>{waiters.splice(waiters.indexOf(waiter),1);reject(Error('WebSocket check timed out'));},timeout)};waiters.push(waiter);});
 try {let hello=await next(m=>m.type==='hello');if(hello.agentStarting){hello=await next(m=>m.type==='workspace_switched'||m.type==='workspace_error',180000);if(hello.type==='workspace_error')throw Error('Workspace failed to start');}return {socket,hello,next,send:m=>socket.send(JSON.stringify(m)),request:(message,test,timeout)=>{queue.length=0;const answer=next(test,timeout);socket.send(JSON.stringify(message));return answer;},close:()=>{for(const w of waiters)clearTimeout(w.timer);socket.close();}};}catch(e){socket.terminate();throw e;}
}
function quiet(hello){return !hello.isStreaming && !(hello.workspaces??[]).some(w=>['working','waiting','starting'].includes(w.activity)||w.backgroundAgents?.known===false||(w.backgroundAgents?.running??0)>0||(w.backgroundAgents?.queued??0)>0);}
async function capture(){
 const main=await connection();
 try{
  if(!quiet(main.hello))return null;
  const sessions=[],sides=[];
  for(const workspace of main.hello.workspaces??[]){
   // Side sessions live only in memory (ids are renumbered on start). Their conversations are on disk:
   // record them; a tab that was on one falls back to its project with a notice and can reopen it from Sessions.
   if(workspace.sideOf){if(workspace.activity!=='stopped')sides.push({id:workspace.id,root:workspace.root,label:workspace.label??null});continue;}
   if(workspace.activity==='stopped')continue;
   const client=await connection(workspace.root);
   try{
    if(!quiet(client.hello))return null;
    const listed=await client.request({type:'list_sessions'},m=>m.type==='sessions');
    const current=listed.sessions.find(s=>s.id===client.hello.sessionId);
    if(current)sessions.push({root:workspace.root,sessionId:current.id,path:current.path});
    else if(client.hello.items?.length)throw Error('Active session history was not found; refusing restart');
    else {record.emptyWorkspaces??={};record.emptyWorkspaces[workspace.root]={previousSessionId:client.hello.sessionId,reason:'No persisted history; workspace will receive a new empty session'};}
   }finally{client.close();}
  }
  // Each capture replaces the last: only the final pre-restart view counts.
  if(sides.length)record.sideSessions=sides;else delete record.sideSessions;
  return sessions;
 }finally{main.close();}
}
async function restore(sessions,timeout=180000){
 for(const session of sessions){const client=await connection(session.root);try{
  if(client.hello.workspace?.root!==session.root)throw Error('Workspace identity changed during restart');
  if(client.hello.sessionId!==session.sessionId){await client.request({type:'switch_session',path:session.path},m=>m.type==='session_replaced'&&m.sessionId===session.sessionId&&m.workspace?.root===session.root,timeout);}
 }finally{client.close();}}
}
async function verifyBrowser(){
 // Over HTTPS Chromium trusts exactly this server's key, never every certificate.
 const spki=live.certFile?createHash('sha256').update(createPublicKey(readFileSync(live.certFile)).export({type:'spki',format:'der'})).digest('base64'):undefined;
 const browser=await chromium.launch({headless:true,...(spki?{args:[`--ignore-certificate-errors-spki-list=${spki}`]}:{}),...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH}:{})});
 const origin=`${live.scheme}://127.0.0.1:${port}`;
 // Bearer on every request, the WebSocket included: signs the check in without leaving a browser session behind.
 const context=await browser.newContext({viewport:{width:390,height:900},extraHTTPHeaders:{Authorization:live.authorization}});
 try{let errors=0;
 /* A fresh tab opens on the start screen: check it renders, and leave it untouched (no click, nothing created or sent). */
 {const fresh=await context.newPage();fresh.on('pageerror',()=>errors++);
 await fresh.goto(origin);await fresh.getByTestId('start-screen').waitFor({timeout:90000});
 await fresh.getByTestId('start-recent-row').first().or(fresh.getByText('No saved conversations yet.',{exact:true})).waitFor({timeout:30000});await fresh.close();}
 /* A refreshed tab restores its own project directly: the path users take after a deploy. */
 const main=await connection();const root=main.hello.workspace?.root;main.close();if(!root)throw Error('Live server reported no workspace');
 const page=await context.newPage();page.on('pageerror',()=>errors++);
 await page.addInitScript(([key,root])=>{sessionStorage.setItem(key,JSON.stringify({root}));},[`pi-outpost:workspace:v2:${origin}`,root]);
 await page.goto(origin);await page.getByRole('region',{name:'Activity',exact:true}).waitFor({timeout:90000});
 if(await page.getByTestId('start-screen').count())throw Error('A tab with a saved selection showed the start screen');
 {const more=page.getByRole('button',{name:'More controls',exact:true});if(await more.isVisible())await more.click();}/* Terminal sessions is in the More menu: the phone's Controls sheet, a wide screen's popover */await page.getByRole('button',{name:'Terminal sessions',exact:true}).click();await page.getByRole('dialog',{name:'CLI sessions',exact:true}).waitFor();await page.getByRole('button',{name:'Close CLI sessions'}).click();
 const model=page.getByRole('button',{name:'Model',exact:true});await model.click();
 await page.getByRole('combobox',{name:'Search models'}).fill('NO-SUCH-MODEL-DEPLOY');
 await page.getByText('No models found.',{exact:true}).waitFor();await page.keyboard.press('Escape');
 if(await page.evaluate(()=>document.body.scrollWidth>innerWidth))throw Error('Live mobile overflow');
 if(errors)throw Error('Live browser page errors');record.checks.push(`live authenticated Playwright over ${live.scheme}: fresh tab start screen, refreshed tab restored directly, activity, CLI panel, mobile bounds, zero page errors`);
 if(live.scheme==='http')await verifyPlainHttpLogin(browser);
 }finally{await browser.close();}
}
/* Without TLS, Bearer proves nothing about browsers: a Secure cookie on plain http is dropped and
   nobody can sign in. Sign in through the form as a browser does, from a configured LAN origin
   (an insecure context) when there is one, reload, then sign out so no session is left behind. */
async function verifyPlainHttpLogin(browser){
 const lanOrigin=(config.server.allowedOrigins??[]).map(o=>{try{return new URL(o);}catch{return undefined;}}).find(u=>u&&u.protocol==='http:'&&Number(u.port||80)===port&&!/^(localhost|127\.\d+\.\d+\.\d+|\[::1\])$/.test(u.hostname));
 const origin=lanOrigin?lanOrigin.origin:`http://127.0.0.1:${port}`;
 // A name is mapped to loopback so the check never leaves the host; an IP literal is reached directly.
 const mapped=lanOrigin&&!/^[\d.]+$|^\[/.test(lanOrigin.hostname);
 const context=await (mapped?await chromium.launch({headless:true,args:[`--host-resolver-rules=MAP ${lanOrigin.hostname} 127.0.0.1`],...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH}:{})}):browser).newContext({viewport:{width:390,height:900}});
 try{const page=await context.newPage();let errors=0;page.on('pageerror',()=>errors++);
 await page.goto(origin);await page.getByTestId('sign-in').waitFor({timeout:90000});
 if(lanOrigin&&await page.evaluate(()=>window.isSecureContext))throw Error('The plain-HTTP login check did not run in an insecure context');
 await page.getByLabel('Access token',{exact:true}).fill(live.authorization.slice('Bearer '.length));
 await page.getByRole('button',{name:'Connect',exact:true}).click();
 await page.getByTestId('sign-in').waitFor({state:'detached',timeout:30000});
 await page.reload();await page.getByTestId('start-screen').or(page.getByRole('region',{name:'Activity',exact:true})).first().waitFor({timeout:90000});
 if(await page.getByTestId('sign-in').count())throw Error('Browser sign-in over plain HTTP did not survive a reload');
 const out=await page.evaluate(async()=>[(await fetch('/api/logout',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,(await fetch('/api/session')).status]);
 if(out[0]!==200||out[1]!==401)throw Error(`Plain-HTTP sign-out failed: ${out}`);
 if(errors)throw Error('Live browser page errors during the plain-HTTP login check');
 record.checks.push(`live browser login form over plain http at ${lanOrigin?'a LAN origin (insecure context)':'loopback'}: signed in, reload kept the session, signed out`);
 }finally{await context.close();if(mapped)await context.browser()?.close();}
}
await fs.mkdir(path.join(root,'.local'),{recursive:true,mode:0o700});
await fs.access(path.join(source,'pi-outpost.mjs'));await fs.access(path.join(source,'extensions/cli-session-bridge.mjs'));
// The SDK stays external: a corrupt Photon dependency would make every image vanish.
await checkAgentImages(pathToFileURL(path.join(source,'pi-outpost.mjs')).href);
if(!(await fs.readFile(path.join(source,'pi-outpost.mjs'),'utf8')).includes('var CUSTOM_BUILD = true;'))throw Error('Refusing to deploy an unmarked stock build');
if(process.argv.includes('--check')){console.log(`DEPLOY_PREFLIGHT_OK${config.server.tls?' (TLS files outside the repository, certificate chains to the CA)':''}`);process.exit(0);}
const lock=path.join(root,'.local/native-deploy.lock');
await fs.mkdir(lock,{mode:0o700});
await fs.writeFile(path.join(lock,'owner.json'),JSON.stringify({pid:process.pid,commit}),{mode:0o600});
record.sourceSha256=await hash(path.join(source,'pi-outpost.mjs'));
record.previousPid=systemctl('show',service,'-p','MainPID','--value').trim();
await save();
let sessions,swapped=false,stopped=false,extensionExisted=false,dropInExisted=false,ingressLocked=false,clientAccessResumed=false;
try{
 record.status='waiting-for-idle';await save();
 const until=Date.now()+15*60*1000;
 while(Date.now()<until){const first=await capture();if(first){await delay(3000);sessions=await capture();if(sessions)break;}await delay(3000);}
 if(!sessions)throw Error('No safe idle maintenance window before deadline');
 await fs.writeFile(path.join(root,'.local/deploy-session-map.json'),JSON.stringify(sessions,null,2),{mode:0o600});
 await fs.mkdir(release,{recursive:true,mode:0o700});
 await fs.cp(source,target,{recursive:true,errorOnExist:true,force:false});
 if(await hash(path.join(target,'pi-outpost.mjs'))!==record.sourceSha256)throw Error('Source build changed while waiting for deployment');
 await checkAgentImages(pathToFileURL(path.join(target,'pi-outpost.mjs')).href);record.checks.push('release resolves a valid SDK image decoder');
 // Exclude client input until all saved sessions have been restored.
 lockIngress(port);ingressLocked=true;record.checks.push('temporary ingress gate excludes client submissions during restoration');
 // Check again under the ingress gate before interrupting the process.
 sessions=await capture();if(!sessions)throw Error('Work resumed while preparing deployment; deployment deferred');
 await fs.writeFile(path.join(root,'.local/deploy-session-map.json'),JSON.stringify(sessions,null,2),{mode:0o600});
 record.status='restarting';await save();
 try{await fs.copyFile(extension,extensionBackup);extensionExisted=true;}catch(e){if(e.code!=='ENOENT')throw e;}
 try{await fs.copyFile(dropIn,backup);dropInExisted=true;}catch(error){if(error.code!=='ENOENT')throw error;}
 stopped=true;systemctl('stop',service);live=next;record.checks.push('previous service stopped');await save();
 await fs.mkdir(path.dirname(dropIn),{recursive:true});swapped=true;
 await fs.writeFile(dropIn,`[Service]\nExecStart=\nExecStart=${unitArg(process.execPath)} ${unitArg(path.join(target,'pi-outpost.mjs'))} --config ${unitArg(configPath)}\n`,{mode:0o644});
 systemctl('daemon-reload');
 if(!systemctl('show',service,'-p','ExecStart','--value').includes(path.join(target,'pi-outpost.mjs')))throw Error('Service did not select the custom release');
 record.release=release;record.checks.push('service pinned to immutable custom release outside global npm');
 await fs.copyFile(path.join(target,'extensions/cli-session-bridge.mjs'),extension);await fs.chmod(extension,0o600);
 systemctl('start',service);
 await waitHealthy();
 record.checks.push('service health successful');await save();
 await restore(sessions);
 for(const session of sessions){const verified=await connection(session.root);try{if(verified.hello.sessionId!==session.sessionId||verified.hello.workspace?.root!==session.root)throw Error('Restored session did not persist on a fresh connection');}finally{verified.close();}}
 record.checks.push('previous active session identities restored and verified on fresh connections');await save();
 unlockIngress(port);ingressLocked=false;clientAccessResumed=true;
 await verifyBrowser();await save();
 if(await hash(path.join(target,'pi-outpost.mjs'))!==await hash(path.join(source,'pi-outpost.mjs')))throw Error('Installed bundle hash mismatch');
 record.bundleSha256=await hash(path.join(target,'pi-outpost.mjs'));
 record.status='deployed';record.restoredSessions=sessions.length;record.pid=systemctl('show',service,'-p','MainPID','--value').trim();record.checks.push('bundle hash matches staged build','service health successful','previous active session identities restored','CLI bridge installed without reloading running CLIs');
}catch(error){
 record.status='failed';record.error=error instanceof Error?error.message:'Deployment failed';await save();
 if(swapped){try{
   record.rollbackPhase='capture';await save();
   // A dead server has no new work to interrupt. An unreachable live server is not proof of idleness.
   const active=systemctl('show',service,'-p','ActiveState','--value').trim();
   if(!ingressLocked){lockIngress(port);ingressLocked=true;}
   const pid=Number(systemctl('show',service,'-p','MainPID','--value').trim());
   if(active==='active'||pid>0){
     const current=await capture();
     if(!current){record.status='rollback-deferred-busy';throw Error('Rollback deferred because workspace became busy');}
     // Users may have changed sessions after ingress reopened; preserve their current identities.
     if(clientAccessResumed){sessions=current;await fs.writeFile(path.join(root,'.local/deploy-session-map.json'),JSON.stringify(sessions,null,2),{mode:0o600});}
   }
   record.rollbackPhase='stop';await save();systemctl('stop',service);
   if(dropInExisted)await fs.copyFile(backup,dropIn);else await fs.rm(dropIn,{force:true});
   systemctl('daemon-reload');
   if(extensionExisted)await fs.copyFile(extensionBackup,extension);else await fs.rm(extension,{force:true});
   record.rollbackPhase='start';await save();systemctl('start',service);
   record.rollbackPhase='restore';await save();await waitHealthy();await restore(sessions??[]);record.status='rolled-back';
 }catch(rollbackError){record.rollbackError=rollbackError.message;if(record.status!=='rollback-deferred-busy')record.status='rollback-failed';}}
 else if(stopped){try{systemctl('start',service);await waitHealthy();await restore(sessions??[]);}catch{if(record.status!=='rollback-deferred-busy')record.status='rollback-failed';}}
}finally{try{if(ingressLocked)unlockIngress(port);}catch(error){record.ingressCleanupError=error.message;record.status='ingress-cleanup-failed';}record.finishedAt=new Date().toISOString();await save();await fs.rm(lock,{recursive:true,force:true});}
console.log(record.status);
if(record.status!=='deployed')process.exitCode=1;
