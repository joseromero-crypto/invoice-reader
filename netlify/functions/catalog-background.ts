import {z} from 'zod';
import {authorize} from '../../server/auth';
import {readJob,runJob} from '../../server/masterview';
export const config={background:true};
// Parsing four exports and writing ~19k rows doesn't fit a synchronous function's time limit.
export default async function handler(request:Request){
 if(request.method!=='POST')return new Response(null,{status:405});
 try{
 const {jobId,paths,confirmDrop}=z.object({jobId:z.string().uuid(),paths:z.array(z.string().max(200)).min(1).max(8),confirmDrop:z.boolean()}).parse(await request.json());
 const {db,userId,role}=await authorize(request);if(role!=='admin')return new Response(null,{status:403});
 const job=await readJob(db);if(job?.id!==jobId||job.state!=='running')return new Response(null,{status:409});
 await runJob(db,userId,job,{paths,confirmDrop});return new Response(null,{status:200});
 }catch{return new Response(null,{status:400});}
}
