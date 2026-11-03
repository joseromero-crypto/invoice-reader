import {createClient} from '@supabase/supabase-js';
// A failed Google sign-in comes back with ?error_description=… (or in the hash); read it before the client clears the URL.
const returned=typeof window==='undefined'?null:new URLSearchParams(`${window.location.search.slice(1)}&${window.location.hash.slice(1)}`).get('error_description');
export const oauthError=returned?`No se pudo entrar con Google (${returned}). Si abriste el enlace desde WhatsApp u otra app, ábrelo en Chrome o Safari e intenta de nuevo.`:'';
const url=import.meta.env.VITE_SUPABASE_URL,key=import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
export const supabase=url&&key?createClient(url,key):null;
export const googleSignIn=()=>supabase!.auth.signInWithOAuth({provider:'google',options:{redirectTo:window.location.origin,queryParams:{hd:'calii.com',prompt:'select_account'}}});
export const SESSION_EXPIRED='Tu sesión expiró. Vuelve a entrar.';
export async function api(action:string,body:unknown){
 const session=await supabase?.auth.getSession();const token=session?.data.session?.access_token;if(!token)throw Error('Inicia sesión para continuar.');
 const res=await fetch(`/api/${action}`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify(body)});
 // A dead token (expired, or replaced by a sign-in elsewhere) signs out so the login opens again.
 if(res.status===401){await supabase?.auth.signOut();throw Error(SESSION_EXPIRED);}
 const data=await res.json();if(!res.ok)throw Error(data.error??'No se pudo completar la operación.');return data;
}
