/* Shared history ordering and A1 numbering; Skybox IDs never advance the A1 series. */
(function(root){
  const text=value=>String(value||'');
  const year=item=>/^\d{4}-\d{2}-\d{2}$/.test(text(item.createdDate))?item.createdDate.slice(0,4):'Unknown';
  function nextNumber(items){
    const numbers=items.filter(i=>!text(i.id).startsWith('inv-skybox-')&&/^\d+$/.test(text(i.number))).map(i=>Number(i.number)).filter(Number.isSafeInteger);
    return numbers.length?Math.max(4099,...numbers)+1:4100;
  }
  function years(items){return [...new Set(items.map(year))].sort((a,b)=>a==='Unknown'?1:b==='Unknown'?-1:b.localeCompare(a));}
  const origin=item=>item.origin==='skybox'||text(item.id).startsWith('inv-skybox-')?'skybox':'a1';
  function filter(items,query='',selectedYear='',order='newest',selectedOrigin=''){
    const q=text(query).trim().toLowerCase();
    return items.filter(i=>(!selectedOrigin||origin(i)===selectedOrigin)&&(!selectedYear||year(i)===selectedYear)&&(!q||[i.savedName,i.number,i.clientCompany,i.clientContact,i.clientEmail,i.status,i.type].some(v=>text(v).toLowerCase().includes(q))))
      .sort((a,b)=>{
        const ad=year(a)==='Unknown'?'':a.createdDate,bd=year(b)==='Unknown'?'':b.createdDate;
        if(!ad&&bd)return 1;if(ad&&!bd)return -1;
        const result=ad.localeCompare(bd)||text(a.number).localeCompare(text(b.number),undefined,{numeric:true});return order==='oldest'?result:-result;
      });
  }
  const api={nextNumber,years,filter,origin};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.A1History=api;
})(typeof window==='undefined'?globalThis:window);
