import {createHash} from 'node:crypto';
import {ImapFlow} from 'imapflow';
import {simpleParser} from 'mailparser';
import {parseStatement} from '../core.js';

export class ImportError extends Error {constructor(code,message,status=400){super(message);this.code=code;this.status=status;}}
export function isCreditStatement(subject,addresses=[]){
 if(!/账单|statement/i.test(subject))return false;
 if(/信用卡|贷记卡|龙卡|金穗|牡丹|华夏银行|光大银行|建设银行|招商银行|农业银行|工商银行|中信银行|交通银行|民生银行|credit\s*card/i.test(subject))return true;
 return addresses.some(address=>/(?:^|@|\.)(?:cmbchina\.com|bankcomm\.com|ecitic\.com|citicbank\.com|ccb\.com|abchina\.com|icbc\.com\.cn|cmbc\.com\.cn|cebbank\.com|hxb\.com\.cn)$/i.test(address));
}
export function validateCredentials(data){
 if(!data||typeof data!=='object'||data.consent!==true)throw new ImportError('CONSENT_REQUIRED','请先同意本次临时读取邮箱账单。');
 const email=String(data.email||'').trim().toLowerCase(),authCode=String(data.authCode||'').replace(/\s/g,'');
 if(!/^[a-z0-9][a-z0-9._-]{1,63}@qq\.com$/.test(email))throw new ImportError('EMAIL_INVALID','首版仅支持 QQ 邮箱，请填写完整的 @qq.com 地址。');
 if(!/^[a-zA-Z]{16}$/.test(authCode))throw new ImportError('AUTH_CODE_INVALID','请输入 QQ 邮箱生成的 16 位授权码，不是 QQ 登录密码。');
 const days=Number(data.days??120);if(![90,120,180,365].includes(days))throw new ImportError('RANGE_INVALID','请选择支持的查询时间范围。');
 return {email,authCode,days};
}

export function candidateFromMail(mail,{email,folder,uid}){
 const subject=String(mail.subject||'').slice(0,200),body=String(mail.text||'').slice(0,180000);
 if(!isCreditStatement(subject,(mail.from?.value||[]).map(x=>x.address||'')))return null;
 const parsed=parseStatement(subject+'\n'+body);
 if(!parsed.period){const periods=[...new Set([...subject.matchAll(/(20\d{2})\s*[年/-]\s*(1[0-2]|0?[1-9])(?!\d)\s*月?[^\n]{0,12}账单/g)].map(m=>m[1]+'-'+m[2].padStart(2,'0')))];if(periods.length===1)parsed.period=periods[0];}
 if(parsed.minimum&&parsed.amount&&Number(parsed.minimum)>Number(parsed.amount)){parsed.minimum='';parsed.warnings.push('最低还款额存在冲突，请查看原文核对。');}
 const id=createHash('sha256').update(JSON.stringify([email,folder,uid])).digest('hex').slice(0,24);
 const warnings=[...new Set([...parsed.warnings,'自动识别尚未完成所有银行模板验证，请按原文核对后保存。'])];
 return {id,subject,date:mail.date instanceof Date&&!Number.isNaN(+mail.date)?mail.date.toISOString().slice(0,10):'',...parsed,warnings,preview:body.slice(0,10000),folder};
}

