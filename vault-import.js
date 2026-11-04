/* Local-only spreadsheet parsing. Never evaluates formulas, follows links,
   logs cell values, or persists the workbook. No real credentials in tests. */
(function(root){
 'use strict';
 const MAX_ROWS=2000,MAX_COLS=64,MAX_FILE=5_000_000;
 const str=value=>String(value??'');
 const identity=row=>JSON.stringify([str(row.label).trim().toLowerCase(),str(row.username).trim()]);
 function validUrl(value){try{const u=new URL(value);return u.protocol==='https:'&&!!u.hostname&&!u.username&&!u.password&&!/\s/.test(value);}catch{return false;}}
 function readXlsx(bytes,zip,Parser){
  if(bytes.length>MAX_FILE)throw new Error('Choose an Excel file smaller than 5 MB.');
  let size=0,files;
  try{files=zip.unzipSync(bytes,{filter:file=>{
   if(!/^xl\/(workbook\.xml|_rels\/workbook\.xml\.rels|sharedStrings\.xml|styles\.xml|worksheets\/[A-Za-z0-9_.-]+\.xml|worksheets\/_rels\/[A-Za-z0-9_.-]+\.xml\.rels)$/.test(file.name))return false;
   if(!Number.isSafeInteger(file.originalSize)||file.originalSize<0||file.originalSize>10_000_000||(size+=file.originalSize)>20_000_000)throw new Error('Workbook is too large.');
   return true;
  }});}catch{throw new Error('This workbook could not be read or exceeds the size limit. Use an unencrypted .xlsx file.');}
  const all=(node,name)=>Array.from(node.getElementsByTagNameNS('*',name));
  function parse(name){
   if(!files[name])throw new Error('Required workbook data is missing.');
   const source=new TextDecoder().decode(files[name]);
   if(/<!DOCTYPE|<!ENTITY/i.test(source))throw new Error('Unsupported workbook XML.');
   let doc;try{doc=new Parser().parseFromString(source,'application/xml');}catch{throw new Error('Workbook XML could not be read.');}
   if(!doc?.documentElement||doc.getElementsByTagName('parsererror').length)throw new Error('Workbook XML could not be read.');
   return doc;
  }
  const strings=files['xl/sharedStrings.xml']?all(parse('xl/sharedStrings.xml'),'si').map(si=>all(si,'t').map(t=>t.textContent).join('')):[];
  const formats=new Map(),styles=[];
  if(files['xl/styles.xml']){const doc=parse('xl/styles.xml');for(const f of all(doc,'numFmt'))formats.set(f.getAttribute('numFmtId'),f.getAttribute('formatCode'));const cellXfs=all(doc,'cellXfs')[0];if(cellXfs)for(const f of all(cellXfs,'xf'))styles.push(f.getAttribute('numFmtId')||'0');}
  const targets=new Map(all(parse('xl/_rels/workbook.xml.rels'),'Relationship').filter(r=>r.getAttribute('TargetMode')!=='External').map(r=>[r.getAttribute('Id'),r.getAttribute('Target')]));
  const sheets=all(parse('xl/workbook.xml'),'sheet');if(sheets.length>30)throw new Error('Workbook has too many sheets. Keep at most 30 sheets.');
  return sheets.map(sheet=>{
   const target=targets.get(sheet.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships','id'))||'';
   const path=target.startsWith('/')?target.slice(1):'xl/'+target;
   if(!/^xl\/worksheets\/[A-Za-z0-9_.-]+\.xml$/.test(path))throw new Error('Unsupported worksheet path.');
   const doc=parse(path),relationships=new Map(),relPath=path.replace('/worksheets/','/worksheets/_rels/')+'.rels';
   if(files[relPath])for(const r of all(parse(relPath),'Relationship'))if((r.getAttribute('Type')||'').endsWith('/hyperlink')&&validUrl(r.getAttribute('Target')||''))relationships.set(r.getAttribute('Id'),r.getAttribute('Target'));
   const links=new Map();for(const h of all(doc,'hyperlink')){const link=relationships.get(h.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships','id'));if(link)links.set(h.getAttribute('ref'),link);}
   const rows=[];let columns=0;
   for(const row of all(doc,'row')){
    if(rows.length>=MAX_ROWS+1)throw new Error('A sheet exceeds 2,000 rows. Split it into smaller files.');
    const cells=[];
    for(const c of all(row,'c')){
     const match=/^([A-Z]+)([1-9]\d*)$/.exec(c.getAttribute('r')||'');if(!match)throw new Error('Invalid workbook cell reference.');
     let col=0;for(const ch of match[1])col=col*26+ch.charCodeAt(0)-64;if(col>MAX_COLS)throw new Error('A sheet exceeds 64 columns.');
     let value=all(c,'v')[0]?.textContent??'',problem='';const type=c.getAttribute('t');
     if(type==='s'){if(!/^\d+$/.test(value)||strings[Number(value)]===undefined)throw new Error('Invalid workbook text reference.');value=strings[Number(value)];}
     else if(type==='inlineStr')value=all(c,'t').map(t=>t.textContent).join('');
     else if(type==='e'||type==='b')problem='Excel error or Boolean cell needs review';
     else if(value){const fmt=styles[Number(c.getAttribute('s')||0)]||'0',pattern=formats.get(fmt);if(pattern&&/^0{1,30}$/.test(pattern)&&/^\d+$/.test(value))value=value.padStart(pattern.length,'0');else if(fmt!=='0'&&fmt!=='1'&&fmt!=='49')problem='Numeric formatting needs review';}
     if(value.length>10000)throw new Error('A workbook cell exceeds the supported size.');
     cells[col-1]={value,formula:all(c,'f').length>0,problem,link:links.get(c.getAttribute('r'))||''};columns=Math.max(columns,col);
    }
    if(cells.some(c=>c?.value||c?.formula))rows.push({number:Number(row.getAttribute('r')),cells});
   }
   return {name:sheet.getAttribute('name')||'Sheet',hidden:(sheet.getAttribute('state')||'visible')!=='visible',rows,columns};
  });
 }
 function headerKind(value){
  const s=str(value).trim().toLowerCase().replace(/[_\-/#]+/g,' ');
  if(/\b(pass(word|code|wd)?|pwd|pw)\b/.test(s))return 'password';
  if(/\b(url|website address|web address|link)\b/.test(s))return 'url';
  if(/\b(user(name)?|login|email|e mail|account)\b/.test(s)&&!s.includes('name of site'))return 'username';
  if(/\b(site|website|service|company|title|name)\b/.test(s))return 'label';
  if(/\b(note(s)?|comment(s)?|description)\b/.test(s))return 'notes';
  return '';
 }
 function detect(sheet){
  const first=sheet.rows[0]?.cells||[],mapping={label:-1,username:-1,password:-1,url:-1,notes:-1};let found=0;
  first.forEach((c,i)=>{const kind=headerKind(c?.value);if(kind&&mapping[kind]===-1){mapping[kind]=i;found++;}});
  const headers=found>=2;
  if(!headers)return {headers:false,mapping:{label:0,username:sheet.columns>1?1:-1,password:sheet.columns>2?2:-1,url:-1,notes:-1}};
  const used=new Set(Object.values(mapping).filter(i=>i>=0));if(mapping.label<0){const unused=Array.from({length:sheet.columns},(_,i)=>i).find(i=>!used.has(i));if(unused!==undefined)mapping.label=unused;}
  return {headers,mapping};
 }
 function preview(sheet,mapping,headers=true){
  const fields=Object.keys(mapping),chosen=Object.values(mapping).filter(i=>i>=0);if(new Set(chosen).size!==chosen.length)throw new Error('Choose a different column for each field.');
  if(['label','username','password'].some(k=>!Number.isInteger(mapping[k])||mapping[k]<0))throw new Error('Choose columns for site name, username, and password.');
  const rows=sheet.rows.slice(headers?1:0).map(row=>{
   const result={row:row.number,label:'',username:'',password:'',url:'',notes:'',issues:[],duplicate:false,existing:false};
   for(const key of fields){const cell=row.cells[mapping[key]];result[key]=cell?.value||'';if(cell?.formula)result.issues.push('Formula cells must be replaced with plain values');if(cell?.problem)result.issues.push(cell.problem);}
   for(const key of ['label','username','url'])result[key]=result[key].trim();
   if(!result.url){for(const key of ['label','username']){const link=row.cells[mapping[key]]?.link;if(link){result.url=link;break;}}}
   result.issues=validate(result).concat(result.issues);return result;
  });
  const groups=new Map();for(const row of rows){const key=identity(row);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(row);}for(const group of groups.values())if(group.length>1)for(const row of group)row.duplicate=true;
  return rows;
 }
 function validate(row){const issues=[];if(!str(row.label).trim())issues.push('Site name is missing');else if(str(row.label).trim().length>120)issues.push('Site name exceeds 120 characters');if(!str(row.username).trim())issues.push('Username is missing');else if(str(row.username).trim().length>254)issues.push('Username exceeds 254 characters');if(!str(row.password).length)issues.push('Password is missing');else if(str(row.password).length>2000)issues.push('Password exceeds 2,000 characters');if(str(row.url).length>2000||row.url&&!validUrl(row.url))issues.push('Use an HTTPS URL without embedded credentials');if(str(row.notes).length>4000)issues.push('Notes exceed 4,000 characters');return issues;}
 const api={readXlsx,detect,preview,validate,identity,validUrl,MAX_FILE};
 if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.A1VaultImport=api;
})(typeof window!=='undefined'?window:globalThis);
