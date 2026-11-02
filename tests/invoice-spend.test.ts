import {it,expect,vi} from 'vitest';
import Anthropic from '@anthropic-ai/sdk';
import {invoiceRequestOptions} from '../server/invoice-output';
import {invoiceSpendPreflight,invoicePrice,invoiceUsageCost,priorDocumentSpend,reserveDocumentCall,reconcileDocumentCall,documentEstimatedCost,ATTEMPT_BUDGET_USD} from '../server/invoice-spend';
const request=(model='claude-haiku-5-5',pages=2)=>({model,...invoiceRequestOptions(pages,model),system:'synthetic full contract',messages:[{role:'user' as const,content:'synthetic invoice'}]});
const usage=(input=28000,output=16000)=>({input_tokens:input,output_tokens:output,cache_creation_input_tokens:0,cache_read_input_tokens:0} as Anthropic.Usage);
function client(input=28000){return {messages:{countTokens:vi.fn().mockResolvedValue({input_tokens:input})}} as unknown as Pick<Anthropic,'messages'>;}
it('counts the exact request with the actual SDK before reserving maximum output plus padded input',async()=>{
 let calls=0;
 const sdk=new Anthropic({apiKey:'synthetic',maxRetries:0,fetch:async(url,init)=>{calls++;expect(String(url)).toContain('/messages/count_tokens');const body=JSON.parse(String(init?.body));expect(body.messages).toEqual(request().messages);expect(body.output_config).toEqual(request().output_config);expect(body.system).toEqual(request().system);return Response.json({input_tokens:28000});}});
 const reserved=await invoiceSpendPreflight(sdk,request());
 expect(calls).toBe(1);expect(reserved.reservedInputTokens).toBe(34624);expect(reserved.reservedUSD).toBeCloseTo(0.0114624);expect(reserved.maxOutputTokens).toBe(16000);
 expect((await invoiceSpendPreflight(client(),request('claude-haiku-5-5',5))).maxOutputTokens).toBe(32000);
});
it('prices Haiku whole-request threshold correctly and rejects a reservation crossing the expensive tier',async()=>{
 expect(invoicePrice('claude-haiku-5-5',100000)).toEqual({input:0.1,output:0.5});expect(invoicePrice('claude-haiku-5-5',100001)).toEqual({input:0.5,output:2.5});
 expect(invoiceUsageCost('claude-haiku-5-5',usage(100001,100))).toBeCloseTo(0.0502505);
 await expect(invoiceSpendPreflight(client(100000),request())).rejects.toThrow(/presupuesto/);
});
it('refuses unsupported prices, billing modes, bad counts and failed token counting without paid creation',async()=>{
 const sdk=client();await expect(invoiceSpendPreflight(sdk,request('unknown'))).rejects.toThrow(/pricing/);expect(sdk.messages.countTokens).not.toHaveBeenCalled();
 await expect(invoiceSpendPreflight(client(),{...request(),tools:[{name:'loop',description:'x',input_schema:{type:'object'}}]})).rejects.toThrow(/billing mode/);
 await expect(invoiceSpendPreflight(client(NaN),request())).rejects.toThrow(/estimate/);
 const failed=client();vi.mocked(failed.messages.countTokens).mockRejectedValue(new Error('unavailable'));await expect(invoiceSpendPreflight(failed,request())).rejects.toThrow('unavailable');
 await expect(invoiceSpendPreflight(client(),request('claude-sonnet-5-5'))).rejects.toThrow(/presupuesto/);
});
it('keeps interrupted calls reserved through a restart and retains unknown spend and enforces the shared document balance',async()=>{
 const reservation=await invoiceSpendPreflight(client(),request());
 const first=reserveDocumentCall(priorDocumentSpend(null,0),1,reservation);
 const restored=priorDocumentSpend(JSON.parse(JSON.stringify({documentSpend:first})),1);
 expect(documentEstimatedCost(restored)).toBe(reservation.reservedUSD);
 const second=reserveDocumentCall(restored,2,reservation);
 expect(documentEstimatedCost(second)).toBe(2*reservation.reservedUSD);expect(documentEstimatedCost(second)).toBeLessThan(0.05);
 expect(()=>reserveDocumentCall(second,3,reservation)).toThrow(/limit/);expect(()=>reserveDocumentCall(first,1,reservation)).toThrow(/limit/);
 expect(()=>reserveDocumentCall(first,2,{...reservation,reservedUSD:ATTEMPT_BUDGET_USD+0.000001})).toThrow(/spend/);
});
it('reconciles failed/truncated output including thinking once, while retaining prior usage',async()=>{
 const reservation=await invoiceSpendPreflight(client(),request());
 const spend=reserveDocumentCall(priorDocumentSpend(null,0),1,reservation);
 const truncated={...usage(),output_tokens_details:{thinking_tokens:16000}};
 reconcileDocumentCall(spend,truncated,'claude-haiku-5-5');expect(documentEstimatedCost(spend)).toBeCloseTo(0.0108);
 const next=reserveDocumentCall(priorDocumentSpend({documentSpend:spend},1),2,reservation);
 reconcileDocumentCall(next,usage(28000,1000),'claude-haiku-5-5');expect(documentEstimatedCost(next)).toBeCloseTo(0.0141);
 expect(next.calls[0].usage).toEqual(truncated);expect(()=>reconcileDocumentCall(next,usage(),'claude-haiku-5-5')).toThrow(/duplicate/);
});
it('blocks legacy/unknown spend, billing surprises and provider overages instead of assuming zero cost',async()=>{
 for(const prior of [null,{}, {input_tokens:100,output_tokens:100}])expect(()=>priorDocumentSpend(prior,1)).toThrow(/gasto/);
 const reservation=await invoiceSpendPreflight(client(),request());
 const spend=reserveDocumentCall(priorDocumentSpend(null,0),1,reservation);
 expect(()=>reconcileDocumentCall(spend,usage(150000,16000),'claude-haiku-5-5')).toThrow(/exceeded/);
 expect(spend.calls[0].estimatedActualUSD).toBeGreaterThan(0.025);
 expect(()=>reserveDocumentCall(spend,2,reservation)).toThrow(/document spend/);
 expect(()=>invoiceUsageCost('claude-haiku-5-5',{...usage(),cache_creation_input_tokens:10})).toThrow(/cached/);
});

it('keeps unexpected unpriceable usage and blocks further dispatch across restarts',async()=>{
 const reservation=await invoiceSpendPreflight(client(),request());
 const spend=reserveDocumentCall(priorDocumentSpend(null,0),1,reservation);
 const unexpected={...usage(),cache_creation_input_tokens:10};
 expect(()=>reconcileDocumentCall(spend,unexpected,'claude-haiku-5-5')).toThrow(/cached/);
 expect(spend.calls[0].usage).toEqual(unexpected);expect(spend.blocked).toBe(true);
 expect(()=>priorDocumentSpend(JSON.parse(JSON.stringify({documentSpend:spend})),1)).toThrow(/spend blocked/);
 expect(()=>reserveDocumentCall(spend,2,reservation)).toThrow(/spend blocked/);
});
