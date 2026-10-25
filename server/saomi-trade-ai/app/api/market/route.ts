import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const INTERVALS = new Set(['1m','3m','5m','15m','30m','1h','2h','4h','6h','8h','12h','1d','1w','1M']);
const BASE = 'https://fapi.binance.com';

export async function GET(req: NextRequest) {
  const symbol = (req.nextUrl.searchParams.get('symbol') || 'BTCUSDT').trim().toUpperCase();
  const interval = req.nextUrl.searchParams.get('interval') || '15m';
  const rawLimit = Number(req.nextUrl.searchParams.get('limit') || '300');
  if (!/^[A-Z0-9]{5,24}$/.test(symbol) || !INTERVALS.has(interval) ||
      !Number.isInteger(rawLimit) || rawLimit < 20 || rawLimit > 500) {
    return NextResponse.json({ok:false,error:'Invalid symbol, interval or limit'}, {status:400});
  }
  try {
    const params = new URLSearchParams({symbol, interval, limit:String(rawLimit)});
    const upstream = await fetch(`${BASE}/fapi/v1/klines?${params}`, {
      cache:'no-store', signal:AbortSignal.timeout(10000)
    });
    if (!upstream.ok) {
      return NextResponse.json({ok:false,error:'Market data unavailable',upstreamStatus:upstream.status},{status:502});
    }
    const rows: unknown = await upstream.json();
    if (!Array.isArray(rows) || !rows.every(r=>Array.isArray(r) && r.length>=7)) {
      return NextResponse.json({ok:false,error:'Unexpected market data'},{status:502});
    }
    const now = Date.now();
    const candles = rows.map((r:any[])=>({
      openTime:Number(r[0]),open:Number(r[1]),high:Number(r[2]),low:Number(r[3]),
      close:Number(r[4]),volume:Number(r[5]),closeTime:Number(r[6]),
      closed:Number(r[6]) < now
    }));
    return NextResponse.json({
      ok:true,source:'Binance USD-M Futures public market data',symbol,interval,
      fetchedAt:new Date(now).toISOString(),candles,
      warning:'Last candle may be unfinished; this endpoint never places orders.'
    },{headers:{'cache-control':'no-store, max-age=0','x-content-type-options':'nosniff'}});
  } catch {
    return NextResponse.json({ok:false,error:'Market data request failed'},{status:502});
  }
}
