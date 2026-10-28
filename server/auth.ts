import {createClient} from '@supabase/supabase-js';
export function adminClient(){const url=process.env.SUPABASE_URL,key=process.env.SUPABASE_SECRET_KEY;if(!url||!key)throw Error('Supabase server configuration missing');return createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});}
export async function authorize(request:Request){
 const token=request.headers.get('authorization')?.match(/^Bearer (.+)$/)?.[1];if(!token)throw new HttpError(401,'Authentication required');
 const db=adminClient();const {data,error}=await db.auth.getUser(token);if(error||!data.user)throw new HttpError(401,'Invalid session');
 const {data:members,error:memberError}=await db.from('members').select('org_id,role').eq('user_id',data.user.id);if(memberError)throw memberError;if(!members?.length)throw new HttpError(403,'An invitation to an organization is required');
 // V1 one company with multiple hubs. Never accept an arbitrary organization ID from the browser.
 if(members.length!==1)throw new HttpError(409,'Choose a single company membership for v1');
 return {db,userId:data.user.id,orgId:members[0].org_id,role:members[0].role,token};
}
export class HttpError extends Error {constructor(public status:number,message:string){super(message);}}
export function check<T>(result:{data:T;error:any}):T{if(result.error)throw new HttpError(/Revision conflict/.test(result.error.message??'')?409:400,/Revision conflict/.test(result.error.message??'')?'Otra persona modificó estos datos. Recarga y revisa los cambios antes de confirmar.':result.error.message??'Database operation failed');return result.data;}
export function failure(e:unknown){const known=e instanceof HttpError;return Response.json({error:known?e.message:'La operación falló. Revisa la configuración o el estado del trabajo.'},{status:known?e.status:500});}
