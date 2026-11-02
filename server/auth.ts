import {createClient,type SupabaseClient,type User} from '@supabase/supabase-js';
export function adminClient(){const url=process.env.SUPABASE_URL,key=process.env.SUPABASE_SECRET_KEY;if(!url||!key)throw Error('Supabase server configuration missing');return createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});}
export async function authorize(request:Request){
 const token=request.headers.get('authorization')?.match(/^Bearer (.+)$/)?.[1];if(!token)throw new HttpError(401,'Authentication required');
 const db=adminClient();const {data,error}=await db.auth.getUser(token);if(error||!data.user)throw new HttpError(401,'Invalid session');
 let {data:members,error:memberError}=await db.from('members').select('org_id,role').eq('user_id',data.user.id);if(memberError)throw memberError;if(!members?.length)members=await joinWithGoogle(db,data.user);
 // V1 one company with multiple hubs. Never accept an arbitrary organization ID from the browser.
 if(members.length!==1)throw new HttpError(409,'Choose a single company membership for v1');
 return {db,userId:data.user.id,orgId:members[0].org_id,role:members[0].role,token};
}
const domain=()=>(process.env.ALLOWED_EMAIL_DOMAIN||'calii.com').toLowerCase();
export const wrongAccount=()=>`Usa tu cuenta de Calii (@${domain()}) con Google para entrar.`;
// Google sign-in with a verified company address joins as a receiver with every active hub on first use.
// Any other account is refused (and its just-created Google login removed); password users are still added by an admin.
export async function joinWithGoogle(db:SupabaseClient,user:User){
 const email=(user.email??'').toLowerCase(),providers:string[]=user.app_metadata?.providers??(user.app_metadata?.provider?[user.app_metadata.provider]:[]);
 const google=providers.includes('google');
 if(!google||!user.email_confirmed_at||!email.endsWith(`@${domain()}`)){if(google&&!email.endsWith(`@${domain()}`))await db.auth.admin.deleteUser(user.id).catch(()=>{});throw new HttpError(403,wrongAccount());}
 const orgs=check(await db.from('organizations').select('id'))!;if(orgs.length!==1)throw new HttpError(409,'Choose a single company membership for v1');
 const org=orgs[0].id;
 check(await db.from('members').upsert({org_id:org,user_id:user.id,role:'receiver'},{onConflict:'org_id,user_id',ignoreDuplicates:true}));
 const hubs=check(await db.from('hubs').select('id').eq('org_id',org).eq('active',true))!;
 if(hubs.length)check(await db.from('hub_members').upsert(hubs.map(h=>({org_id:org,hub_id:h.id,user_id:user.id})),{onConflict:'hub_id,user_id',ignoreDuplicates:true}));
 return [{org_id:org,role:'receiver'}];
}
export class HttpError extends Error {constructor(public status:number,message:string){super(message);}}
export function check<T>(result:{data:T;error:any}):T{if(result.error)throw new HttpError(/Revision conflict/.test(result.error.message??'')?409:400,/Revision conflict/.test(result.error.message??'')?'Otra persona modificó estos datos. Recarga y revisa los cambios antes de confirmar.':result.error.message??'Database operation failed');return result.data;}
export function failure(e:unknown){const known=e instanceof HttpError;return Response.json({error:known?e.message:'La operación falló. Revisa la configuración o el estado del trabajo.'},{status:known?e.status:500});}
