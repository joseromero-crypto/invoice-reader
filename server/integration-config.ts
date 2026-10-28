export function integrationIssues(env:Record<string,string|undefined>){
 const issues:string[]=[];
 const required=['VITE_SUPABASE_URL','VITE_SUPABASE_PUBLISHABLE_KEY','SUPABASE_URL','SUPABASE_SECRET_KEY','ANTHROPIC_API_KEY','ANTHROPIC_MODEL'];
 for(const name of required)if(!env[name]?.trim())issues.push(`${name}: missing`);
 for(const name of ['VITE_SUPABASE_URL','SUPABASE_URL'])if(env[name]){try{const url=new URL(env[name]!);if(url.protocol!=='https:'||url.username||url.password||url.pathname!=='/'||url.search||url.hash)issues.push(`${name}: use the HTTPS project root URL`);}catch{issues.push(`${name}: invalid URL`);}}
 if(env.VITE_SUPABASE_URL&&env.SUPABASE_URL&&env.VITE_SUPABASE_URL.replace(/\/$/,'')!==env.SUPABASE_URL.replace(/\/$/,''))issues.push('Browser and server Supabase URLs must identify the same project');
 const publicKey=env.VITE_SUPABASE_PUBLISHABLE_KEY;
 if(publicKey){let role='';try{role=JSON.parse(Buffer.from(publicKey.split('.')[1]??'','base64url').toString()).role??'';}catch{/* New publishable keys are not JWTs. */}
 if(publicKey.startsWith('sb_secret_')||role==='service_role'||publicKey===env.SUPABASE_SECRET_KEY||publicKey===env.ANTHROPIC_API_KEY)issues.push('VITE_SUPABASE_PUBLISHABLE_KEY contains a server secret; rotate it if it was built or published');}
 for(const name of Object.keys(env))if(name.startsWith('VITE_')&&/ANTHROPIC|SECRET|SERVICE_ROLE/i.test(name)&&env[name])issues.push(`${name}: server secrets must never use the VITE_ prefix`);
 for(const name of ['AI_INPUT_USD_PER_MILLION','AI_OUTPUT_USD_PER_MILLION'])if(env[name]&&(!Number.isFinite(Number(env[name]))||Number(env[name])<0))issues.push(`${name}: use a nonnegative finite price or leave blank`);
 return issues;
}
