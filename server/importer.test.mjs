import test from 'node:test';import assert from 'node:assert/strict';
import {readMailbox,validateCredentials,candidateFromMail,isCreditStatement} from './importer.mjs';
const input={email:'sample@qq.com',authCode:'abcdefghijklmnop',consent:true,days:120};
const title='招商银行2026年10月信用卡账单';
const body='招商银行\n卡号尾号：1234\n账单月份：2026年10月\n本期应还金额：人民币 1,234.56\n最低还款额：123.45\n最后还款日：2026年11月02日';
test('requires explicit consent, QQ address, provider code and bounded dates',()=>{
 assert.throws(()=>validateCredentials({...input,consent:false}));assert.throws(()=>validateCredentials({...input,email:'x@attacker.invalid'}));assert.throws(()=>validateCredentials({...input,authCode:'my-login-password'}));assert.throws(()=>validateCredentials({...input,days:10000}));
 assert.equal(validateCredentials(input).authCode,input.authCode);
});
test('utility statements are excluded; credit-card keywords or known bank senders required',()=>{
 assert.equal(isCreditStatement('水费账单',['service@utility.invalid']),false);assert.equal(isCreditStatement('电子账单',['service@vip.cmbchina.com']),true);
 assert.equal(isCreditStatement('电子账单',['sender@fakecmbchina.com']),false);assert.equal(isCreditStatement(title),true);
 assert.equal(candidateFromMail({subject:'水费账单',text:body},{email:input.email,folder:'INBOX',uid:1}),null);
});
test('statement candidate keeps uncertain fields blank and never substitutes minimum for total',()=>{
 const c=candidateFromMail({subject:title,text:'最低还款额：100.00\n可用额度：10000.00',date:new Date('2026-10-15')},{email:input.email,folder:'INBOX',uid:1});
 assert.equal(c.amount,'');assert.equal(c.minimum,'100.00');assert.equal(c.period,'2026-10');assert.equal(c.due,'');assert.ok(c.warnings.length);assert.equal(c.id.length,24);
});
test('mailbox reads use fixed TLS host, read-only locks, no raw logs, no SMTP and skip huge mail',async()=>{
 let options,released=0,closed=0,fetches=0;const locks=[];
 const result=await readMailbox(input,{clientFactory:o=>{options=o;return {
  usable:true,on(){},async connect(){},async list(){return [{path:'INBOX',flags:new Set()},{path:'Sent',flags:new Set(),specialUse:'\\Sent'}];},
  async getMailboxLock(path,config){locks.push([path,config]);return{release(){released++;}};},async search(){return [1,2];},
  async fetchOne(uid,query){fetches++;if(query.size)return{size:uid===2?3*1024*1024:200,envelope:{subject:title,from:[{address:'s@cmbchina.com'}]}};return{source:Buffer.from('fake MIME')};},async logout(){},close(){closed++;}
 };},parseMail:async()=>({subject:title,text:body,date:new Date('2026-10-15')})});
 assert.equal(options.host,'imap.qq.com');assert.equal(options.port,993);assert.equal(options.secure,true);assert.equal(options.tls.rejectUnauthorized,true);assert.equal(options.logger,false);
 assert.deepEqual(locks,[['INBOX',{readOnly:true}]]);assert.equal(result.candidates.length,1);assert.equal(result.skippedLarge,1);assert.equal(released,1);assert.ok(closed);assert.equal(fetches,3);
 assert.equal(result.candidates[0].amount,'1234.56');assert.equal(result.candidates[0].minimum,'123.45');
 assert.equal(JSON.stringify(result).includes(input.authCode),false);
});
test('real MIME parser handles base64 content and returns text without rendering tracking images',async()=>{
 const raw=Buffer.from('From: Bank <service@cmbchina.com>\r\nSubject: =?UTF-8?B?'+Buffer.from(title).toString('base64')+'?=\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n'+Buffer.from(body).toString('base64'));
 const result=await readMailbox(input,{clientFactory:()=>({usable:true,on(){},async connect(){},async list(){return[{path:'INBOX',flags:new Set()}];},async getMailboxLock(){return{release(){}};},async search(){return[1];},async fetchOne(uid,query){return query.size?{size:raw.length,envelope:{subject:title}}:{source:raw};},async logout(){},close(){}})});
 assert.equal(result.candidates[0].due,'2026-11-02');assert.equal(result.candidates[0].tail,'1234');assert.equal(result.candidates[0].bank,'cmb');
});
