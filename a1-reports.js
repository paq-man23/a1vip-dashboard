/* Audit summaries use document dates and the same amounts displayed in history. */
(function(root){
  const cents=value=>Math.round((Number(value)+Number.EPSILON)*100);
  function period(item){
    const date=String(item.createdDate||'');
    if(!/^\d{4}-\d{2}-\d{2}$/.test(date))return 'Unknown';
    const parsed=new Date(date+'T00:00:00Z');
    return Number.isFinite(parsed.getTime())&&parsed.toISOString().slice(0,10)===date?date.slice(0,7):'Unknown';
  }
  const empty=()=>({invoice:{count:0,total:0,credit:0,balance:0},purchase:{count:0,total:0,credit:0,balance:0}});
  function report(items,{year='',month='',includeVoid=false,total,credit}){
    const buckets=new Map(),totals=empty();let excludedVoid=0;
    if(/^\d{4}$/.test(year))for(let m=1;m<=12;m++){const key=year+'-'+String(m).padStart(2,'0');if(!month||key.endsWith('-'+month))buckets.set(key,empty());}
    const rows=[];
    for(const item of items){
      const key=period(item);if(month&&(key==='Unknown'||key.slice(-2)!==month))continue;
      if(!includeVoid&&/^void(?:ed)?$/i.test(String(item.status||'').trim())){excludedVoid++;continue;}
      const kind=String(item.type||'').startsWith('po-')?'purchase':'invoice';
      const gross=cents(total(item)),adjustment=cents(credit(item));
      if(!Number.isSafeInteger(gross)||!Number.isSafeInteger(adjustment))throw new Error('A document contains an invalid amount. Review its saved amounts before reporting.');
      const amounts={count:1,total:gross,credit:adjustment,balance:gross-adjustment};
      if(!buckets.has(key))buckets.set(key,empty());
      for(const field of Object.keys(amounts)){buckets.get(key)[kind][field]+=amounts[field];totals[kind][field]+=amounts[field];}
      rows.push({item,period:key,kind,...amounts});
    }
    return {rows,totals,excludedVoid,months:[...buckets].sort(([a],[b])=>a.localeCompare(b)).map(([period,totals])=>({period,...totals}))};
  }
  function csv(result){
    const cell=value=>'"'+(typeof value==='number'?String(value):String(value??'').replace(/^[\s]*[=+@-]/,m=>"'"+m)).replaceAll('"','""')+'"';
    const rows=[['Document date','Month','Document type','Number','Company','Contact','Status','Source','Document total (USD)','Credits / amount paid (USD)','Balance (USD)'],...result.rows.map(r=>[r.item.createdDate,r.period,r.kind==='purchase'?'Purchase order':'Invoice',r.item.number,r.item.clientCompany,r.item.clientContact,r.item.status,r.item.origin==='skybox'||String(r.item.id).startsWith('inv-skybox-')?'Skybox':'A1 Dashboard',Number((r.total/100).toFixed(2)),Number((r.credit/100).toFixed(2)),Number((r.balance/100).toFixed(2))])];
    return '\uFEFF'+rows.map(row=>row.map(cell).join(',')).join('\r\n');
  }
  const api={period,report,csv};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.A1Reports=api;
})(typeof window==='undefined'?globalThis:window);
