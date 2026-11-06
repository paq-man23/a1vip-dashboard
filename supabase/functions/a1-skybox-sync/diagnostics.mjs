// Log only allowlisted structure and categories. Never return raw bodies, headers,
// URLs, token values, database messages, account IDs, or source records.
export async function responseSummary(response){
 const summary={httpStatus:response.status};
 const contentType=response.headers.get('content-type')||'';
 summary.format=contentType.includes('json')?'json':contentType.includes('html')?'html':'other';
 const retry=response.headers.get('retry-after');
 if(retry!==null){const numeric=Number(retry),date=Date.parse(retry);summary.retryAfterSeconds=Number.isFinite(numeric)?Math.max(0,numeric):Number.isFinite(date)?Math.max(0,Math.ceil((date-Date.now())/1000)):null;}
 try{
  const length=Number(response.headers.get('content-length'));
  if(length>1000000)return summary;
  const data=await response.clone().json();
  summary.shape=Array.isArray(data)?'array':data&&typeof data==='object'?'object':typeof data;
  summary.hasRows=Array.isArray(data?.rows);
  if(summary.hasRows)summary.returnedRows=data.rows.length;
  if(Number.isSafeInteger(data?.rowCount)&&data.rowCount>=0)summary.totalRows=data.rowCount;
  if(!response.ok){
   const serialized=JSON.stringify(data).slice(0,10000).toLowerCase();
   summary.category=/rate.limit|too many request/.test(serialized)?'rate_limit':/unauthori|authentication|invalid.token|api.token/.test(serialized)?'authentication':/permission|forbidden/.test(serialized)?'permission':/page|parameter|sort/.test(serialized)?'request_parameter':'provider_error';
  }
 }catch{
  summary.shape='non_json';
  if(!response.ok)try{
   const text=(await response.clone().text()).slice(0,10000);
   const fields=['lastUpdateFrom','lastUpdateTo','createdDateFrom','createdDateTo','pageNumber','limit','sortedBy','sortDir'].filter(field=>text.toLowerCase().includes(field.toLowerCase()));
   if(fields.length)summary.parameterFields=fields;
   summary.category=/rate.limit|too many request/i.test(text)?'rate_limit':/unauthori|authentication|invalid.token/i.test(text)?'authentication':/required|filter|parameter|date.range/i.test(text)?'request_parameter':'provider_error';
  }catch{}
 }
 return summary;
}
export function dashboardFailure(path,status,data){
 const error=new Error('Dashboard sync request failed');
 const endpoint=path.split('?')[0];
 error.diagnostic={stage:endpoint.startsWith('/rest/v1/rpc/')?endpoint.slice('/rest/v1/rpc/'.length):endpoint==='/auth/v1/user'?'dashboard_auth':'dashboard_data',httpStatus:status,failure:'dashboard_api'};
 if(typeof data?.code==='string'&&/^(?:[0-9A-Z]{5}|PGRST\d{3})$/.test(data.code))error.diagnostic.code=data.code;
 // Recognize a few actionable errors, without copying database text.
 const message=String(data?.message||'');
 error.diagnostic.category=/permission denied/i.test(message)?'permission':/schema cache|could not find.*function/i.test(message)?'schema_cache':/sign in again/i.test(message)?'session':/account change requires/i.test(message)?'account_change':'database';
 return error;
}
