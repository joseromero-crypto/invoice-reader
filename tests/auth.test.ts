import {it,expect,vi} from 'vitest';
import {authorize} from '../server/auth';
import handler from '../netlify/functions/receiving';
it('rejects unauthenticated callers before creating a service client or paid work',async()=>{await expect(authorize(new Request('https://example.com'))).rejects.toMatchObject({status:401});const response=await handler(new Request('https://example.com/api/receiving',{method:'POST',body:'{"action":"create"}'}));expect(response.status).toBe(401);});
it('does not accept GET mutation requests',async()=>{expect((await handler(new Request('https://example.com'))).status).toBe(405);});

import catalogHandler from '../netlify/functions/catalog';
it('rejects unauthenticated catalog updates before accessing files or products',async()=>{const response=await catalogHandler(new Request('https://example.com/api/catalog',{method:'POST',body:JSON.stringify({action:'apply'})}));expect(response.status).toBe(401);});
