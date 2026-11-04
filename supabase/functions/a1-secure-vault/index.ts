import { createHandler } from './handler.mjs';
// The handler validates the user with Auth, then the database validates the
// live session and all vault permissions. No public password-login action.
Deno.serve(createHandler({env:(name:string)=>Deno.env.get(name)}));
