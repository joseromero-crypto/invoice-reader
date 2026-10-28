import {loadEnv} from 'vite';
import {createClient} from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';
import {integrationIssues} from '../server/integration-config';
import {limits} from '../server/config';
import {HUB_NAMES} from '../shared/hubs';
const env={...loadEnv('development',process.cwd(),''),...process.env};
Object.assign(process.env,env);
let failed=false;
function report(label:string,ok:boolean){console.log(`${ok?'PASS':'FAIL'} ${label}`);if(!ok)failed=true;}
const issues=integrationIssues(env);
for(const issue of issues)console.log(`FAIL ${issue}`);
if(issues.length)failed=true;
try{limits();report('Upload/page/usage limits',true);}catch{report('Upload/page/usage limits',false);}
if(process.argv.includes('--remote')&&!issues.length){
 const db=createClient(env.SUPABASE_URL!,env.SUPABASE_SECRET_KEY!,{auth:{persistSession:false,autoRefreshToken:false}});
 // Read-only probes: no migration, upload, provisioning or paid messages call.
 for(const [table,columns] of [['members','org_id,user_id,role'],['hubs','id,org_id,name,active'],['hub_members','org_id,hub_id,user_id'],['documents','id,invoice_date,metadata_revision'],['invoice_rows','id,revision'],['extraction_jobs','id,claim_token,lease_until'],['organizations','id,catalog_revision'],['catalog_imports','id,org_id,report']]){
 try{const {error}=await db.from(table).select(columns).limit(1);report(`Database schema: ${table}`,!error);}catch{report(`Database schema: ${table}`,false);}}
 try{const {data,error}=await db.storage.listBuckets();for(const name of ['invoices','catalogs']){const bucket=data?.find(b=>b.id===name);report(`Private Storage bucket: ${name}`,!error&&!!bucket&&!bucket.public);}}catch{report('Private Storage buckets',false);}
 try{const response=await fetch(`${env.SUPABASE_URL!.replace(/\/$/,'')}/auth/v1/settings`,{headers:{apikey:env.VITE_SUPABASE_PUBLISHABLE_KEY!},signal:AbortSignal.timeout(15000)});const settings=await response.json();report('Auth public signup disabled',response.ok&&settings.disable_signup===true);}catch{report('Auth public signup disabled',false);}
 try{const {data,error}=await db.from('organizations').select('id').limit(2);report('Exactly one provisioned company for v1',!error&&data?.length===1);if(data?.length===1){const {data:hubs,error:hubError}=await db.from('hubs').select('name').eq('org_id',data[0].id).eq('active',true);report('Eight configured hubs',!hubError&&HUB_NAMES.every(name=>hubs?.some(h=>h.name===name)));const {error:snapshotError}=await db.rpc('read_catalog_snapshot',{p_org:data[0].id});report('Transactional catalog snapshot RPC',!snapshotError);}}catch{report('Company/hub/catalog provisioning',false);}
 try{const client=new Anthropic({apiKey:env.ANTHROPIC_API_KEY,maxRetries:0,timeout:20000});const model=await client.models.retrieve(env.ANTHROPIC_MODEL!);report('Anthropic configured model is accessible (no extraction call)',!!model.id);}catch{report('Anthropic configured model access',false);}
 if(env.SITE_URL){try{const url=new URL('/api/receiving',env.SITE_URL);if(url.protocol!=='https:')throw Error();const response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'hubs'}),redirect:'error',signal:AbortSignal.timeout(15000)});report('Netlify API rejects unauthenticated requests',response.status===401);}catch{report('Netlify deployed API',false);}}
}else if(!process.argv.includes('--remote'))console.log('Remote services not contacted. Add --remote for read-only checks after configuration.');
console.log('Hosted acceptance (real users, background dispatch and one Hygeia extraction) must still be verified separately.');
process.exitCode=failed?1:0;
