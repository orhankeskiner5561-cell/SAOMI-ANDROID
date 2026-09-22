import {NextRequest,NextResponse} from 'next/server';
import {readTrackerState,upsertSignal} from '../../lib/tracker';

export const dynamic='force-dynamic';
export const runtime='nodejs';
const HEADERS={'cache-control':'no-store','access-control-allow-origin':'*'};

export async function GET(req:NextRequest){
  try{
    const limit=Number(req.nextUrl.searchParams.get('limit')||80);
    const symbol=String(req.nextUrl.searchParams.get('symbol')||'').trim().toUpperCase();
    const timeframe=String(req.nextUrl.searchParams.get('timeframe')||'').trim().toLowerCase();
    const state=await readTrackerState(symbol||timeframe?500:limit);
    if(!symbol&&!timeframe){
      return NextResponse.json({ok:true,...state},{headers:HEADERS});
    }
    const match=(x:any)=>(!symbol||String(x?.symbol||'').toUpperCase()===symbol)&&(!timeframe||String(x?.timeframe||'').toLowerCase()===timeframe);
    const active=Object.values(state.activeSignals||{}).filter(match) as any[];
    const history=(state.history||[]).filter(match);
    return NextResponse.json({
      ok:true,
      activeSignals:Object.fromEntries(active.map(x=>[x.signalId,x])),
      history,
      latest:match(state.latest)?state.latest:(active[0]||null),
      count:active.length+history.length
    },{headers:HEADERS});
  }catch(e){
    return NextResponse.json({ok:false,error:e instanceof Error?e.message:'Tracker okunamadı'},{status:502,headers:HEADERS});
  }
}

export async function POST(req:NextRequest){
  try{
    const b=await req.json();
    if(String(b?.mode||'')!=='github-lifecycle') return NextResponse.json({ok:false,error:'Geçersiz tracker modu'},{status:422,headers:HEADERS});
    const signalId=String(b?.signalId||'').trim();
    if(!signalId) throw new Error('signalId gerekli');
    const allowed=['WAIT_ENTRY','ACTIVE','TP1','TP2','TP3','STOP','AMBIGUOUS','EXPIRED','CANCELLED','EXPIRED-CANCELLED'];
    const status=String(b?.status||'').toUpperCase();
    if(!allowed.includes(status)) throw new Error('Geçersiz tracker status');
    const patch:any={status};
    for(const k of ['stage','result','enteredAt','closedAt','expiryKind','currentPrice']) if(b[k]!==undefined) patch[k]=b[k];
    const seed=b?.signal&&typeof b.signal==='object'?{...b.signal,signalId}:null;
    try{
      const row=await upsertSignal(signalId,seed,patch);
      return NextResponse.json({ok:true,signal:row,persisted:'vercel-blob'},{headers:HEADERS});
    }catch(e){
      console.error('TRACKER_BLOB_POST_FAIL_GITHUB_AUTHORITY',signalId,e instanceof Error?e.message:e);
      return NextResponse.json({ok:true,signal:{...(seed||{}),...patch,signalId},persisted:'github-state-authoritative'},{headers:HEADERS});
    }
  }catch(e){
    return NextResponse.json({ok:false,error:e instanceof Error?e.message:'Tracker güncellenemedi'},{status:422,headers:HEADERS});
  }
}
