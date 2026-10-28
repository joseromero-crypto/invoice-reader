import {expect,it} from 'vitest';
import {integrationIssues} from '../server/integration-config';
const env={VITE_SUPABASE_URL:'https://test.supabase.co',SUPABASE_URL:'https://test.supabase.co',VITE_SUPABASE_PUBLISHABLE_KEY:'sb_publishable_example',SUPABASE_SECRET_KEY:'sb_secret_example',ANTHROPIC_API_KEY:'test-key',ANTHROPIC_MODEL:'chosen-model'};
it('accepts distinct public/server settings without printing their values',()=>expect(integrationIssues(env)).toEqual([]));
it('rejects mismatched browser/server projects',()=>expect(integrationIssues({...env,SUPABASE_URL:'https://other.supabase.co'})).toContain('Browser and server Supabase URLs must identify the same project'));
it('rejects both modern and legacy service credentials in frontend variables',()=>{
 const jwt=`header.${Buffer.from(JSON.stringify({role:'service_role'})).toString('base64url')}.signature`;
 for(const key of ['sb_secret_example',jwt])expect(integrationIssues({...env,VITE_SUPABASE_PUBLISHABLE_KEY:key}).some(s=>s.includes('contains a server secret'))).toBe(true);
 expect(integrationIssues({...env,VITE_ANTHROPIC_API_KEY:'secret'}).some(s=>s.includes('must never'))).toBe(true);
});
it('rejects missing settings, URL credentials and invalid prices',()=>{
 expect(integrationIssues({})).toHaveLength(6);
 expect(integrationIssues({...env,SUPABASE_URL:'https://user:password@test.supabase.co',AI_INPUT_USD_PER_MILLION:'NaN'})).toHaveLength(3);
});
