import { createHandler } from './handler.mjs';
// JWT verification is performed in the handler; only password sign-in is public.
Deno.serve(createHandler({env:(name:string)=>Deno.env.get(name)}));
