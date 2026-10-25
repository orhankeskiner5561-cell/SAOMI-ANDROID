import { NextRequest, NextResponse } from 'next/server';
import { GET as getMarket } from '../market/route';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Candle = { openTime:number; open:number; high:number; low:number; close:number; volume:number; closeTime:number; closed:boolean };
const round=(v:number)=>Number.isFinite(v)?Math.round(v*1e6)/1e6:null;
const sma=(v:number[],n:number)=>v.length>=n?v.slice(-n).reduce((a,b)=>a+b,0)/n:null;
function emaSeries(v:number[],n:number):number[] {
  if(v.length<n)return [];
  const out:number[]=[];let value=v.slice(0,n).reduce((a,b)=>a+b,0)/n;out.push(value);
  for(let i=n;i<v.length;i++){value=value+(v[i]-value)*2/(n+1);out.push(value);}
  return out;
}
function rsi(v:number[],n=14):number|null {
  if(v.length<n+1)return null;
  let gain=0,loss=0;
  for(let i=1;i<=n;i++){const d=v[i]-v[i-1];gain+=Math.max(d,0);loss+=Math.max(-d,0);}
  gain/=n;loss/=n;
  for(let i=n+1;i<v.length;i++){const d=v[i]-v[i-1];gain=(gain*(n-1)+Math.max(d,0))/n;loss=(loss*(n-1)+Math.max(-d,0))/n;}
  return loss===0?(gain===0?50:100):100-100/(1+gain/loss);
}
function atrSeries(c:Candle[],n:number):number[] {
  if(c.length<n+1)return [];
  const tr=c.map((x,i)=>i===0?x.high-x.low:Math.max(x.high-x.low,Math.abs(x.high-c[i-1].close),Math.abs(x.low-c[i-1].close)));
  let value=tr.slice(1,n+1).reduce((a,b)=>a+b,0)/n;
  const result=Array(n).fill(NaN).concat(value);
  for(let i=n+1;i<c.length;i++){value=(value*(n-1)+tr[i])/n;result.push(value);}
  return result;
}
function supertrend(c:Candle[],n=10,m=3){
  const atr=atrSeries(c,n);if(!atr.length)return null;
  let upper=0,lower=0,trend=1,line=0;
  for(let i=n;i<c.length;i++){
    const mid=(c[i].high+c[i].low)/2;
    const basicUpper=mid+m*atr[i],basicLower=mid-m*atr[i];
    if(i===n){upper=basicUpper;lower=basicLower;trend=c[i].close>=mid?1:-1;}
    else{
      const prevUpper=upper,prevLower=lower;
      upper=basicUpper<prevUpper||c[i-1].close>prevUpper?basicUpper:prevUpper;
      lower=basicLower>prevLower||c[i-1].close<prevLower?basicLower:prevLower;
      if(trend===1&&c[i].close<prevLower)trend=-1;
      else if(trend===-1&&c[i].close>prevUpper)trend=1;
    }
    line=trend===1?lower:upper;
  }
  return {value:round(line),direction:trend===1?'UP':'DOWN'};
}
export async function GET(req:NextRequest){
  const marketResponse=await getMarket(req);
  const payload=await marketResponse.json();
  if(!marketResponse.ok||!payload.ok||payload.market!=='USD-M FUTURES'||payload.stale||!payload.signalAllowed)
    return NextResponse.json({ok:false,error:'Verified fresh futures candles unavailable',market:payload.market,sourceStatus:marketResponse.status,signalAllowed:false},{status:503,headers:{'cache-control':'no-store'}});
  const all=payload.candles as Candle[];
  const closed=all.filter(c=>c.closed);
  if(closed.length<210)return NextResponse.json({ok:false,error:'At least 210 closed candles required for reliable EMA200 and MACD calculations',closedCount:closed.length,signalAllowed:false},{status:422});
  const closes=closed.map(c=>c.close),volumes=closed.map(c=>c.volume);
  const ema:any={};
  for(const n of [9,21,50,100,200])ema[n]=round(emaSeries(closes,n).at(-1)!);
  const fast=emaSeries(closes,12),slow=emaSeries(closes,26);
  const macdSeries=slow.map((s,i)=>fast[i+14]-s);
  const signal=emaSeries(macdSeries,9).at(-1)!;
  const macd=macdSeries.at(-1)!;
  const mean=sma(closes,20)!;
  const variance=closes.slice(-20).reduce((sum,x)=>sum+(x-mean)**2,0)/20;
  const sd=Math.sqrt(variance);
  const last=closed.at(-1)!;
  return NextResponse.json({
    ok:true,market:payload.market,source:payload.source,symbol:payload.symbol,interval:payload.interval,
    fetchedAt:payload.fetchedAt,stale:false,signalAllowed:true,
    candleCount:all.length,closedCandleCount:closed.length,
    lastClosedCandle:{openTime:last.openTime,closeTime:last.closeTime,open:last.open,high:last.high,low:last.low,close:last.close,volume:last.volume},
    indicators:{
      ema,
      rsi14:round(rsi(closes,14)!),
      macd:{line:round(macd),signal:round(signal),histogram:round(macd-signal)},
      supertrend10_3:supertrend(closed,10,3),
      bollinger20_2:{middle:round(mean),upper:round(mean+2*sd),lower:round(mean-2*sd)},
      atr14:round(atrSeries(closed,14).at(-1)!),
      volume20Average:round(sma(volumes,20)!),
      latestClosedVolume:round(last.volume),
      recentHigh20:round(Math.max(...closed.slice(-20).map(c=>c.high))),
      recentLow20:round(Math.min(...closed.slice(-20).map(c=>c.low)))
    },
    methodology:'Only fully closed futures candles used. EMA SMA-seeded; RSI and ATR Wilder; Bollinger population standard deviation. Indicators are descriptive, not trade signals.',
    warning:'No trade orders placed. This API does not guarantee profitable signals.'
  },{headers:{'cache-control':'no-store','x-content-type-options':'nosniff'}});
}
