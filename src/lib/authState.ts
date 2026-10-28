import type {SupabaseClient} from '@supabase/supabase-js';
// Identity changes reset account-specific UI; token refreshes preserve the invoice.
export function observeAuth(client:Pick<SupabaseClient,'auth'>,callbacks:{onSession:(signedIn:boolean)=>void;onIdentityChange:()=>void;onError:()=>void}){
 let current=true,userId:string|null=null,eventVersion=0;
 const apply=(nextId:string|null)=>{if(!current)return;callbacks.onSession(!!nextId);if(userId===nextId)return;userId=nextId;callbacks.onIdentityChange();};
 const {data}=client.auth.onAuthStateChange((_event,session)=>{eventVersion++;apply(session?.user.id??null);});
 const initialVersion=eventVersion;
 client.auth.getSession().then(({data,error})=>{if(!current||eventVersion!==initialVersion)return;if(error){callbacks.onError();return;}apply(data.session?.user.id??null);}).catch(()=>{if(current&&eventVersion===initialVersion)callbacks.onError();});
 return()=>{current=false;data.subscription.unsubscribe();};
}
