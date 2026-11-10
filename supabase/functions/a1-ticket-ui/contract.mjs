import {catalog} from './catalog.mjs';
export function schemaFor(schema){return schema?.$ref?catalog.schemas[schema.$ref.split('/').pop()]||{}:schema||{};}
export function validate(value,schema,label='Value',depth=0){
 if(depth>20)throw Error('Form nesting is too deep');schema=schemaFor(schema);
 if(value===undefined){return;}if(value===null){if(schema.nullable)return;throw Error(label+' cannot be empty');}
 if(schema.enum&&!schema.enum.includes(value))throw Error(label+' has an invalid selection');
 const type=schema.type||(schema.properties?'object':undefined);
 if(type==='object'){
  if(typeof value!=='object'||Array.isArray(value))throw Error(label+' must be an object');
  for(const required of schema.required||[])if(value[required]===undefined&&required!=='accountId')throw Error(label+': '+required+' is required');
  for(const [key,v] of Object.entries(value)){
   if(['__proto__','prototype','constructor'].includes(key))throw Error('Invalid field');
   const prop=schema.properties?.[key];if(!prop&&schema.additionalProperties!==true&&typeof schema.additionalProperties!=='object')throw Error(label+': unknown field '+key);
   validate(v,prop||schema.additionalProperties,label+'.'+key,depth+1);
  }
 }else if(type==='array'){
  if(!Array.isArray(value)||value.length>10000)throw Error(label+' must be a list with at most 10000 items');
  value.forEach(v=>validate(v,schema.items,label,depth+1));
 }else if(type==='integer'){if(!Number.isSafeInteger(value))throw Error(label+' must be a whole number');}
 else if(type==='number'){if(typeof value!=='number'||!Number.isFinite(value))throw Error(label+' must be a number');}
 else if(type==='boolean'){if(typeof value!=='boolean')throw Error(label+' must be yes or no');}
 else if(type==='string'){if(typeof value!=='string'||value.length>6000000)throw Error(label+' must be text');}
 if(typeof value==='number'&&((schema.minimum!==undefined&&value<schema.minimum)||(schema.maximum!==undefined&&value>schema.maximum)))throw Error(label+' is outside the allowed range');
}
export function buildRequest(input,accountId){
 const op=catalog.operations[input.operation];if(!op)throw Error('Unknown Skybox action');
 const params=input.parameters||{};if(typeof params!=='object'||Array.isArray(params))throw Error('Invalid parameters');
 const allowed=new Map(op.parameters.map(p=>[p.name,p]));
 for(const [name,value] of Object.entries(params)){if(!allowed.has(name))throw Error('Unknown filter '+name);validate(value,allowed.get(name).schema,name);}
 let path=op.path;const query=new URLSearchParams();
 for(const p of op.parameters){const value=params[p.name];if(value===undefined||value===''){if(p.required)throw Error(p.name+' is required');continue;}
  if(p.in==='path'){if(typeof value==='object'||['.','..'].includes(String(value)))throw Error('Invalid record identifier');path=path.replace('{'+p.name+'}',encodeURIComponent(String(value)));}
  else if(p.in==='query')query.set(p.name,Array.isArray(value)?value.join(','):String(value));
 }
 if(path.includes('{'))throw Error('Record identifier required');
 // Bound interactive searches to one page; every page remains available through pagination.
 if(allowed.has('limit'))query.set('limit',String(Math.min(100,Math.max(1,Number(query.get('limit'))||50))));
 let body=input.body;
 if(op.bodyRequired&&body===undefined)throw Error('Complete the action form');
 if(body!==undefined){if(!op.body)throw Error('This action does not accept a body');validate(body,op.body);body=structuredClone(body);}
 function account(value,schema){schema=schemaFor(schema);if(Array.isArray(value)){value.forEach(v=>account(v,schema.items));return;}if(!value||typeof value!=='object')return;
  if('accountId' in value&&String(value.accountId)!==String(accountId))throw Error('Skybox account mismatch');
  if(schema.properties?.accountId&&(schema.required||[]).includes('accountId'))value.accountId=Number(accountId);
  for(const [key,v] of Object.entries(value))if(key!=='accountId')account(v,schema.properties?.[key]);
 }
 if(body!==undefined)account(body,op.body);
 if(op.id==='invoicesInsertInvoice'){
  if(!Number.isSafeInteger(body?.customerId)||body.customerId<1||!body.lines?.length)throw Error('Customer and at least one invoice line are required');
  for(const line of body.lines)if(line.lineItemType==='INVENTORY'&&(!line.itemIds?.length||line.itemIds.some(id=>!Number.isSafeInteger(id)||id<1)))throw Error('Choose the ticket IDs to sell');
 }
 if(op.id==='purchasesInsertPurchase'&&(!Number.isSafeInteger(body?.vendorId)||body.vendorId<1||!body.lines?.length))throw Error('Vendor and at least one purchase line are required');
 return {operation:op.id,method:op.method,path,query:query.toString(),...(body===undefined?{}:{body})};
}
export const canonical=value=>JSON.stringify(value,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
