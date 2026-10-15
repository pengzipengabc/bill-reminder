import {BANKS} from './core.js';
export function setupMailbox({openEditor,openManualImport,toast,esc}){
 const $=id=>document.getElementById(id);let available=false,scanning=false,candidates=[];
 async function probe(){
  $('mailboxFields').disabled=true;$('mailboxServiceStatus').textContent='正在检查邮箱连接服务…';
  try{const response=await fetch('./api/mail/status',{cache:'no-store',redirect:'error',credentials:'same-origin',signal:AbortSignal.timeout(10000)});if(!response.ok)throw Error();const status=await response.json();available=status.enabled===true;
   $('mailboxServiceStatus').textContent=available?'邮箱连接服务已就绪。本次连接信息只临时用于读取，不保存授权码。':'邮箱连接后台尚未开通。本页不会收集授权码，可先导入邮件文件或手动填写。';
  }catch{available=false;$('mailboxServiceStatus').textContent='当前网址尚未接入邮箱后台，暂不能直接连接邮箱。不会收集授权码；可先使用邮件文件导入。';}
  $('mailboxFields').disabled=!available||scanning;
 }
 function open(){candidates=[];$('mailboxResults').replaceChildren();$('mailboxResultSummary').textContent='';$('mailboxAuthCode').value='';$('mailboxConsent').checked=false;$('mailboxDialog').showModal();probe();}
 $('mailboxRetry').onclick=probe;
 $('mailboxManualImport').onclick=()=>{$('mailboxDialog').close();openManualImport();};
 $('mailboxForm').onsubmit=async event=>{
  event.preventDefault();if(!available||scanning)return;
  const email=$('mailboxEmail').value.trim(),authCode=$('mailboxAuthCode').value.replace(/\s/g,''),days=Number($('mailboxDays').value);
  if(!/^[a-zA-Z]{16}$/.test(authCode))return toast('请填写 16 位邮箱授权码，不是 QQ 登录密码。');
  if(!$('mailboxConsent').checked)return toast('请先同意本次临时读取账单。');
  scanning=true;$('mailboxFields').disabled=true;$('mailboxServiceStatus').textContent='正在连接 QQ 邮箱并查找账单，请保持页面打开。';
  $('mailboxAuthCode').value='';
  try{
   const response=await fetch('./api/mail/import',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',redirect:'error',referrerPolicy:'no-referrer',cache:'no-store',body:JSON.stringify({email,authCode,days,consent:true}),signal:AbortSignal.timeout(100000)});
   let data;try{data=await response.json();}catch{throw Error('邮箱服务响应异常，请稍后重试。');}
   if(!response.ok)throw Error(data.message||'邮箱读取失败，请重试。');
   if(!Array.isArray(data.candidates))throw Error('账单结果格式异常，未保存任何账单。');
   candidates=data.candidates.slice(0,60);
   $('mailboxServiceStatus').textContent='读取已结束，授权码未保存在网页中。请逐份核对后导入。';
   $('mailboxResultSummary').textContent=`检查了 ${Number(data.inspected)||0} 封候选邮件，找到 ${candidates.length} 份待核对账单。${Array.isArray(data.notes)?data.notes.join(' '):''}`;
   $('mailboxResults').innerHTML=candidates.map((c,i)=>{const bank=BANKS.find(b=>b.id===c.bank)?.name||'银行待确认';return `<article class="mailbox-result"><b>${esc(bank)}${c.tail?' · '+esc(c.tail):''}</b><p>${esc(c.subject||'电子账单')}</p><p>账单金额：${c.amount?'¥'+esc(c.amount):'待核对'} · 最低还款：${c.minimum?'¥'+esc(c.minimum):'待核对'}</p><p>还款日：${esc(c.due||'待核对')} · 账期：${esc(c.period||'待核对')}</p><button class="secondary" type="button" data-mail-candidate="${i}">核对并导入</button></article>`;}).join('');
   if(!candidates.length)$('mailboxResultSummary').textContent+=' 可扩大时间范围，或导入账单邮件文件。';
  }catch(error){$('mailboxServiceStatus').textContent=error.name==='TimeoutError'?'读取超时，请稍后重试。本次未自动保存账单。':error.message||'读取失败，请稍后重试。';}
  finally{scanning=false;$('mailboxFields').disabled=!available;$('mailboxConsent').checked=false;}
 };
 $('mailboxResults').onclick=event=>{const button=event.target.closest('[data-mail-candidate]');if(!button)return;const c=candidates[Number(button.dataset.mailCandidate)];if(!c)return;
  $('mailboxDialog').close();openEditor(c);$('mailboxReviewText').textContent=c.preview||'邮件没有可读取的文字正文，请查看原始邮件。';$('mailboxReview').hidden=false;
 };
 $('mailboxDialog').addEventListener('close',()=>{$('mailboxAuthCode').value='';});
 return {open};
}
