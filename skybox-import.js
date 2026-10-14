/* Skybox exports are read locally; only reviewed imports are sent to Supabase. */
(function(root) {
  const schemas = {
    customer: ['Customer ID','Display Name','Email','First Name','Last Name','Company'],
    vendor: ['Vendor ID','Display Name','Email','Contact','Company'],
    invoice: ['Invoice ID','Invoice Date','Customer','Invoice Total','Outstanding Balance','Shipping','Payment Status'],
    purchase: ['Purchase ID','Purchase Date','Vendor','Ticket Qty','Ticket Cost','Non-Inventory Cost','Purchase Total','Outstanding Balance','Payment Status']
  };
  const clean = value => String(value ?? '').trim();
  function identify(headers) {
    const kinds = Object.keys(schemas).filter(kind => schemas[kind].every(h => headers.includes(h)));
    if (kinds.length !== 1) throw new Error('This sheet does not match a Skybox customer, vendor, invoice, or purchase export. Use the original report headings.');
    return kinds[0];
  }
  function table(rows, name) {
    const nonempty = rows.filter(row => row.some(value => clean(value)));
    if (!nonempty.length) throw new Error('The sheet is empty.');
    const headers = nonempty[0].map(clean);
    if (new Set(headers).size !== headers.length || headers.some(h => !h)) throw new Error('The export has blank or duplicate column headings.');
    const kind = identify(headers);
    if (nonempty.length > 20001) throw new Error('Export exceeds 20,000 rows. Split it into smaller files.');
    const records = nonempty.slice(1).map((row, index) => {
      if (row.length > headers.length && row.slice(headers.length).some(clean)) throw new Error('Row '+(index+2)+' has more cells than the headings.');
      return Object.fromEntries(headers.map((h,i) => [h,clean(row[i])]));
    });
    return { kind, name, records };
  }
  function csv(text) {
    const rows=[]; let row=[], value='', quoted=false, closed=false;
    text=text.replace(/^\uFEFF/,'');
    for(let i=0;i<text.length;i++) {
      const c=text[i];
      if(quoted) { if(c==='"') { if(text[i+1]==='"') {value+='"';i++;} else {quoted=false;closed=true;} } else value+=c; }
      else if(c==='"' && !value && !closed) quoted=true;
      else if(c===',' || c==='\n' || c==='\r') {
        row.push(value);value='';closed=false;
        if(c!==',') {rows.push(row);row=[];if(c==='\r'&&text[i+1]==='\n')i++;}
      } else { if(closed && c.trim()) throw new Error('Invalid quoted CSV cell.'); value+=c; }
    }
    if(quoted) throw new Error('The CSV contains an unclosed quoted cell.');
    if(value || row.length) {row.push(value);rows.push(row);} return rows;
  }
  function xlsx(bytes, zip, Parser) {
    let size=0;
    const files=zip.unzipSync(bytes,{filter: file => {
      if(!/^xl\/(workbook\.xml|_rels\/workbook\.xml\.rels|sharedStrings\.xml|worksheets\/sheet[^/]*\.xml)$/.test(file.name)) return false;
      size+=file.originalSize;
      if(file.originalSize>25_000_000 || size>60_000_000) throw new Error('Workbook is too large to preview. Split it into smaller files.');
      return true;
    }});
    const parse = name => {
      if(!files[name]) throw new Error('Workbook is missing '+name);
      const text=new TextDecoder().decode(files[name]);
      if(/<!DOCTYPE|<!ENTITY/i.test(text)) throw new Error('Unsupported XML declarations.');
      const doc=new Parser().parseFromString(text,'application/xml');
      if(doc.getElementsByTagName('parsererror').length) throw new Error('Workbook XML could not be read.');
      return doc;
    };
    const all=(node,name)=>Array.from(node.getElementsByTagNameNS('*',name));
    const strings=files['xl/sharedStrings.xml'] ? all(parse('xl/sharedStrings.xml'),'si').map(si=>all(si,'t').map(t=>t.textContent).join('')) : [];
    const rels=all(parse('xl/_rels/workbook.xml.rels'),'Relationship');
    const targets=new Map(rels.filter(r=>r.getAttribute('TargetMode')!=='External').map(r=>[r.getAttribute('Id'),r.getAttribute('Target')]));
    return all(parse('xl/workbook.xml'),'sheet').map(sheet=> {
      const id=sheet.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships','id');
      const target=targets.get(id)||'';
      const path=target.startsWith('/')?target.slice(1):'xl/'+target;
      if(!/^xl\/worksheets\/sheet[^/]*\.xml$/.test(path)) throw new Error('Unsupported worksheet path.');
      const rows=all(parse(path),'row').map(r=> {
        const row=[];
        for(const c of all(r,'c')) {
          const match=/^([A-Z]+)\d+$/.exec(c.getAttribute('r')||'');
          if(!match) throw new Error('Invalid cell reference.');
          let col=0;for(const ch of match[1])col=col*26+ch.charCodeAt(0)-64;
          if(col>200) throw new Error('Workbook contains more than 200 columns.');
          const type=c.getAttribute('t');const v=all(c,'v')[0];let value=clean(v?.textContent);
          if(all(c,'f').length && !v) throw new Error('Formula values are missing. Recalculate and save the export in Excel.');
          if(type==='s') { if(!/^\d+$/.test(value)||strings[Number(value)]===undefined)throw new Error('Invalid shared text reference.');value=strings[Number(value)]; }
          else if(type==='inlineStr') value=all(c,'t').map(t=>t.textContent).join('');
          // Preserve report errors in original fields; required money/date fields fail conversion validation.
          while(row.length<col)row.push('');row[col-1]=value;
        }
        return row;
      });
      return table(rows,sheet.getAttribute('name'));
    });
  }
  function amount(value, label, optional=false) {
    let s=clean(value);
    if(!s && optional) return 0;
    if(/^\(.*\)$/.test(s))s='-'+s.slice(1,-1);
    s=s.replace(/^\$/,'');
    if(!/^-?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(s))throw new Error(label+' is missing or not a valid dollar amount.');
    const n=Number(s.replaceAll(',',''));
    if(!Number.isFinite(n)||Math.abs(n)>1e10)throw new Error(label+' is outside the supported range.');
    if(Math.abs(n*100-Math.round(n*100))>0.0001)throw new Error(label+' contains fractions of a cent.');
    return Math.round(n*100)/100;
  }
  function date(value, label) {
    const s=clean(value);if(!s)return '';
    const m=/^(\d{2})\/(\d{2})\/(\d{4})(?: (\d{1,2}):(\d{2}) (AM|PM))?$/.exec(s);
    if(!m)throw new Error(label+' must use the Skybox MM/DD/YYYY format.');
    const iso=m[3]+'-'+m[1]+'-'+m[2];const d=new Date(iso+'T12:00:00Z');
    if(!Number.isFinite(d.valueOf())||d.toISOString().slice(0,10)!==iso)throw new Error(label+' is invalid.');
    return iso;
  }
  function contact(kind,r) {
    const id=clean(r[kind==='customer'?'Customer ID':'Vendor ID']);
    if(!/^\d+$/.test(id))throw new Error('The contact ID is missing or invalid.');
    const displayName=clean(r['Display Name']);if(!displayName)throw new Error('Display Name is missing.');
    const name=kind==='customer'?[r['First Name'],r['Last Name']].map(clean).filter(Boolean).join(' '):clean(r.Contact);
    return {id,kind,displayName,name,company:clean(r.Company),email:clean(r.Email),phone:clean(r['Phone 1'])==='-'?'':clean(r['Phone 1']),phone2:clean(r['Phone 2'])==='-'?'':clean(r['Phone 2']),
      address:['Street Address','APT, FLOOR, ETC.','City','State'].map(k=>clean(r[k])).filter(s=>s&&s!=='Unknown').join('\n'),paymentMethod:clean(r['Default Payment Method']),tags:clean(r[kind==='customer'?'Customer Tags':'Vendor Tags']),type:clean(r.Type),credit:kind==='customer'?clean(r['Customer Credit']):''};
  }
  function presets(doc) {
    return {clientCompanies:[doc.clientCompany||doc.company||doc.displayName||''],clientContacts:[doc.clientContact||doc.name||doc.displayName||''],clientEmails:[doc.clientEmail||doc.email||''],clientPhones:[doc.clientPhone||doc.phone||'',doc.phone2||''],paymentTypes:[doc.paymentType||doc.paymentMethod||''],deliveryMethods:[doc.deliveryMethod||''],eventNames:(doc.lines||[]).map(l=>l.eventName),venues:(doc.lines||[]).map(l=>l.venue)};
  }
  function document(kind,r,contacts) {
    const po=kind==='purchase';const sourceId=clean(r[po?'Purchase ID':'Invoice ID']);
    if(!/^\d+$/.test(sourceId))throw new Error('Skybox document ID is missing or invalid.');
    const total=amount(r[po?'Purchase Total':'Invoice Total'],'Total');
    const balance=amount(r['Outstanding Balance'],'Outstanding Balance');
    const shipping=po?0:amount(r.Shipping,'Shipping',true);
    const sourceStatus=clean(r['Payment Status']);
    const status={Paid:'Paid',Partial:'Partially Paid',Unpaid:'Unpaid',Void:'Void'}[sourceStatus];
    if(!status)throw new Error('Unknown payment status: '+sourceStatus);
    const label=clean(r[po?'Vendor':'Customer']);
    const matches=contacts.filter(c=>c.kind===(po?'vendor':'customer') && c.displayName.toLowerCase()===label.toLowerCase());
    const c=matches.length===1?matches[0]:null;
    const unknownEventDate = clean(r['Event Date']) === 'Invalid date';
    const eventDate=po||unknownEventDate?'':date(r['Event Date'],'Event Date');
    let eventTime='';const tm=/ (\d{1,2}):(\d{2}) (AM|PM)$/.exec(clean(r['Event Date']));
    if(tm)eventTime=String(Number(tm[1])%12+(tm[3]==='PM'?12:0)).padStart(2,'0')+':'+tm[2];
    const line={lineType:po?'Tickets':'Experience',eventName:clean(r[po?'Event':'Performer']),venue:clean(r.Venue),lineDate:eventDate,lineTime:eventTime,checkOutDate:'',location:'',section:po?clean(r.Section):'',row:po?clean(r.Row):'',seats:'',description:po?'Imported Skybox purchase; Ticket Cost is the total ticket cost.':'Skybox invoice summary — original ticket quantities, seating, and item prices are not included in this report.',qty:1,unitCost:total-shipping};
    const lines=[line];
    if(po){
      const qty=amount(r['Ticket Qty'],'Ticket Qty'); const cost=amount(r['Ticket Cost'],'Ticket Cost');const other=amount(r['Non-Inventory Cost'],'Non-Inventory Cost');
      if(Math.abs(cost+other-total)>0.01)throw new Error('Ticket and non-inventory costs do not match Purchase Total.');
      if(qty<0||!Number.isInteger(qty)||(qty===0&&cost!==0))throw new Error('Ticket quantity cannot represent this purchase.');
      line.qty=qty;line.unitCost=qty?cost/qty:0;
      if(other)lines.push({...line,lineType:'Experience',eventName:'Non-inventory cost',description:'Skybox non-inventory purchase cost',qty:1,unitCost:other,section:'',row:''});
    }
    const invoice={id:'inv-skybox-'+kind+'-'+sourceId,number:po?'SB-PO-'+sourceId:sourceId,type:po?'po-ticket':'invoice-ticket',savedName:'Skybox '+(po?'PO ':'Invoice ')+sourceId,createdDate:date(r[po?'Purchase Date':'Invoice Date'],'Document Date'),dueDate:'',fulfillmentStatus:'',externalReference:clean(r['External Reference']),inHandDate:'',terms:'',paymentType:clean(r['Payment Method']),deliveryMethod:clean(r['Delivery Method']),status,clientCompany:c?.company||label,clientContact:c?.name||label,clientEmail:c?.email||'',clientPhone:c?.phone||'',billingAddress:c?.address||'',shippingAddress:'',createdBy:'',tax:0,shipping,credit:Math.round((total-balance)*100)/100,lines,
      notes:['Imported from Skybox '+(po?'Purchases Report':'Invoices Report')+'.','Original '+(po?'Purchase':'Invoice')+' ID: '+sourceId,'Original payment status: '+sourceStatus,'Original total: $'+total.toFixed(2)+'; outstanding balance: $'+balance.toFixed(2)+'.',po?'Original public notes: '+clean(r['Public Notes'])+'\nUnit rates may contain fractions of a cent to preserve original purchase totals.':'Summary only: this report does not contain original sale quantities, seating, item prices, or a tax breakdown.','Original event date: '+clean(r['Event Date']),
      'Payment / credit adjustment equals exported total minus exported balance; it is not an itemized payment history.'].join('\n')};
    const calculated=lines.reduce((s,l)=>s+l.qty*l.unitCost,0)+shipping-invoice.credit;
    if(Math.abs(calculated-balance)>0.005)throw new Error('Converted balance does not match Skybox.');
    return {invoice,total,balance,warning:[!po?'Summary invoice; ticket detail missing.':'',unknownEventDate?'Skybox event date is invalid; date left blank.':'',matches.length>1?'Multiple contacts share this name; no email or phone was guessed.':!c?'No matching contact; exported name retained.':'',status==='Void'?'Voided record; do not send as an active invoice.':'',balance<0?'Negative balance retained.':''].filter(Boolean).join(' ')};
  }
  function preview(sheets,existingContacts=[]) {
    const contacts=[...existingContacts];const results=[];
    for(const s of sheets.filter(s=>s.kind==='customer'||s.kind==='vendor'))for(const [i,r] of s.records.entries()) {
      try{const d=contact(s.kind,r);const index=contacts.findIndex(c=>c.kind===d.kind&&c.id===d.id);if(index<0)contacts.push(d);results.push({kind:s.kind,sourceId:d.id,record:r,document:d,presets:presets(d),label:d.displayName,row:i+2,file:s.name});}
      catch(e){results.push({kind:s.kind,row:i+2,file:s.name,error:e.message});}
    }
    for(const s of sheets.filter(s=>s.kind==='invoice'||s.kind==='purchase'))for(const [i,r] of s.records.entries()) {
      try{const d=document(s.kind,r,contacts);results.push({kind:s.kind,sourceId:clean(r[s.kind==='invoice'?'Invoice ID':'Purchase ID']),record:r,document:d.invoice,presets:presets(d.invoice),label:d.invoice.number+' · '+clean(r[s.kind==='invoice'?'Customer':'Vendor']),total:d.total,balance:d.balance,warning:d.warning,row:i+2,file:s.name});}
      catch(e){results.push({kind:s.kind,row:i+2,file:s.name,error:e.message});}
    }
    const ids=new Set();for(const item of results)if(!item.error){const key=item.kind+':'+item.sourceId;if(ids.has(key))item.error='Duplicate source ID in selected files. Select one version of this export.';ids.add(key);}
    return results;
  }
  const api={schemas,table,csv,xlsx,amount,date,contact,document,preview};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.A1Skybox=api;
})(typeof window==='undefined'?globalThis:window);
