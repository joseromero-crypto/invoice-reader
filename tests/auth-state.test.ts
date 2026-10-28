import {expect,it,vi} from 'vitest';
import {observeAuth} from '../src/lib/authState';
function setup(){
 let listener:any,resolve:any;
 const initial=new Promise<any>(r=>{resolve=r;}),unsubscribe=vi.fn();
 const client={auth:{onAuthStateChange:vi.fn(callback=>{listener=callback;return {data:{subscription:{unsubscribe}}};}),getSession:()=>initial}};
 const callbacks={onSession:vi.fn(),onIdentityChange:vi.fn(),onError:vi.fn()};
 const stop=observeAuth(client as any,callbacks);
 return {callbacks,stop,unsubscribe,initial,resolve,emit:(event:string,user:string|null)=>listener(event,user?{user:{id:user}}:null)};
}
it('preserves an open review across refresh and repeated same-user sign-in events',async()=>{
 const s=setup();s.resolve({data:{session:{user:{id:'a'}}},error:null});await s.initial;
 s.emit('TOKEN_REFRESHED','a');s.emit('SIGNED_IN','a');
 expect(s.callbacks.onIdentityChange).toHaveBeenCalledTimes(1);
 expect(s.callbacks.onSession).toHaveBeenLastCalledWith(true);
});
it('resets account-specific state when switching users and signing out',()=>{
 const s=setup();s.emit('SIGNED_IN','a');s.emit('SIGNED_IN','b');s.emit('SIGNED_OUT',null);
 expect(s.callbacks.onIdentityChange).toHaveBeenCalledTimes(3);
 expect(s.callbacks.onSession).toHaveBeenLastCalledWith(false);
});
it('does not reopen a stale initial session after sign-out',async()=>{
 const s=setup();s.emit('SIGNED_IN','a');s.emit('SIGNED_OUT',null);
 s.resolve({data:{session:{user:{id:'a'}}},error:null});await s.initial;
 expect(s.callbacks.onIdentityChange).toHaveBeenCalledTimes(2);
 expect(s.callbacks.onSession).toHaveBeenLastCalledWith(false);
});
it('ignores events and late session responses after cleanup',async()=>{
 const s=setup();s.stop();s.emit('SIGNED_IN','a');s.resolve({data:{session:null},error:null});await s.initial;
 expect(s.unsubscribe).toHaveBeenCalledOnce();expect(s.callbacks.onSession).not.toHaveBeenCalled();
});
it('reports session-loading errors so the login flow can recover',async()=>{
 const s=setup();s.resolve({data:{session:null},error:Error('offline')});await s.initial;
 expect(s.callbacks.onError).toHaveBeenCalledOnce();expect(s.callbacks.onIdentityChange).not.toHaveBeenCalled();
});
