#!/usr/bin/env node
/**
 * A real Pi CLI TUI (Linux PTY) and the built web app writing ONE session file at once.
 * Both talk to a local fake Anthropic endpoint: no model spend, and every request body is
 * read back to prove what each side's model was actually sent.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {chromium,expect} from 'playwright/test';
import {makeWorkspace,startServer} from '../server/test/harness.mjs';

assert.equal(process.platform,'linux','This PTY probe requires Linux and python3');
const entry=fileURLToPath(new URL('../cli/dist/pi-outpost.mjs',import.meta.url));
const root=await fs.realpath(await makeWorkspace());
const home=path.join(root,'home'),agentDir=path.join(home,'.pi','agent'),bridgeDirectory=path.join(root,'bridges');
const sessionsDirectory=path.join(agentDir,'sessions',`--${root.replace(/^[/\\]/,'').replace(/[/\\:]/g,'-')}--`);

const requests=[];
const text=content=>typeof content==='string'?content:content.filter(b=>b.type==='text').map(b=>b.text).join('');
// `side` is the x-api-key: models.json reads it from $PROBE_SIDE, set differently for the CLI and the server.
// A prompt starting "slow" streams in two parts 2.5 s apart; "hang for stop" never ends until aborted.
const endpoint=http.createServer(async(request,response)=>{
  const chunks=[];for await(const chunk of request)chunks.push(chunk);
  const body=JSON.parse(Buffer.concat(chunks).toString());
  const last=text(body.messages.at(-1)?.content??'');
  const titling=body.max_tokens===200;
  const record={users:body.messages.filter(m=>m.role==='user').map(m=>text(m.content)),last,side:request.headers['x-api-key'],aborted:false};
  if(!titling)requests.push(record);
  const reply=titling?'Shared probe':`reply to ${last}`;
  response.writeHead(200,{'Content-Type':'text/event-stream'});
  const event=(type,data)=>response.write(`event: ${type}\ndata: ${JSON.stringify({type,...data})}\n\n`);
  event('message_start',{message:{id:`msg_${requests.length}`,type:'message',role:'assistant',model:body.model,content:[],stop_reason:null,stop_sequence:null,usage:{input_tokens:1,output_tokens:0}}});
  event('content_block_start',{index:0,content_block:{type:'text',text:''}});
  if(last==='hang for stop'){
    event('content_block_delta',{index:0,delta:{type:'text_delta',text:'hanging part'}});
    response.on('close',()=>{record.aborted=true;});return;
  }
  if(last.startsWith('slow')){
    event('content_block_delta',{index:0,delta:{type:'text_delta',text:'first part, '}});
    await new Promise(r=>setTimeout(r,2500));
    event('content_block_delta',{index:0,delta:{type:'text_delta',text:reply}});
  }else event('content_block_delta',{index:0,delta:{type:'text_delta',text:reply}});
  event('content_block_stop',{index:0});
  event('message_delta',{delta:{stop_reason:'end_turn',stop_sequence:null},usage:{output_tokens:1}});
  event('message_stop',{});
  response.end();
});
await new Promise(resolve=>endpoint.listen(0,'127.0.0.1',resolve));
await fs.mkdir(path.join(agentDir,'extensions'),{recursive:true});await fs.mkdir(bridgeDirectory,{mode:0o700});
await fs.writeFile(path.join(agentDir,'models.json'),JSON.stringify({providers:{anthropic:{baseUrl:`http://127.0.0.1:${endpoint.address().port}`,apiKey:'$PROBE_SIDE',
  models:[{id:'shared-probe',api:'anthropic-messages',input:['text'],reasoning:false}]}}}));
await fs.writeFile(path.join(agentDir,'settings.json'),JSON.stringify({defaultProvider:'anthropic',defaultModel:'shared-probe',defaultThinkingLevel:'off'}));
// The bridge is globally discovered, by the terminal and by the web runtime alike, as in production.
await fs.copyFile('cli/dist/extensions/cli-session-bridge.mjs',path.join(agentDir,'extensions','bridge.js'));

const env={HOME:home,USERPROFILE:home,PI_CODING_AGENT_DIR:agentDir,PI_OUTPOST_BRIDGE_DIR:bridgeDirectory,PI_OFFLINE:'1'};
const clean={...process.env,...env,PROBE_SIDE:'cli',TERM:'xterm-256color',NO_COLOR:'1'};
for(const key of Object.keys(clean))if(/API_KEY|TOKEN|SECRET|CREDENTIAL|PROXY/i.test(key))delete clean[key];
const sdkCli=path.join(path.dirname(fileURLToPath(import.meta.resolve('@earendil-works/pi-coding-agent'))),'cli.js');
let cli,output='',server,browser;
const write=value=>cli.stdin.write(JSON.stringify({text:value})+'\n');
const wait=async(fn,what,timeout=30000)=>{const until=Date.now()+timeout;while(Date.now()<until){const value=await fn();if(value)return value;await new Promise(r=>setTimeout(r,50));}throw Error(`timed out: ${what}\n${output.slice(-800)}`);};
const entries=async file=>(await fs.readFile(file,'utf8')).split(/\r?\n/).filter(Boolean).map(line=>JSON.parse(line));
const requestFor=prompt=>wait(()=>requests.find(r=>r.last===prompt),`a model request for "${prompt}"`);
const persisted=(file,reply)=>wait(async()=>(await entries(file)).some(e=>e.type==='message'&&e.message.role==='assistant'&&text(e.message.content)===reply),`"${reply}" in the file`);
try{
  server=await startServer(root,{agentDir,sandbox:false,noExtensions:false,updateCheck:false,changelogNotice:false,
    allowedModels:[{provider:'anthropic',id:'shared-probe'}]},{entry,env:{...env,PROBE_SIDE:'web',ANTHROPIC_API_KEY:undefined}});
  browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH}:{})});
  const page=await browser.newPage({viewport:{width:1280,height:900}});const pageErrors=[];page.on('pageerror',e=>pageErrors.push(e.message));
  await page.goto(server.base);
  const composer=page.getByPlaceholder(/^message pi/);await expect(composer).toBeEnabled();
  const sendFromWeb=async prompt=>{await composer.fill(prompt);await page.getByRole('button',{name:'Send message',exact:true}).click();
    await expect(page.getByText(`reply to ${prompt}`,{exact:true})).toBeVisible({timeout:30000});
    await expect(page.getByRole('button',{name:'Stop the agent',exact:true})).toHaveCount(0);};

  // A web conversation is written where `pi -c` in the project looks.
  await sendFromWeb('web turn 0');
  const file=await wait(async()=>(await fs.readdir(sessionsDirectory).catch(()=>[])).filter(n=>n.endsWith('.jsonl')).map(n=>path.join(sessionsDirectory,n))[0],'the web session file');
  cli=spawn('python3',[path.resolve('scripts/cli-pty-driver.py'),process.execPath,sdkCli,'--no-skills','-c'],{cwd:root,env:clean,stdio:['pipe','pipe','pipe']});
  cli.stdout.on('data',b=>output+=b.toString());cli.stderr.on('data',b=>output+=b.toString());cli.on('error',e=>output+=e.message);
  await wait(async()=>(await fs.readdir(bridgeDirectory)).some(n=>n.endsWith('.json')),'the CLI bridge registration');
  console.log('PASS WebSessionContinuedByPiDashC');
  // Granted by default, with one notice. Revoked first: the web runtime then writes the same file alongside the CLI.
  await wait(()=>output.includes('Outpost web can send messages to this CLI'),'the default-grant notice');
  write('/outpost-bridge revoke\r');await wait(()=>output.includes('Outpost web input revoked'),'the revoke notice');

  for(let i=1;i<=3;i++){
    const before=(await entries(file)).at(-1).id;
    write(`cli turn ${i}`);await new Promise(r=>setTimeout(r,200));write('\r');
    const cliRequest=await requestFor(`cli turn ${i}`);
    assert.ok(cliRequest.users.includes(`web turn ${i-1}`),`the CLI's request carries the web's message: ${JSON.stringify(cliRequest.users)}`);
    await persisted(file,`reply to cli turn ${i}`);
    const now=await entries(file),next=now[now.findIndex(e=>e.id===before)+1];
    assert.equal(next.parentId,before,"the CLI's next entry chains after the web's last entry");
    await expect(page.getByText(`reply to cli turn ${i}`,{exact:true})).toBeVisible({timeout:10000});
    await sendFromWeb(`web turn ${i}`);
    const webRequest=requests.find(r=>r.last===`web turn ${i}`);
    assert.ok(webRequest.users.includes(`cli turn ${i}`),'the web request carries the CLI turn');
    assert.equal(webRequest.side,'web','a revoked CLI leaves the web prompt to the web runtime');
  }
  console.log('PASS AlternatingTurnsReachBothModels');
  // Settle: the CLI reads the web's last turn on its next poll.
  await wait(()=>output.includes('from Outpost web'),'the CLI sync notice');
  const chain=(await entries(file)).slice(1);
  chain.forEach((e,i)=>assert.equal(e.parentId,i===0?null:chain[i-1].id,`entry ${i} (${e.type}) chains after the previous one`));
  console.log(`PASS OneLinearChain (${chain.length} entries)`);
  assert.equal(page.url(),server.base+'/','no reload happened');

  // Monkey: both sides at once. A branch is allowed; a broken file or a stuck side is not.
  write('race from cli');await new Promise(r=>setTimeout(r,150));
  await composer.fill('race from web');
  write('\r');await page.getByRole('button',{name:'Send message',exact:true}).click();
  await requestFor('race from cli');await requestFor('race from web');
  await persisted(file,'reply to race from cli');await persisted(file,'reply to race from web');
  for(const line of (await fs.readFile(file,'utf8')).split(/\r?\n/).filter(Boolean))JSON.parse(line);
  const all=await entries(file),parents=all.slice(1).map(e=>e.parentId);
  console.log(`  race: ${parents.length-new Set(parents).size?'branched':'stayed linear'}`);
  await expect(page.getByRole('button',{name:'Stop the agent',exact:true})).toHaveCount(0);
  await new Promise(r=>setTimeout(r,2500));
  write('after the race');await new Promise(r=>setTimeout(r,200));write('\r');
  await requestFor('after the race');await persisted(file,'reply to after the race');
  await sendFromWeb('web after the race');
  assert.ok(requests.find(r=>r.last==='web after the race').users.includes('after the race'),'web still sees the CLI after a race');
  console.log('PASS SimultaneousTurnsKeepBothSidesWorking');

  // A CLI /reload rotates its bridge, and loads it again granted.
  const beforeReload=(await fs.readdir(bridgeDirectory)).find(n=>n.endsWith('.json'));
  write('/reload\r');
  await wait(async()=>{const names=(await fs.readdir(bridgeDirectory)).filter(n=>n.endsWith('.json'));return names.length===1&&names[0]!==beforeReload},'a rotated bridge after /reload');
  console.log('PASS ActualCliReloadRotatesBridge');
  const more=page.getByRole('button',{name:'More controls',exact:true});if(await more.isVisible())await more.click();
  await page.getByRole('button',{name:'Terminal sessions',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'CLI sessions',exact:true});await dialog.waitFor();
  await dialog.getByRole('button',{name:new RegExp('Project:')}).first().click();
  await dialog.getByRole('button',{name:'Refresh transcript',exact:true}).click();
  const draft=dialog.getByRole('textbox');await expect(draft).toBeEnabled({timeout:10000});
  assert.equal(output.includes('Allow Outpost input?'),false,'no terminal confirmation is asked');
  await draft.fill('submitted from the panel');await dialog.getByRole('button',{name:'Submit to CLI',exact:true}).click();
  await dialog.getByText('Submitted to CLI; acceptance is shown in its transcript',{exact:true}).waitFor();
  await requestFor('submitted from the panel');await persisted(file,'reply to submitted from the panel');
  assert.equal(requests.find(r=>r.last==='submitted from the panel').side,'cli');
  console.log('PASS ActualSubmitToCliReachesTheModel');
  await dialog.getByRole('button',{name:'Close CLI sessions',exact:true}).click();
  await new Promise(r=>setTimeout(r,2500)); // the server's sweep follows the new bridge's events

  // The composer sends to the live CLI: its provider request, its entries only, streamed live into the page.
  const stop=page.getByRole('button',{name:'Stop the agent',exact:true});
  const before=(await entries(file)).at(-1).id;
  await composer.fill('slow web via cli');await page.getByRole('button',{name:'Send message',exact:true}).click();
  await expect(page.getByText('slow web via cli',{exact:true})).toBeVisible({timeout:5000});
  await expect(page.getByText('first part,',{exact:true})).toBeVisible({timeout:10000});
  assert.equal((await entries(file)).some(e=>e.type==='message'&&e.message.role==='assistant'&&text(e.message.content).startsWith('first part')),false,'shown while streaming, before the CLI wrote it');
  await expect(stop).toBeVisible();
  await expect(page.getByText('first part, reply to slow web via cli',{exact:true})).toBeVisible({timeout:15000});
  await expect(stop).toHaveCount(0,{timeout:10000});
  const routed=requests.filter(r=>r.last==='slow web via cli');
  assert.deepEqual(routed.map(r=>r.side),['cli'],'one provider request, from the CLI process');
  const turn=(await entries(file)).slice((await entries(file)).findIndex(e=>e.id===before)+1);
  assert.deepEqual(turn.filter(e=>e.type==='message').map(e=>`${e.message.role}:${text(e.message.content)}`),['user:slow web via cli','assistant:first part, reply to slow web via cli'],'one writer, one chain for the turn');
  assert.equal(turn[0].parentId,before);turn.slice(1).forEach((e,i)=>assert.equal(e.parentId,turn[i].id));
  console.log('PASS WebPromptRunsInLiveCli');
  console.log('PASS CliTurnStreamsToWeb');

  // While the CLI works, a web message waits as its follow-up.
  await composer.fill('slow busy turn');await page.getByRole('button',{name:'Send message',exact:true}).click();
  await expect(stop).toBeVisible({timeout:10000});await requestFor('slow busy turn');
  await composer.fill('queued while busy');await composer.press('Enter');
  await expect(page.getByText('reply to queued while busy',{exact:true})).toBeVisible({timeout:30000});
  const followUp=requests.find(r=>r.last==='queued while busy');
  assert.equal(followUp.side,'cli');
  assert.ok(followUp.users.includes('slow busy turn')&&requests.indexOf(followUp)>requests.findIndex(r=>r.last==='slow busy turn'),'sent after the busy turn, carrying it');
  await persisted(file,'reply to queued while busy');
  assert.equal(requests.filter(r=>r.last==='queued while busy').length,1);
  await expect(stop).toHaveCount(0,{timeout:10000});
  console.log('PASS BusyCliQueuesWebPromptAsFollowUp');

  // Stop in the web aborts the CLI's turn.
  await composer.fill('hang for stop');await page.getByRole('button',{name:'Send message',exact:true}).click();
  await expect(page.getByText('hanging part',{exact:false})).toBeVisible({timeout:10000});
  await stop.click();
  await wait(()=>requests.find(r=>r.last==='hang for stop')?.aborted,'the CLI request aborted');
  await expect(stop).toHaveCount(0,{timeout:10000});
  assert.equal(requests.find(r=>r.last==='hang for stop').side,'cli');
  console.log('PASS WebStopAbortsCliTurn');

  // Monkey: double-click Send and Stop in a burst; nothing is sent twice and the page settles.
  await composer.fill('slow burst');const send=page.getByRole('button',{name:'Send message',exact:true});
  await send.click();await send.click({force:true,timeout:500}).catch(()=>{});
  await expect(stop).toBeVisible({timeout:10000});await stop.click();await stop.click({timeout:500}).catch(()=>{});
  await expect(stop).toHaveCount(0,{timeout:15000});
  assert.ok(requests.filter(r=>r.last==='slow burst').length<=1,'one send for a double click');
  console.log('PASS MonkeyBurstSettles');

  // Monkey: reload the page mid CLI turn. The new page shows the turn running and its partial reply once, then the reply.
  // A burst Stop that landed after the first part keeps that aborted partial on screen: count, do not expect one.
  const partial=page.getByText('first part,',{exact:true});const aborted=await partial.count();
  await composer.fill('slow during reload');await send.click();
  await expect(partial).toHaveCount(aborted+1,{timeout:10000});
  // Not the composer: mid-turn its placeholder reads "steer the agent".
  await page.reload();
  await expect(stop).toBeVisible({timeout:5000});
  await expect(partial).toHaveCount(aborted+1);
  await expect(page.getByText('slow during reload',{exact:true})).toHaveCount(1);
  await expect(page.getByText('first part, reply to slow during reload',{exact:true})).toBeVisible({timeout:15000});
  await expect(stop).toHaveCount(0,{timeout:10000});
  assert.equal(requests.filter(r=>r.last==='slow during reload').length,1);
  console.log('PASS MonkeyReloadMidCliTurn');

  // The CLI closes: the composer goes back to the web runtime.
  cli.stdin.write(JSON.stringify({stop:true})+'\n');
  await wait(()=>cli.exitCode!==null,'the CLI process exited');
  await sendFromWeb('after the cli closed');
  assert.deepEqual(requests.filter(r=>r.last==='after the cli closed').map(r=>r.side),['web']);
  console.log('PASS ClosedCliFallsBackToWeb');
  assert.deepEqual(pageErrors,[]);
}finally{
  await browser?.close();
  if(cli&&cli.exitCode===null){cli.stdin.write(JSON.stringify({stop:true})+'\n');cli.stdin.end();await new Promise(resolve=>{cli.once('exit',resolve);setTimeout(()=>{cli.kill();resolve()},4000)});}
  await server?.stop();endpoint.closeAllConnections();endpoint.close();
  await fs.rm(root,{recursive:true,force:true});
}
