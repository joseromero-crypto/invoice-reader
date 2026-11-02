import {it,expect} from 'vitest';
import {joinWithGoogle} from '../server/auth';
function fakeDB(){
 const writes:any[]=[],deleted:string[]=[];
 const data:Record<string,any>={organizations:[{id:'org'}],hubs:[{id:'h1'},{id:'h2'}]};
 const db:any={auth:{admin:{deleteUser:async(id:string)=>{deleted.push(id);return {error:null};}}},
 from:(t:string)=>{const chain:any={};for(const m of ['select','eq'])chain[m]=()=>chain;chain.upsert=(rows:any,opts:any)=>{writes.push([t,rows,opts]);return chain;};chain.then=(y:any,n:any)=>Promise.resolve({data:data[t]??null,error:null}).then(y,n);return chain;}};
 return {db,writes,deleted};
}
const user=(email:string,provider='google',confirmed=true):any=>({id:'u1',email,email_confirmed_at:confirmed?'2026-11-02':null,app_metadata:{provider,providers:[provider]}});
it('adds a verified @calii.com Google account as a receiver with every active hub',async()=>{
 const {db,writes,deleted}=fakeDB();
 expect(await joinWithGoogle(db,user('Ana.Lopez@Calii.com'))).toEqual([{org_id:'org',role:'receiver'}]);
 expect(writes[0]).toEqual(['members',{org_id:'org',user_id:'u1',role:'receiver'},{onConflict:'org_id,user_id',ignoreDuplicates:true}]);
 expect(writes[1][1]).toEqual([{org_id:'org',hub_id:'h1',user_id:'u1'},{org_id:'org',hub_id:'h2',user_id:'u1'}]);
 expect(deleted).toEqual([]);
});
it('refuses other Google accounts with the "use your Calii account" message and removes the stray login',async()=>{
 const {db,writes,deleted}=fakeDB();
 await expect(joinWithGoogle(db,user('ana@gmail.com'))).rejects.toMatchObject({status:403,message:'Usa tu cuenta de Calii (@calii.com) con Google para entrar.'});
 expect(writes).toEqual([]);expect(deleted).toEqual(['u1']);
});
it('does not auto-join password accounts or unverified addresses',async()=>{
 const {db,writes,deleted}=fakeDB();
 await expect(joinWithGoogle(db,user('ana@calii.com','email'))).rejects.toMatchObject({status:403});
 await expect(joinWithGoogle(db,user('ana@calii.com','google',false))).rejects.toMatchObject({status:403});
 expect(writes).toEqual([]);expect(deleted).toEqual([]);
});
