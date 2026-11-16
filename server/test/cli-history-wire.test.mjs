import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {makeWorkspace,startServer,connect} from './harness.mjs';

// openlore: scenario=CliHistorySearchAndProjectIsolation spec=session-search
// No CLI process needed: this is an on-disk version-3 session from Pi /resume.
test('CLI history appears for its cwd and searches opening messages, isolated per project',async t=>{
 const root=await makeWorkspace();const agentDir=path.join(root,'.pi-agent');
 const directory=path.join(agentDir,'sessions',`--${root.replace(/^[/\\]/,'').replace(/[/\\:]/g,'-')}--`);
 await mkdir(directory,{recursive:true});
 const file=path.join(directory,'cli.jsonl');
 const bytes=[{type:'session',version:3,id:'cli-session',cwd:root,timestamp:'2026-01-01T00:00:00Z'},
   {type:'message',id:'u1',parentId:null,timestamp:'2026-01-01T00:00:01Z',message:{role:'user',content:[{type:'text',text:'Question from earlier terminal'}]}},
   {type:'session_info',id:'n1',parentId:'u1',timestamp:'2026-01-01T00:00:02Z',name:'CLI private history'}]
  .map(x=>JSON.stringify(x)).join('\n')+'\n';
 await writeFile(file,bytes);
 const other=path.join(root,'other-project');await mkdir(other);
 const otherDirectory=path.join(agentDir,'sessions',`--${other.replace(/^[/\\]/,'').replace(/[/\\:]/g,'-')}--`);
 await mkdir(otherDirectory,{recursive:true});
 await writeFile(path.join(otherDirectory,'other.jsonl'),JSON.stringify({type:'session',version:3,id:'other-session',cwd:other})+'\n'+JSON.stringify({type:'session_info',name:'Other project terminal'})+'\n');
 const server=await startServer(root,{sandbox:false,noExtensions:true});t.after(()=>server.stop());
 const ws=connect(server.wsUrl());t.after(()=>ws.close());await ws.waitFor('hello');
 ws.send({type:'list_sessions'});const listed=await ws.waitFor(m=>m.type==='sessions');
 const entry=listed.sessions.find(s=>s.path===file);
 assert.ok(entry);assert.equal(entry.name,'CLI private history');assert.equal(entry.messageCount,undefined);
 ws.send({type:'search_sessions',query:'terminal',requestId:'q1'});
 const found=await ws.waitFor(m=>m.type==='session_search_results'&&m.requestId==='q1');
 assert.ok(found.sessions.some(s=>s.path===file));
 assert.equal(found.sessions.some(s=>s.id==='other-session'),false);
 ws.send({type:'open_project',root:other});
 await ws.waitFor(m=>m.type==='workspace_switched'&&m.workspace?.root===other,20000);
 ws.send({type:'list_sessions'});
 const otherList=await ws.waitFor(m=>m.type==='sessions'&&m.sessions.some(s=>s.id==='other-session'));
 assert.equal(otherList.sessions.some(s=>s.id==='cli-session'),false);
 ws.send({type:'switch_workspace',root});
 await ws.waitFor(m=>m.type==='workspace_switched'&&m.workspace?.root===root);
 ws.send({type:'list_sessions'});
 ws.send({type:'switch_workspace',root:other});
 const switched=await ws.waitFor(m=>m.type==='workspace_switched'&&m.workspace?.root===other);
 await new Promise(resolve=>setTimeout(resolve,300));
 assert.equal(ws.received.slice(ws.received.indexOf(switched)+1).some(m=>m.type==='sessions'&&m.sessions.some(s=>s.id==='cli-session')),false,
   'late history from the old binding must not appear under the new project');
});
