import {it,expect,vi,beforeEach} from 'vitest';
import {createHash} from 'node:crypto';
const state=vi.hoisted(()=>({db:null as any,paid:vi.fn(),count:vi.fn(),prepare:vi.fn(),read:vi.fn()}));
vi.mock('@anthropic-ai/sdk',()=>({default:class {static APIError=class extends Error {};messages={create:state.paid,countTokens:state.count};constructor(options:any){expect(options.maxRetries).toBe(0);}}}));
vi.mock('../server/auth',()=>({authorize:async()=>({db:state.db,orgId:'org',userId:'user'}),check:(r:any)=>{if(r.error)throw r.error;return r.data;},HttpError:class extends Error{constructor(public status:number,message:string){super(message);}}}));
vi.mock('../server/hubs',()=>({requireHub:async()=>{}}));
vi.mock('../server/workspace',()=>({catalog:async()=>[],asProduct:(r:any)=>r}));
vi.mock('../server/invoice-request',()=>({prepareInvoicePage:state.prepare,invoiceImageSizes:()=>[{width:100,height:100}],invoiceRequest:()=>({model:'claude-sonnet-5-5',max_tokens:1000,messages:[{role:'user',content:'synthetic'}]})}));
vi.mock('../server/invoice-output',()=>({invoiceOutputEvidence:(r:any)=>({stopReason:r.stop_reason,textBlocks:['invalid']}),readInvoiceOutput:state.read}));
vi.mock('../server/invoice-image',()=>({prepareColumnsInvoicePage:state.prepare}));
vi.mock('../server/invoice-basic-columns-v3',()=>({columnsV3InvoiceRequest:()=>({model:'claude-sonnet-5-5',max_tokens:1000,messages:[{role:'user',content:'synthetic'}]})}));
import {extractJob} from '../server/extract';
const source=Buffer.from('synthetic-original');
function fakeDB({attempts=0,usage=null as any,canReserve=true,duplicate=false}={}){
 const events:any[]=[],updates:any[]=[];
 const job:any={id:'job',document_id:'doc',requested_by:'user',attempts,usage,status:'queued',claim_token:'claim',lease_until:new Date(Date.now()+600000).toISOString()};
 const db:any={events,updates,job,storage:{from:()=>({download:async()=>({data:new Blob([source]),error:null})})},rpc:async(name:string)=>{events.push(name);if(name==='claim_extraction'){if(duplicate)return {data:null,error:null};job.attempts++;job.status='processing';return {data:{...job},error:null};}throw Error('Unexpected finish');},from:(table:string)=>{
  let mutation:any=null;const chain:any={};
  for(const m of ['select','eq','gt','order'])chain[m]=(...args:any[])=>{if(m==='eq'||m==='gt')events.push([m,...args]);return chain;};
  chain.update=(data:any)=>{mutation=data;return chain;};
  const resolve=()=>{if(mutation){updates.push(structuredClone(mutation));events.push('reserve/update');if(canReserve){Object.assign(job,mutation);return {data:{id:'job'},error:null};}return {data:null,error:null};}
   const data=table==='extraction_jobs'?{...job}:table==='documents'?{id:'doc',session_id:'session'}:table==='receiving_sessions'?{hub_id:'hub'}:table==='members'?{user_id:'user'}:table==='source_pages'?[{object_path:'org/doc/photo',content_hash:createHash('sha256').update(source).digest('hex'),page_number:1}]:[];
   return {data,error:null};};
  chain.single=chain.maybeSingle=async()=>resolve();chain.then=(yes:any,no:any)=>Promise.resolve(resolve()).then(yes,no);return chain;
 }};return db;
}
beforeEach(()=>{vi.stubEnv('ANTHROPIC_MODEL','claude-sonnet-5-5');vi.stubEnv('ANTHROPIC_API_KEY','synthetic');state.count.mockReset().mockResolvedValue({input_tokens:1000});state.paid.mockReset();state.prepare.mockReset().mockResolvedValue({images:[{type:'image'}],diagnosis:{sourcePage:1}});state.read.mockReset().mockImplementation(()=>{throw Error('strict parse rejected');});});
it('persists a fenced reservation before paid dispatch and keeps unknown failure spend',async()=>{
 state.db=fakeDB();state.paid.mockImplementation(async()=>{expect(state.db.job.usage.documentSpend.calls).toHaveLength(1);expect(state.db.events).toContainEqual(['eq','claim_token','claim']);expect(state.db.events.some((x:any)=>x[0]==='gt'&&x[1]==='lease_until')).toBe(true);throw Error('interrupted');});
 await expect(extractJob(new Request('http://local'),'job')).rejects.toThrow('interrupted');expect(state.paid).toHaveBeenCalledTimes(1);expect(state.db.job.usage.documentSpend.calls[0].estimatedActualUSD).toBeNull();expect(state.db.job.estimated_cost_usd).toBeGreaterThan(0);
});
it('records the failed/truncated response usage and cost without a second request or receiving write',async()=>{
 state.db=fakeDB();state.paid.mockResolvedValue({model:'claude-sonnet-5-5',usage:{input_tokens:1000,output_tokens:1000,cache_creation_input_tokens:0,cache_read_input_tokens:0},stop_reason:'max_tokens',content:[]});
 await expect(extractJob(new Request('http://local'),'job')).rejects.toThrow('strict parse');expect(state.paid).toHaveBeenCalledTimes(1);expect(state.db.job.estimated_cost_usd).toBeCloseTo(0.012);expect(state.db.job.usage.documentSpend.calls[0].usage.output_tokens).toBe(1000);expect(state.db.events).not.toContain('finish_extraction');
});
it('fails closed on expired reservation or token-count failure before paid dispatch',async()=>{
 state.db=fakeDB({canReserve:false});await expect(extractJob(new Request('http://local'),'job')).rejects.toThrow('expired');expect(state.paid).not.toHaveBeenCalled();
 state.db=fakeDB();state.count.mockRejectedValue(Error('count unavailable'));await expect(extractJob(new Request('http://local'),'job')).rejects.toThrow('count unavailable');expect(state.paid).not.toHaveBeenCalled();expect(state.db.job.usage.documentSpend.calls).toHaveLength(0);
});
it('does not bypass duplicate claiming or retry an unaccounted historical attempt',async()=>{
 state.db=fakeDB({duplicate:true});await extractJob(new Request('http://local'),'job');expect(state.paid).not.toHaveBeenCalled();expect(state.count).not.toHaveBeenCalled();
 state.db=fakeDB({attempts:1});await expect(extractJob(new Request('http://local'),'job')).rejects.toThrow(/gasto/);expect(state.db.events).not.toContain('claim_extraction');expect(state.paid).not.toHaveBeenCalled();
});

it('blocks the rejected Haiku reader before claiming or spending in production',async()=>{
 vi.stubEnv('ANTHROPIC_MODEL','claude-haiku-5-5');state.db=fakeDB();await expect(extractJob(new Request('http://local'),'job')).rejects.toThrow(/Haiku/);expect(state.db.events).not.toContain('claim_extraction');expect(state.paid).not.toHaveBeenCalled();expect(state.count).not.toHaveBeenCalled();
});
