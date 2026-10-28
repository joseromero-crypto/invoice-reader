import {createClient} from '@supabase/supabase-js';
const url=import.meta.env.VITE_SUPABASE_URL,key=import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
export const supabase=url&&key?createClient(url,key):null;
export async function api(action:string,body:unknown){
 const session=await supabase?.auth.getSession();const token=session?.data.session?.access_token;if(!token)throw Error('Inicia sesión para continuar.');
 const res=await fetch(`/api/${action}`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify(body)});
 const data=await res.json();if(!res.ok)throw Error(data.error??'No se pudo completar la operación.');return data;
}
