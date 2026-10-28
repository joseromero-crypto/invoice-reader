import {z} from 'zod';
export function limits(){return z.object({maxUploadBytes:z.coerce.number().int().min(1000).max(10000000),maxPages:z.coerce.number().int().min(1).max(8)}).parse({maxUploadBytes:process.env.MAX_UPLOAD_BYTES??10000000,maxPages:process.env.MAX_PAGES_PER_DOCUMENT??8});}
