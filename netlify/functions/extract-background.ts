import {extractJob} from '../../server/extract';
import {z} from 'zod';
export const config={background:true};
export default async function handler(request:Request){
 if(request.method!=='POST')return new Response(null,{status:405});
 try{const {jobId}=z.object({jobId:z.string().uuid()}).parse(await request.json());await extractJob(request,jobId);return new Response(null,{status:200});}
 catch{return new Response(null,{status:400});}
}
