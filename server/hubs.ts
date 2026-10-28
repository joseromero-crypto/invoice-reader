import type {SupabaseClient} from '@supabase/supabase-js';
import {check,HttpError} from './auth';
export async function requireHub(db:SupabaseClient,orgId:string,userId:string,hubId:string){
 const hub=check(await db.from('hubs').select('id,name').eq('org_id',orgId).eq('id',hubId).maybeSingle());
 if(!hub||!check(await db.rpc('can_access_hub_as',{p_hub:hubId,p_actor:userId})))throw new HttpError(403,'No tienes acceso a este hub.');
 return hub;
}
export async function listHubs(db:SupabaseClient,orgId:string,userId:string,role:string){
 let query=db.from('hubs').select('id,name').eq('org_id',orgId).eq('active',true).order('name');
 if(role!=='admin'){const assigned=check(await db.from('hub_members').select('hub_id').eq('org_id',orgId).eq('user_id',userId))!;if(!assigned.length)return [];query=query.in('id',assigned.map(m=>m.hub_id));}
 return check(await query)!;
}
