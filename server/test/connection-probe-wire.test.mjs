import assert from 'node:assert/strict';
import {rm} from 'node:fs/promises';
import test from 'node:test';
import {makeWorkspace,startServer,connect} from './harness.mjs';

test('connection probe answers only its owner without starting a model turn', async t=>{
 const root=await makeWorkspace();t.after(()=>rm(root,{recursive:true,force:true}));
 const server=await startServer(root,{sandbox:false,noExtensions:true},{env:{PI_OFFLINE:'1',ANTHROPIC_API_KEY:'fixture-no-model-requests'}});t.after(()=>server.stop());
 const a=connect(server.wsUrl()),b=connect(server.wsUrl());t.after(()=>{a.close();b.close()});
 await Promise.all([a.waitFor('hello'),b.waitFor('hello')]);
 a.send({type:'connection_probe',requestId:'live-a'});
 assert.deepEqual(await a.waitFor(m=>m.type==='connection_probe_ack'),{type:'connection_probe_ack',requestId:'live-a'});
 await new Promise(resolve=>setTimeout(resolve,100));
 assert.equal(b.received.some(m=>m.type==='connection_probe_ack'),false);
 a.send({type:'connection_probe',requestId:'x'.repeat(65)});
 await new Promise(resolve=>setTimeout(resolve,100));
 assert.equal(a.received.filter(m=>m.type==='connection_probe_ack').length,1);
});
