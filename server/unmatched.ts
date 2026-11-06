import type {SupabaseClient} from '@supabase/supabase-js';
import {MATCH_CITY} from '../lean/catalog.ts';
import type {CatalogItem} from '../lean/match.ts';
import {unmatched,type SavedRead} from '../lean/unmatched.ts';
import {check} from './auth';
import {leanMappings} from './rematch';
import {catalog,cityItems,inTurns,retried} from './workspace';
// The newest reads only: this runs inside a normal function call, which has seconds, not minutes.
export const READS=200;const PAGE=100;
export async function unmatchedReport(db:SupabaseClient,orgId:string){
 const [pages,raw]=await Promise.all([inTurns(READS/PAGE,i=>retried(async()=>check(await db.from('extraction_jobs').select('created_at,raw_result,documents!inner(receiving_sessions!inner(hubs!inner(name,city)))').eq('org_id',orgId).eq('status','complete').order('created_at',{ascending:false}).range(i*PAGE,(i+1)*PAGE-1))??[])),catalog(db,MATCH_CITY)]);
 const reads:SavedRead[]=(pages.flat() as any[]).filter(j=>Array.isArray(j.raw_result?.transcription?.rows)).map(j=>{const hub=j.documents.receiving_sessions.hubs;return {transcription:j.raw_result.transcription,city:hub.city??MATCH_CITY,hub:hub.name,at:j.created_at};});
 const items=new Map<string,CatalogItem[]>(),itemsFor=(city:string)=>{if(!items.has(city))items.set(city,cityItems(raw,city));return items.get(city)!;};
 return {rows:unmatched(reads,itemsFor,await leanMappings(db,orgId,raw)),reads:reads.length,since:reads.at(-1)?.at??null,limit:READS};
}
