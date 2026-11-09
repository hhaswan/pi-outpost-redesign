import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import WebSocket from 'ws';
import {chromium} from 'playwright';
import {get as httpGet} from 'node:http';
import {DEPLOY_ADDRESS,lockIngress,unlockIngress} from './native-deploy-network.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const args=process.argv.slice(2).filter(arg=>arg!=='--check');
if(!args[0])throw Error('Usage: node scripts/deploy-custom-native.mjs <config.json> [service.service] [--check]');
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
if(!Number.isInteger(port)||port<1||port>65535||!['0.0.0.0','127.0.0.1'].includes(config.server.host)||config.server.tls)throw Error('This native deployment supports an explicit IPv4 HTTP listener only');
const authorization=`Bearer ${config.server.token}`;
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
 for(let i=0;i<180;i++){try{const healthy=await new Promise((resolve,reject)=>{const request=httpGet({host:'127.0.0.1',port,path:'/health',localAddress:DEPLOY_ADDRESS},response=>{response.resume();resolve(response.statusCode===200);});request.setTimeout(1500,()=>request.destroy(Error('Health timeout')));request.on('error',reject);});if(healthy)return;}catch{}await delay(1000);}
 throw Error('Health check failed');
}
async function connection(workspace){
 const socket=new WebSocket(`ws://127.0.0.1:${port}/ws${workspace?`?workspace=${encodeURIComponent(workspace)}`:''}`,{localAddress:DEPLOY_ADDRESS,headers:{Authorization:authorization}});
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
  const sessions=[];
  for(const workspace of main.hello.workspaces??[]){
   if(workspace.sideOf)throw Error('Side-session restoration needs a separate maintenance plan');
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
 const browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH}:{})});
 try{const page=await browser.newPage({viewport:{width:390,height:900}});let errors=0;page.on('pageerror',()=>errors++);
 await page.addInitScript(token=>localStorage.setItem('pi-outpost:token',token),config.server.token);
 await page.goto(`http://127.0.0.1:${port}`);await page.getByRole('region',{name:'Activity',exact:true}).waitFor({timeout:90000});
 await page.getByRole('button',{name:'Terminal sessions',exact:true}).click();await page.getByRole('dialog',{name:'CLI sessions',exact:true}).waitFor();await page.getByRole('button',{name:'Close CLI sessions'}).click();
 const model=page.getByRole('button',{name:'Model',exact:true});await model.click();
 await page.getByRole('combobox',{name:'Search models'}).fill('NO-SUCH-MODEL-DEPLOY');
 await page.getByText('No models found.',{exact:true}).waitFor();await page.keyboard.press('Escape');
 if(await page.evaluate(()=>document.body.scrollWidth>innerWidth))throw Error('Live mobile overflow');
 if(errors)throw Error('Live browser page errors');record.checks.push('live authenticated Playwright: activity, CLI panel, mobile bounds, zero page errors');
 }finally{await browser.close();}
}
await fs.mkdir(path.join(root,'.local'),{recursive:true,mode:0o700});
await fs.access(path.join(source,'pi-outpost.mjs'));await fs.access(path.join(source,'extensions/cli-session-bridge.mjs'));
if(!(await fs.readFile(path.join(source,'pi-outpost.mjs'),'utf8')).includes('var CUSTOM_BUILD = true;'))throw Error('Refusing to deploy an unmarked stock build');
if(process.argv.includes('--check')){console.log('DEPLOY_PREFLIGHT_OK');process.exit(0);}
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
 // Exclude client input until all saved sessions have been restored.
 lockIngress(port);ingressLocked=true;record.checks.push('temporary ingress gate excludes client submissions during restoration');
 // Check again under the ingress gate before interrupting the process.
 sessions=await capture();if(!sessions)throw Error('Work resumed while preparing deployment; deployment deferred');
 await fs.writeFile(path.join(root,'.local/deploy-session-map.json'),JSON.stringify(sessions,null,2),{mode:0o600});
 record.status='restarting';await save();
 try{await fs.copyFile(extension,extensionBackup);extensionExisted=true;}catch(e){if(e.code!=='ENOENT')throw e;}
 try{await fs.copyFile(dropIn,backup);dropInExisted=true;}catch(error){if(error.code!=='ENOENT')throw error;}
 stopped=true;systemctl('stop',service);record.checks.push('previous service stopped');await save();
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
