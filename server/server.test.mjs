import test from 'node:test';import assert from 'node:assert/strict';
import {createApp} from './index.mjs';
const configuredOrigin='http://127.0.0.1:7777';
async function serve(t,options){const server=createApp(options);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);}));return 'http://127.0.0.1:'+server.address().port;}
const creds={email:'sample@qq.com',authCode:'abcdefghijklmnop',consent:true};
test('unconfigured service refuses credentials before calling the mailbox reader',async t=>{
 let called=false;const url=await serve(t,{enabled:false,importMailbox:async()=>{called=true;}});
 assert.equal((await(await fetch(url+'/api/mail/status')).json()).enabled,false);
 assert.equal((await fetch(url+'/api/mail/import',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(creds)})).status,503);assert.equal(called,false);
});
test('cross-origin and form submissions are rejected; valid same-origin import works',async t=>{
 let calls=0;const url=await serve(t,{enabled:true,origin:configuredOrigin,importMailbox:async()=>{calls++;return{candidates:[],inspected:0};}});
 for(const headers of [{Origin:'https://foreign.invalid','Content-Type':'application/json'},{Origin:configuredOrigin,'Content-Type':'text/plain'}])assert.equal((await fetch(url+'/api/mail/import',{method:'POST',headers,body:JSON.stringify(creds)})).status,403);
 const response=await fetch(url+'/api/mail/import',{method:'POST',headers:{Origin:configuredOrigin,'Content-Type':'application/json'},body:JSON.stringify(creds)});
 assert.equal(response.status,200);assert.equal(calls,1);assert.equal(response.headers.get('cache-control'),'no-store');assert.equal(response.headers.get('access-control-allow-origin'),null);
});
test('static allowlist blocks server source, dependencies and secrets',async t=>{
 const url=await serve(t,{});for(const route of ['/server/index.mjs','/package.json','/.env','/locked-bills.js'])assert.equal((await fetch(url+route)).status,404);
 assert.equal((await fetch(url+'/')).status,200);assert.equal((await fetch(url+'/mailbox.js')).status,200);
});
test('internal failures never echo mailbox credentials to the browser',async t=>{
 const url=await serve(t,{enabled:true,origin:configuredOrigin,importMailbox:async input=>{throw Error('secret='+input.authCode);}});
 const response=await fetch(url+'/api/mail/import',{method:'POST',headers:{Origin:configuredOrigin,'Content-Type':'application/json'},body:JSON.stringify(creds)});
 assert.equal(response.status,502);assert.equal((await response.text()).includes(creds.authCode),false);
});
