import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {readMailbox,validateCredentials,ImportError} from './importer.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const staticFiles=new Set(['index.html','app.js','core.js','style.css','icon.svg','manifest.webmanifest','reminder-core.js','reminders.js','reminder-sw.js','mailbox.js']);
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.webmanifest':'application/manifest+json'};
export function createApp({importMailbox=readMailbox,origin=process.env.APP_ORIGIN||process.env.RENDER_EXTERNAL_URL||'',enabled=process.env.MAILBOX_IMPORT_ENABLED==='true'}={}){
 let active=0;const attempts=new Map();
 const originValid=/^https:\/\/[^/]+$/.test(origin)||/^http:\/\/127\.0\.0\.1:\d+$/.test(origin);
 const ready=enabled&&originValid;
 const server=http.createServer(async(req,res)=>{
  res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Frame-Options','DENY');
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; worker-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'");
  const json=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(data));};
  const url=new URL(req.url,'http://localhost');
  if(req.method==='GET'&&url.pathname==='/api/mail/status')return json(200,{enabled:ready,provider:'qq',credentialStorage:'none',mode:'on-demand'});
  if(req.method==='GET'&&url.pathname==='/healthz')return json(200,{ok:true});
  if(url.pathname==='/api/mail/import'){
   if(req.method!=='POST')return json(405,{error:'METHOD_NOT_ALLOWED',message:'请使用邮箱连接页面。'});
   if(!ready)return json(503,{error:'NOT_CONFIGURED',message:'邮箱连接服务尚未启用，当前不会收集授权码。'});
   if(req.headers.origin!==origin||!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type']||''))return json(403,{error:'ORIGIN_REJECTED',message:'请从正式网页发起连接。'});
   // Key on socket address only. Public proxy deployment must enforce its own per-client rate limit.
   const ip=req.socket.remoteAddress||'unknown',now=Date.now();for(const [key,value]of attempts)if(value.until<=now)attempts.delete(key);
   const quota=attempts.get(ip)||{count:0,until:now+600000};quota.count++;attempts.set(ip,quota);
   if(quota.count>10)return json(429,{error:'RATE_LIMITED',message:'连接次数较多，请 10 分钟后重试。'});
   if(active>=2)return json(429,{error:'BUSY',message:'当前连接较多，请稍后重试。'});
   let raw='';try{for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>4096)return json(413,{error:'REQUEST_TOO_LARGE',message:'连接信息过长。'});}}catch{return;}
   let input;try{input=JSON.parse(raw);validateCredentials(input);}catch(error){return json(400,{error:error.code||'INVALID_REQUEST',message:error instanceof ImportError?error.message:'请检查连接信息。'});}
   active++;const abort=new AbortController();res.on('close',()=>{if(!res.writableEnded)abort.abort();});
   try{const result=await importMailbox(input,{signal:abort.signal});if(!res.destroyed)json(200,result);}catch(error){if(!res.destroyed)json(error instanceof ImportError?error.status:502,{error:error instanceof ImportError?error.code:'IMPORT_FAILED',message:error instanceof ImportError?error.message:'读取失败，请稍后重试。'});}finally{input.authCode='';raw='';active--;}
   return;
  }
  if(req.method!=='GET'&&req.method!=='HEAD')return json(405,{error:'METHOD_NOT_ALLOWED'});
  const file=url.pathname==='/'?'index.html':url.pathname.slice(1);if(!staticFiles.has(file))return json(404,{error:'NOT_FOUND'});
  try{const body=await fs.readFile(path.join(root,file));res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream'});res.end(req.method==='HEAD'?undefined:body);}catch{return json(404,{error:'NOT_FOUND'});}
 });
 server.requestTimeout=100000;server.headersTimeout=15000;return server;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const port=Number(process.env.PORT||3000);createApp().listen(port,'0.0.0.0',()=>console.log(`Bill reminder listening on port ${port}; no mailbox credentials logged.`));
}