// No persistent credential store, raw email logs, attachments or remote-image requests.
export async function readMailbox(input,{clientFactory=options=>new ImapFlow(options),parseMail=simpleParser,now=new Date(),signal}={}){
 const {email,authCode,days}=validateCredentials(input);
 const client=clientFactory({host:'imap.qq.com',port:993,secure:true,tls:{minVersion:'TLSv1.2',rejectUnauthorized:true},auth:{user:email,pass:authCode},logger:false,disableAutoIdle:true,connectionTimeout:15000,greetingTimeout:15000,socketTimeout:20000,clientInfo:{name:'Bill Reminder',version:'1.1'}});
 const onAbort=()=>client.close();signal?.addEventListener('abort',onAbort,{once:true});
 const timeout=setTimeout(()=>client.close(),90000);timeout.unref?.();
 let inspected=0,skippedLarge=0,failed=0,truncated=false,foldersScanned=0;const candidates=[],notes=[];
 client.on?.('error',()=>{});
 try{
  if(signal?.aborted)throw new ImportError('CANCELLED','本次导入已取消。',499);
  await client.connect();
  const listed=await client.list();
  const folders=listed.filter(f=>!f.flags?.has('\\Noselect')&&!/\\(?:Junk|Trash|Sent|Drafts)/i.test(f.specialUse||'')&&!/(^|[/.])(spam|trash|junk|sent|drafts|deleted)([/.]|$)|垃圾|已删除|已发送|草稿/i.test(f.path));
  folders.sort((a,b)=>a.path==='INBOX'?-1:b.path==='INBOX'?1:a.path.localeCompare(b.path));
  if(folders.length>12){truncated=true;notes.push('文件夹较多，本次仅检查前 12 个可读文件夹。');}
  const since=new Date(+now-days*86400000);
  for(const folder of folders.slice(0,12)){
   if(inspected>=60){truncated=true;break;}
   let lock;
   try{
    lock=await client.getMailboxLock(folder.path,{readOnly:true});foldersScanned++;
    const found=await client.search({since,or:[{subject:'账单'},{subject:'statement'}]},{uid:true});
    const ids=(Array.isArray(found)?found:[]).sort((a,b)=>b-a);
    if(ids.length>60-inspected)truncated=true;
    for(const uid of ids.slice(0,60-inspected)){
     if(signal?.aborted)throw new ImportError('CANCELLED','本次导入已取消。',499);
     inspected++;
     const meta=await client.fetchOne(uid,{size:true,envelope:true},{uid:true});
     if(!meta)continue;
     if(!Number.isFinite(meta.size)||meta.size>1024*1024){skippedLarge++;continue;}
     if(!isCreditStatement(meta.envelope?.subject||'',(meta.envelope?.from||[]).map(x=>x.address||'')))continue;
     const message=await client.fetchOne(uid,{source:true},{uid:true});
     if(!message?.source||message.source.length>1024*1024){skippedLarge++;continue;}
     try{
      const mail=await parseMail(message.source,{skipHtmlToText:false,skipTextToHtml:true,skipImageLinks:true,maxHtmlLengthToParse:180000});
      const candidate=candidateFromMail(mail,{email,folder:folder.path,uid});if(candidate)candidates.push(candidate);
     }catch{failed++;}
    }
   }finally{lock?.release();}
  }
  if(skippedLarge)notes.push(`${skippedLarge} 封邮件超过读取大小上限，请通过邮件文件或手动导入。`);
  if(failed)notes.push(`${failed} 封邮件未能解析，请手动核对。`);
  if(truncated)notes.push('本次读取达到范围上限，结果不代表整个邮箱或全部最新账单。');
  return {candidates,inspected,foldersScanned,skippedLarge,truncated,notes,rangeDays:days};
 }catch(error){
  if(error instanceof ImportError)throw error;
  if(error.authenticationFailed||/AUTHENTICATIONFAILED|Invalid login/i.test(String(error.responseText||'')))throw new ImportError('LOGIN_FAILED','邮箱验证失败。请检查邮箱地址、授权码及 IMAP 服务是否开启。',401);
  throw new ImportError('MAILBOX_UNAVAILABLE','暂时无法读取 QQ 邮箱，请稍后重试，并检查 IMAP 服务和授权码。',502);
 }finally{
  clearTimeout(timeout);signal?.removeEventListener('abort',onAbort);
  try{if(client.usable)await Promise.race([client.logout(),new Promise(resolve=>{const t=setTimeout(resolve,1000);t.unref?.();})]);}catch{}finally{client.close();}
 }
}
