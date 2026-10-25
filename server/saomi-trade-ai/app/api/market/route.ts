import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Read-only diagnostics and market-data access. Never treat spot candles as futures candles.
const INTERVALS = new Set(['1m','3m','5m','15m','30m','1h','2h','4h','6h','8h','12h','1d','1w','1M']);
const FUTURES = 'https://fapi.binance.com';
const SPOT = 'https://api.binance.com';

async function load(base:string,symbol:string,interval:string,limit:number) {
  const q=new URLSearchParams({symbol,interval,limit:String(limit)});
  const path=base===FUTURES?'/fapi/v1/klines':'/api/v3/klines';
  const res=await fetch(base+path+'?'+q,{cache:'no-store',signal:AbortSignal.timeout(10000)});
  if(!res.ok) return {ok:false,status:res.status,rows:null};
  const rows:unknown=await res.json();
  if(!Array.isArray(rows)||!rows.every(r=>Array.isArray(r)&&r.length>=7))return {ok:false,status:502,rows:null};
  return {ok:true,status:200,rows:rows as any[][]};
}
export async function GET(req:NextRequest) {
  const symbol=(req.nextUrl.searchParams.get('symbol')||'BTCUSDT').trim().toUpperCase();
  const interval=req.nextUrl.searchParams.get('interval')||'15m';
  const limit=Number(req.nextUrl.searchParams.get('limit')||'300');
  const allowSpot=req.nextUrl.searchParams.get('spotFallback')==='1';
  if(!/^[A-Z0-9]{5,24}$/.test(symbol)||!INTERVALS.has(interval)||
    !Number.isInteger(limit)||limit<20||limit>500)
    return NextResponse.json({ok:false,error:'Invalid symbol, interval or limit'},{status:400});
  try {
    const futures=await load(FUTURES,symbol,interval,limit);
    let selected=futures;
    let market='USD-M FUTURES';
    if(!futures.ok && allowSpot) {
      const spot=await load(SPOT,symbol,interval,limit);
      if(spot.ok){selected=spot;market='SPOT';}
    }
    if(!selected.ok || !selected.rows)
      return NextResponse.json({ok:false,error:'Binance market data unavailable',futuresStatus:futures.status,
        status:selected.status,market:'USD-M FUTURES',signalAllowed:false,
        note:futures.status===451?'Futures API returned HTTP 451; access restriction must be resolved with the provider. No proxy bypass is attempted.':'Upstream request failed.'},
        {status:503,headers:{'cache-control':'no-store'}});
    const now=Date.now();
    const candles=selected.rows.map(r=>({
      openTime:Number(r[0]),open:Number(r[1]),high:Number(r[2]),low:Number(r[3]),
      close:Number(r[4]),volume:Number(r[5]),closeTime:Number(r[6]),
      closed:Number(r[6])<now
    }));
    const last=candles[candles.length-1];
    const stale=!last||last.closeTime<now-24*60*60*1000;
    return NextResponse.json({
      ok:true,source:'Binance public market data',market,symbol,interval,
      fetchedAt:new Date(now).toISOString(),lastCandleCloseTime:last?.closeTime,
      stale,signalAllowed:market==='USD-M FUTURES'&&!stale,
      futuresStatus:futures.status,candles,
      warning:market==='SPOT'?'SPOT FALLBACK ONLY. Do not use spot prices as futures entry/stop levels.':
        'Unclosed candles may change. Data does not constitute a trade signal.'
    },{headers:{'cache-control':'no-store','x-content-type-options':'nosniff'}});
  }catch{
    return NextResponse.json({ok:false,error:'Market data request failed',signalAllowed:false},
      {status:503,headers:{'cache-control':'no-store'}});
  }
}
