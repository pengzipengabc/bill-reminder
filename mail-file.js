export function htmlToText(html){
 // Extract text without constructing a document, so email tracking images and
 // other remote resources cannot load during import.
 const plain=html.replace(/<!--[^]*?-->/g,'').replace(/<(script|style|head|iframe|object)\b[^>]*>[^]*?<\/\1\s*>/gi,'').replace(/<\s*(?:br\b[^>]*|\/(?:p|div|tr|td|li|table)\s*)>/gi,'\n').replace(/<[^>]*>/g,'');
 const entities={nbsp:' ',amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",yen:'¥'};
 return plain.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi,(m,key)=>{if(key[0]!=='#')return entities[key.toLowerCase()]??m;const n=key[1].toLowerCase()==='x'?parseInt(key.slice(2),16):Number(key.slice(1));return n>0&&n<=0x10ffff?String.fromCodePoint(n):'';});
}
function decodeBytes(bytes,charset){try{return new TextDecoder(charset||'utf-8').decode(bytes);}catch{return new TextDecoder('utf-8').decode(bytes);}}
export function mimeText(input,depth=0){
 if(depth>12)throw Error('邮件嵌套过深，请直接复制正文。');
 const split=input.search(/\r?\n\r?\n/);if(split<0)return input;
 const headers=input.slice(0,split).replace(/\r?\n[ \t]+/g,' '),body=input.slice(split).replace(/^\r?\n\r?\n/,'');
 const ct=headers.match(/^Content-Type:\s*(.+)$/im)?.[1]||'text/plain';
 if(/multipart\//i.test(ct)){const boundary=ct.match(/boundary\s*=\s*(?:"([^"]+)"|([^;\s]+))/i);if(!boundary)throw Error('邮件格式无法识别，请复制正文。');const parts=body.split('--'+(boundary[1]||boundary[2])).slice(1).filter(p=>!p.startsWith('--')).map(p=>p.replace(/^\r?\n/,'')).filter(p=>!/^Content-Disposition:.*attachment/im.test(p));const texts=parts.map(p=>mimeText(p,depth+1)).filter(Boolean);return [...new Set(texts)].join('\n');}
 if(!/^text\/(plain|html)/i.test(ct))return '';
 const charset=ct.match(/charset\s*=\s*"?([^;"\s]+)/i)?.[1]||'utf-8';
 const encoding=headers.match(/^Content-Transfer-Encoding:\s*(.+)$/im)?.[1]?.trim().toLowerCase();let out=body;
 if(encoding==='base64'){const bin=atob(body.replace(/\s/g,''));out=decodeBytes(Uint8Array.from(bin,c=>c.charCodeAt(0)),charset);}
 else if(encoding==='quoted-printable'){const s=body.replace(/=\r?\n/g,'');const bytes=[];for(let i=0;i<s.length;i++){if(s[i]==='='&&/^[0-9a-f]{2}$/i.test(s.slice(i+1,i+3))){bytes.push(parseInt(s.slice(i+1,i+3),16));i+=2;}else bytes.push(s.charCodeAt(i)&255);}out=decodeBytes(new Uint8Array(bytes),charset);}
 // The outer file has already been decoded as UTF-8. Common raw legacy EML
 // should be transfer-encoded; leave uncertain text for manual correction.
 return /^text\/html/i.test(ct)?htmlToText(out):out;
}

export function extractMailFile(name,bytes){
 if(bytes.byteLength>2*1024*1024)throw Error('文件超过 2MB，请复制需要的账单正文。');
 const ext=String(name).split('.').pop().toLowerCase();
 if(!['txt','html','htm','eml'].includes(ext))throw Error('请选择 EML、HTML 或 TXT 文件。Outlook MSG、PDF 与图片暂不支持。');
 const raw=new TextDecoder('utf-8').decode(bytes);
 const text=ext==='eml'?mimeText(raw):['html','htm'].includes(ext)?htmlToText(raw):raw;
 if(text.length>200000)throw Error('正文过长，请只保留当前账单部分。');
 if(!text.trim())throw Error('未找到文字正文。图片或附件账单请手动填写。');
 return text;
}
