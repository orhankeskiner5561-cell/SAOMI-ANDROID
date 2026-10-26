import { evaluate } from './saomi-free-btc15m.mjs';
// Historical simulation only. No Telegram, orders, paid API or secrets.
const HOST='https://www.binance.com/fapi/v1/klines';
const LIMIT=1000;
const N=Number(process.env.BACKTEST_CANDLES||1500);
const feeBps=Number(process.env.BACKTEST_FEE_BPS||5);
const round=x=>Math.round(x*100)/100;
async function candles(){
 let end=Date.now(),rows=[];
 while(rows.length<N){
  const limit=Math.min(LIMIT,N-rows.length);
  const url=HOST+'?'+new URLSearchParams({symbol:'BTCUSDT',interval:'15m',limit:String(limit),endTime:String(end)});
  const r=await fetch(url,{signal:AbortSignal.timeout(18000)});
  if(!r.ok)throw Error('Binance HTTP '+r.status);
  const j=await r.json();if(!Array.isArray(j)||!j.length)throw Error('Empty futures candles');
  const batch=j.map(x=>({openTime:+x[0],open:+x[1],high:+x[2],low:+x[3],close:+x[4],volume:+x[5],closeTime:+x[6],closed:+x[6]<Date.now()}));
  rows=[...batch,...rows];end=batch[0].openTime-1;
  if(batch.length<limit)break;
 }
 return [...new Map(rows.map(x=>[x.openTime,x])).values()].sort((a,b)=>a.openTime-b.openTime).filter(x=>x.closed);
}
function ema(v,n){let x=v.slice(0,n).reduce((a,b)=>a+b,0)/n;for(let i=n;i<v.length;i++)x=(v[i]-x)*2/(n+1)+x;return x}
function rsi(v,n=14){let up=0,dn=0;for(let i=1;i<=n;i++){const d=v[i]-v[i-1];up+=Math.max(d,0);dn+=Math.max(-d,0)}up/=n;dn/=n;for(let i=n+1;i<v.length;i++){const d=v[i]-v[i-1];up=(up*(n-1)+Math.max(d,0))/n;dn=(dn*(n-1)+Math.max(-d,0))/n}return dn===0?100:100-100/(1+up/dn)}
function atr(v,n=14){const tr=v.slice(1).map((x,i)=>Math.max(x.high-x.low,Math.abs(x.high-v[i].close),Math.abs(x.low-v[i].close)));let a=tr.slice(0,n).reduce((s,x)=>s+x,0)/n;for(let i=n;i<tr.length;i++)a=(a*(n-1)+tr[i])/n;return a}
function macd(v){const close=v.map(x=>x.close),series=[],e=(n)=>{let a=close.slice(0,n).reduce((s,x)=>s+x,0)/n,arr=[];for(let i=n;i<close.length;i++){a+=(close[i]-a)*2/(n+1);arr.push([i,a])}return arr};const a=new Map(e(12)),b=new Map(e(26));for(const [i,x] of b)series.push(x-a.get(i));let sig=series.slice(0,9).reduce((s,x)=>s+x,0)/9;for(let i=9;i<series.length;i++)sig+=(series[i]-sig)*.2;return series.at(-1)-sig}
function supertrend(v,period=10,mult=3){
 let prevUpper=0,prevLower=0,prevTrend=1,prevClose=0;let a=0;
 for(let i=1;i<v.length;i++){
  const b=v[i],p=v[i-1],tr=Math.max(b.high-b.low,Math.abs(b.high-p.close),Math.abs(b.low-p.close));
  if(i<=period){a+=tr;if(i===period)a/=period;else continue}else a=(a*(period-1)+tr)/period;
  const mid=(b.high+b.low)/2,upper=mid+mult*a,lower=mid-mult*a;
  const fu=(upper<prevUpper||prevClose>prevUpper)?upper:prevUpper;
  const fl=(lower>prevLower||prevClose<prevLower)?lower:prevLower;
  const trend=i===period?(b.close>=mid?1:-1):prevTrend===1?(b.close<fl?-1:1):(b.close>fu?1:-1);
  prevUpper=fu;prevLower=fl;prevClose=b.close;prevTrend=trend;
 }
 return prevTrend===1?'UP':'DOWN';
}
function indicators(v){
 const close=v.map(x=>x.close),m=macd(v);
 return {atr14:atr(v),rsi14:rsi(close),macd:{histogram:m},supertrend10_3:{direction:supertrend(v)},ema:{'9':ema(close,9),'21':ema(close,21)},volume20Average:v.slice(-20).reduce((s,x)=>s+x.volume,0)/20};
}
function settle(c,start,d){
 const risk=Math.abs(d.entry-d.stop),tp=d.tp1;
 for(let i=start;i<c.length;i++){
  const b=c[i],hitStop=d.decision==='LONG'?b.low<=d.stop:b.high>=d.stop;
  const hitTp=d.decision==='LONG'?b.high>=tp:b.low<=tp;
  if(hitStop)return {outcome:hitTp?'BOTH_STOP_FIRST':'STOP',r:-1-2*feeBps/10000*d.entry/risk,bars:i-start+1};
  if(hitTp)return {outcome:'TP1',r:2-2*feeBps/10000*d.entry/risk,bars:i-start+1};
 }
 return {outcome:'OPEN',r:null,bars:c.length-start};
}
async function main(){
 const c=await candles(),signals=[];let blocked=0,wait=0,prevKey='';
 for(let i=299;i<c.length-1;i++){
  const v=c.slice(i-299,i+1),d=evaluate(v,indicators(v));
  if(d.decision==='BEKLE'){wait++;continue}
  const key=d.decision+'|'+d.breakTime;
  if(key===prevKey){blocked++;continue}
  prevKey=key;
  const result=settle(c,i+1,d);
  signals.push({time:new Date(c[i].closeTime).toISOString(),direction:d.decision,entry:d.entry,stop:d.stop,tp1:d.tp1,...result});
 }
 const closed=signals.filter(x=>x.r!==null),wins=closed.filter(x=>x.outcome==='TP1').length,losses=closed.length-wins;
 const summary={symbol:'BTCUSDT',interval:'15m',historicalCandles:c.length,first:new Date(c[0].openTime).toISOString(),last:new Date(c.at(-1).closeTime).toISOString(),signals:signals.length,closed:closed.length,open:signals.length-closed.length,wins,losses,winRatePct:closed.length?round(wins/closed.length*100):null,netR:round(closed.reduce((s,x)=>s+x.r,0)),feesBpsPerSide:feeBps,waitBars:wait,deduped:blocked,assumptions:'Historical approximation: 300 closed candles at each evaluation, next-bar outcome, STOP wins same-candle ambiguity, TP1=2R, fees, no slippage; indicator implementation may differ from SAOMI API; overlapping trades possible; not verified live performance.'};
 console.log('SAOMI_FREE_BACKTEST',JSON.stringify(summary));
 for(const s of signals.slice(-20))console.log('SAOMI_FREE_BACKTEST_TRADE',JSON.stringify(s));
}
main().catch(e=>{console.error('SAOMI_FREE_BACKTEST_ERROR',e.message);process.exitCode=1});
