import {createHandler} from './handler.mjs';
// Every request verifies the bearer token with Auth and checks current staff membership.
Deno.serve(createHandler({env:(name:string)=>Deno.env.get(name)}));
