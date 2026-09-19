import fs from 'node:fs';
const BASE = 'https://saomi-trade-ai.vercel.app';
const FUTURES = 'https://www.binance.com';
const SYMBOLS = ['BTCUSDT','ETHUSDT','XRPUSDT','SOLUSDT','BNBUSDT','DOGEUSDT','ADAUSDT'];
const BASE_TFS = ['1m','5m','15m','30m'];
const HTF_ORDER = ['1w','1d','4h','1h'];
const HTF_WEIGHT = {'1w':4,'1d':3,'4h':2,'1h':1};
const ANALYSIS_VERSION='RC5.26_CANONICAL_MAJOR_MINOR';
const CONFIRM_MAP = {
  '1m':['5m','15m'],
  '5m':['15m','30m'],
  '15m':['30m'],
  '30m':[]
};
const MIN_CONFIDENCE = 76;
const MIN_RR = 2.0;
const MAX_SIGNALS = 8;
const STATE_PATH = '.github/state/saomi-telegram-state.json';
const DEFAULT_DUP_TTL_MS = 12*60*60*1000;
const DEFAULT_COOLDOWN_MS = 30*60*1000;
const TF_DUP_TTL_MS = {
  '1m':30*60*1000,
  '5m':2*60*60*1000,
  '15m':6*60*60*1000,
  '30m':8*60*60*1000,
  '1h':12*60*60*1000,
  '4h':24*60*60*1000
};
const TF_COOLDOWN_MS = {
  '1m':5*60*1000,
  '5m':15*60*1000,
  '15m':30*60*1000,
  '30m':60*60*1000,
  '1h':2*60*60*1000,
  '4h':8*60*60*1000
};
const TERMINAL_REENTRY_MS = {
  '1m':15*60*1000,
  '5m':30*60*1000,
  '15m':60*60*1000,
  '30m':2*60*60*1000
};
const terminalReentryMs=tf=>TERMINAL_REENTRY_MS[String(tf||'15m').toLowerCase()]??60*60*1000;
const REANALYSIS_MAX = 3;

const confirmFrames=tf=>CONFIRM_MAP[tf]||[];
const signalStateKey=(symbol,tf)=>`${String(symbol||'').toUpperCase()}|${String(tf||'15m').toLowerCase()}`;
const cooldownMs=tf=>TF_COOLDOWN_MS[tf]??DEFAULT_COOLDOWN_MS;
const dupTtlMs=tf=>TF_DUP_TTL_MS[tf]??DEFAULT_DUP_TTL_MS;

const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const finite=a=>a.filter(Number.isFinite);
function sma(a,n){const out=Array(a.length).fill(null);let s=0;for(let i=0;i<a.length;i++){s+=a[i];if(i>=n)s-=a[i-n];if(i>=n-1)out[i]=s/n}return out}
function ema(a,n){const out=Array(a.length).fill(null);if(!a.length)return out;const k=2/(n+1);let x=a[0];for(let i=0;i<a.length;i++){x=i===0?a[i]:a[i]*k+x*(1-k);if(i>=n-1)out[i]=x}return out}
function trueRange(c){return c.map((x,i)=>i===0?x.high-x.low:Math.max(x.high-x.low,Math.abs(x.high-c[i-1].close),Math.abs(x.low-c[i-1].close)))}
function atr(c,n=14){return ema(trueRange(c),n)}
function rsi(a,n=14){const out=Array(a.length).fill(null);if(a.length<n+1)return out;let gain=0,loss=0;for(let i=1;i<=n;i++){const d=a[i]-a[i-1];gain+=Math.max(d,0);loss+=Math.max(-d,0)}gain/=n;loss/=n;out[n]=loss===0?100:100-(100/(1+gain/loss));for(let i=n+1;i<a.length;i++){const d=a[i]-a[i-1];gain=(gain*(n-1)+Math.max(d,0))/n;loss=(loss*(n-1)+Math.max(-d,0))/n;out[i]=loss===0?100:100-(100/(1+gain/loss))}return out}
function macd(a,fast=12,slow=26,signal=9){const f=ema(a,fast),s=ema(a,slow),line=a.map((_,i)=>f[i]!=null&&s[i]!=null?f[i]-s[i]:null);const clean=line.map(v=>v??0),sig=ema(clean,signal);return{line,signal:line.map((v,i)=>v==null||sig[i]==null?null:sig[i]),hist:line.map((v,i)=>v==null||sig[i]==null?null:v-sig[i])}}
function bollinger(a,n=20,m=2){const mid=sma(a,n),upper=Array(a.length).fill(null),lower=Array(a.length).fill(null);for(let i=n-1;i<a.length;i++){let ss=0;for(let j=i-n+1;j<=i;j++)ss+=(a[j]-mid[i])**2;const sd=Math.sqrt(ss/n);upper[i]=mid[i]+m*sd;lower[i]=mid[i]-m*sd}return{mid,upper,lower}}
function stochRsi(a,rsiN=14,stochN=14,kN=3,dN=3){const r=rsi(a,rsiN),raw=Array(a.length).fill(null);for(let i=rsiN+stochN-1;i<a.length;i++){const w=finite(r.slice(i-stochN+1,i+1));if(w.length<stochN)continue;const lo=Math.min(...w),hi=Math.max(...w);raw[i]=hi===lo?50:((r[i]-lo)/(hi-lo))*100}const k=sma(raw.map(v=>v??0),kN).map((v,i)=>raw[i]==null?null:v);const d=sma(k.map(v=>v??0),dN).map((v,i)=>k[i]==null?null:v);return{rsi:r,raw,k,d}}
function indicatorSnapshot(c){const close=c.map(x=>x.close),e9=ema(close,9),e50=ema(close,50),e200=ema(close,200),r=rsi(close,14),m=macd(close),b=bollinger(close),s=stochRsi(close),a=atr(c,14),i=c.length-1;return{ema9:e9[i],ema50:e50[i],ema200:e200[i],rsi:r[i],macd:m.line[i],macdSignal:m.signal[i],macdHist:m.hist[i],bbMid:b.mid[i],bbUpper:b.upper[i],bbLower:b.lower[i],stochK:s.k[i],stochD:s.d[i],atr:a[i]}}
function pivots(c,left=3,right=3){const highs=[],lows=[];for(let i=left;i<c.length-right;i++){let hi=true,lo=true;for(let j=i-left;j<=i+right;j++){if(j===i)continue;if(c[j].high>=c[i].high)hi=false;if(c[j].low<=c[i].low)lo=false}if(hi)highs.push({i,time:c[i].time,price:c[i].high});if(lo)lows.push({i,time:c[i].time,price:c[i].low})}return{highs,lows}}
function detectStructure(c){const p=pivots(c);const events=[];const hs=p.highs.slice(-10),ls=p.lows.slice(-10);let trend='RANGE';if(hs.length>=2&&ls.length>=2){const hh=hs.at(-1).price>hs.at(-2).price,hl=ls.at(-1).price>ls.at(-2).price,lh=hs.at(-1).price<hs.at(-2).price,ll=ls.at(-1).price<ls.at(-2).price;if(hh&&hl)trend='UP';else if(lh&&ll)trend='DOWN'}for(let i=1;i<c.length;i++){const prevH=p.highs.filter(x=>x.i<i).at(-1),prevL=p.lows.filter(x=>x.i<i).at(-1);if(prevH&&c[i].close>prevH.price&&c[i-1].close<=prevH.price)events.push({type:trend==='DOWN'?'CHoCH':'BOS',side:'UP',time:c[i].time,price:prevH.price});if(prevL&&c[i].close<prevL.price&&c[i-1].close>=prevL.price)events.push({type:trend==='UP'?'CHoCH':'BOS',side:'DOWN',time:c[i].time,price:prevL.price})}
 const equalHighs=[],equalLows=[];const recent=c.slice(-120);const ref=Math.max(1,recent.at(-1)?.close||1),tol=ref*0.0008;for(let i=0;i<hs.length;i++)for(let j=i+1;j<hs.length;j++)if(Math.abs(hs[i].price-hs[j].price)<=tol)equalHighs.push({a:hs[i],b:hs[j],price:(hs[i].price+hs[j].price)/2});for(let i=0;i<ls.length;i++)for(let j=i+1;j<ls.length;j++)if(Math.abs(ls[i].price-ls[j].price)<=tol)equalLows.push({a:ls[i],b:ls[j],price:(ls[i].price+ls[j].price)/2});
 const fvgs=[];for(let i=Math.max(2,c.length-160);i<c.length;i++){if(c[i].low>c[i-2].high)fvgs.push({side:'BULL',from:c[i-2].high,to:c[i].low,time:c[i].time});if(c[i].high<c[i-2].low)fvgs.push({side:'BEAR',from:c[i].high,to:c[i-2].low,time:c[i].time})}
 const obs=[];for(const e of events.slice(-8)){const idx=c.findIndex(x=>x.time===e.time);for(let j=idx-1;j>=Math.max(0,idx-8);j--){const bull=c[j].close>c[j].open;if((e.side==='UP'&&!bull)||(e.side==='DOWN'&&bull)){obs.push({side:e.side==='UP'?'BULL':'BEAR',time:c[j].time,low:c[j].low,high:c[j].high});break}}}
 const sweeps=[];for(let i=Math.max(1,c.length-80);i<c.length;i++){const priorH=Math.max(...c.slice(Math.max(0,i-20),i).map(x=>x.high)),priorL=Math.min(...c.slice(Math.max(0,i-20),i).map(x=>x.low));if(c[i].high>priorH&&c[i].close<priorH)sweeps.push({side:'HIGH',time:c[i].time,price:priorH});if(c[i].low<priorL&&c[i].close>priorL)sweeps.push({side:'LOW',time:c[i].time,price:priorL})}
 return{trend,pivots:p,events:events.slice(-20),equalHighs:equalHighs.slice(-5),equalLows:equalLows.slice(-5),fvgs:fvgs.slice(-12),orderBlocks:obs.slice(-8),sweeps:sweeps.slice(-8)}}
const waitResult=(symbol,tf,price,confidence,reasons,invalidation='Yapısal üstünlük oluşmadı',extra={})=>({symbol,timeframe:tf,price,direction:'WAIT',confidence,entry:null,stop:null,tp1:null,tp2:null,tp3:null,riskReward:null,reasons,invalidation,quality:'WAIT',...extra});
const lastRecent=(arr,c,n=80)=>{if(!arr?.length||!c?.length)return null;const min=c[Math.max(0,c.length-n)]?.time??-Infinity;return[...arr].reverse().find(x=>(x.time??x.b?.time??0)>=min)||null};

function uniqueLevels(levels,tol){
  const out=[];
  for(const x of levels.sort((a,b)=>a.price-b.price)){
    const prev=out.at(-1);
    if(prev&&Math.abs(prev.price-x.price)<=tol){
      prev.price=(prev.price+x.price)/2;
      prev.from=Math.min(prev.from??x.from,x.from);
      prev.to=Math.max(prev.to??x.to,x.to);
      prev.count=(prev.count||1)+(x.count||1);
    }else out.push({...x,count:x.count||1});
  }
  return out
}
function buildLiquidityMap(c,label='15m'){
  if(!c?.length)return{timeframe:label,untakenHighs:[],untakenLows:[],takenHighs:[],takenLows:[]};
  const p=pivots(c,3,3),last=c.at(-1),av=atr(c,14).at(-1)||Math.max((last?.close||1)*.004,1e-8);
  const tol=Math.max((last?.close||1)*0.0009,av*0.12);
  const raw=[];
  const highs=p.highs.slice(-40),lows=p.lows.slice(-40);
  for(let i=0;i<highs.length;i++)for(let j=i+1;j<highs.length;j++){
    if(Math.abs(highs[i].price-highs[j].price)<=tol)raw.push({side:'HIGH',price:(highs[i].price+highs[j].price)/2,from:highs[i].time,to:highs[j].time,anchorIndex:highs[j].i});
  }
  for(let i=0;i<lows.length;i++)for(let j=i+1;j<lows.length;j++){
    if(Math.abs(lows[i].price-lows[j].price)<=tol)raw.push({side:'LOW',price:(lows[i].price+lows[j].price)/2,from:lows[i].time,to:lows[j].time,anchorIndex:lows[j].i});
  }
  const merged=uniqueLevels(raw,tol*.6).map(x=>{
    const after=c.slice((x.anchorIndex??0)+1);
    const taken=x.side==='HIGH'
      ? after.some(k=>k.high>x.price+tol*.15)
      : after.some(k=>k.low<x.price-tol*.15);
    const takenAt=taken?(x.side==='HIGH'
      ? after.find(k=>k.high>x.price+tol*.15)?.time
      : after.find(k=>k.low<x.price-tol*.15)?.time):null;
    return{side:x.side,price:x.price,from:x.from,to:x.to,taken,takenAt,timeframe:label};
  });
  return{
    timeframe:label,
    untakenHighs:merged.filter(x=>x.side==='HIGH'&&!x.taken).slice(-8),
    untakenLows:merged.filter(x=>x.side==='LOW'&&!x.taken).slice(-8),
    takenHighs:merged.filter(x=>x.side==='HIGH'&&x.taken).slice(-8),
    takenLows:merged.filter(x=>x.side==='LOW'&&x.taken).slice(-8)
  }
}
function nearestAbove(levels,price){return (levels||[]).filter(x=>x.price>price).sort((a,b)=>a.price-b.price)[0]||null}
function nearestBelow(levels,price){return (levels||[]).filter(x=>x.price<price).sort((a,b)=>b.price-a.price)[0]||null}

function clusterPivotLevels(points,tol,side){
  const rows=(points||[]).map(x=>({price:x.price,time:x.time,i:x.i,side})).sort((a,b)=>a.price-b.price);
  const groups=[];
  for(const p of rows){
    const g=groups.find(x=>Math.abs(x.price-p.price)<=tol);
    if(g){
      g.members.push(p);
      g.price=g.members.reduce((s,m)=>s+m.price,0)/g.members.length;
    }else groups.push({price:p.price,members:[p],side});
  }
  return groups.filter(g=>g.members.length>=3);
}
function detectRoleReversalZones(c,label='4h'){
  if(!c?.length)return[];
  const avSeries=atr(c,14),last=c.at(-1),lastAv=avSeries.at(-1)||Math.max((last?.close||1)*.006,1e-8);
  const p=pivots(c,2,2);
  const tol=Math.max((last?.close||1)*0.0015,lastAv*.16);
  const breakPad=Math.max((last?.close||1)*0.0008,lastAv*.12);
  const retestTol=Math.max((last?.close||1)*0.0022,lastAv*.28);
  const zones=[
    ...clusterPivotLevels(p.lows.slice(-80),tol,'SUPPORT'),
    ...clusterPivotLevels(p.highs.slice(-80),tol,'RESISTANCE')
  ];
  const out=[];
  for(const z of zones){
    const lastTouchI=Math.max(...z.members.map(m=>m.i));
    const search=c.slice(lastTouchI+1);
    if(!search.length)continue;
    let breakIndex=-1,breakCandle=null,breakStrength=0;
    for(let j=0;j<search.length;j++){
      const k=search[j],globalI=lastTouchI+1+j,av=avSeries[globalI]||lastAv;
      const body=Math.abs(k.close-k.open);
      if(z.side==='SUPPORT'){
        const broke=k.close<z.price-breakPad;
        const bearish=k.close<k.open;
        if(broke&&bearish&&body>=av*.45){breakIndex=globalI;breakCandle=k;breakStrength=body/Math.max(av,1e-12);break}
      }else{
        const broke=k.close>z.price+breakPad;
        const bullish=k.close>k.open;
        if(broke&&bullish&&body>=av*.45){breakIndex=globalI;breakCandle=k;breakStrength=body/Math.max(av,1e-12);break}
      }
    }
    if(breakIndex<0)continue;

    const after=c.slice(breakIndex+1);
    let retest=null,retestIndex=-1;
    for(let j=0;j<after.length;j++){
      const k=after[j],globalI=breakIndex+1+j;
      if(z.side==='SUPPORT'){
        const touches=k.high>=z.price-retestTol&&k.low<=z.price+retestTol;
        const rejects=k.close<=z.price+tol*.35;
        if(touches&&rejects){retest=k;retestIndex=globalI;break}
      }else{
        const touches=k.low<=z.price+retestTol&&k.high>=z.price-retestTol;
        const rejects=k.close>=z.price-tol*.35;
        if(touches&&rejects){retest=k;retestIndex=globalI;break}
      }
    }

    const recentAfterBreak=c.slice(breakIndex+1);
    const reclaimed=z.side==='SUPPORT'
      ? recentAfterBreak.slice(-2).filter(k=>k.close>z.price+tol).length===2
      : recentAfterBreak.slice(-2).filter(k=>k.close<z.price-tol).length===2;
    const nearNow=z.side==='SUPPORT'
      ? last.close<=z.price+retestTol&&last.close>=z.price-retestTol*1.8
      : last.close>=z.price-retestTol&&last.close<=z.price+retestTol*1.8;
    const recentBreak=(c.length-1-breakIndex)<=36;
    const active=!reclaimed&&recentBreak&&(nearNow||retestIndex>=0&&(c.length-1-retestIndex)<=12);

    out.push({
      type:z.side==='SUPPORT'?'SUPPORT_TO_RESISTANCE':'RESISTANCE_TO_SUPPORT',
      timeframe:label,
      level:z.price,
      tests:z.members.length,
      firstTouchTime:Math.min(...z.members.map(m=>m.time)),
      lastTouchTime:Math.max(...z.members.map(m=>m.time)),
      breakTime:breakCandle.time,
      breakClose:breakCandle.close,
      breakStrengthAtr:Number(breakStrength.toFixed(2)),
      retestTime:retest?.time??null,
      retestClose:retest?.close??null,
      reclaimed,
      nearNow,
      active
    });
  }
  return out.filter(x=>x.active).sort((a,b)=>Math.abs(a.level-last.close)-Math.abs(b.level-last.close)).slice(0,8);
}
function majorSwingLevels(c,label){
  if(!c?.length)return[];
  const p=pivots(c,label==='1w'?2:3,label==='1w'?2:3);
  return[
    ...p.highs.slice(-24).map(x=>({side:'RESISTANCE',price:x.price,time:x.time,timeframe:label})),
    ...p.lows.slice(-24).map(x=>({side:'SUPPORT',price:x.price,time:x.time,timeframe:label}))
  ];
}
async function buildHtfContext(symbol,price){
  const [d,w,h4]=await Promise.all([candles(symbol,'1d'),candles(symbol,'1w'),candles(symbol,'4h')]);
  const dLast=d.at(-1)||null,wLast=w.at(-1)||null;
  const di=d.length?indicatorSnapshot(d):{},dAtr=di.atr||atr(d,14).at(-1)||Math.max(price*.01,1e-8);
  const levels=[...majorSwingLevels(d,'1d'),...majorSwingLevels(w,'1w')];
  const resistances=levels.filter(x=>x.side==='RESISTANCE');
  const supports=levels.filter(x=>x.side==='SUPPORT');
  const nearestResistance=nearestAbove(resistances,price);
  const nearestSupport=nearestBelow(supports,price);
  const liq4h=buildLiquidityMap(h4,'4h'),liq1d=buildLiquidityMap(d,'1d');
  const roleReversals4h=detectRoleReversalZones(h4,'4h');
  const brokenSupportRetest=roleReversals4h.find(x=>x.type==='SUPPORT_TO_RESISTANCE')||null;
  const brokenResistanceRetest=roleReversals4h.find(x=>x.type==='RESISTANCE_TO_SUPPORT')||null;
  const allUntakenHighs=[...liq4h.untakenHighs,...liq1d.untakenHighs];
  const allUntakenLows=[...liq4h.untakenLows,...liq1d.untakenLows];
  const nearestUntakenHigh=nearestAbove(allUntakenHighs,price);
  const nearestUntakenLow=nearestBelow(allUntakenLows,price);
  const ema50=di.ema50;
  const extensionAtr=Number.isFinite(ema50)&&dAtr>0?(price-ema50)/dAtr:null;
  const recent20=d.slice(-20);
  const low20=recent20.length?Math.min(...recent20.map(x=>x.low)):null;
  const high20=recent20.length?Math.max(...recent20.map(x=>x.high)):null;
  return{
    previousDayHigh:dLast?.high??null,previousDayLow:dLast?.low??null,
    previousWeekHigh:wLast?.high??null,previousWeekLow:wLast?.low??null,
    dailyAtr:dAtr,dailyEma50:ema50??null,extensionAtr,
    riseFrom20dLowPct:low20?((price/low20)-1)*100:null,
    fallFrom20dHighPct:high20?((price/high20)-1)*100:null,
    nearestResistance,nearestSupport,nearestUntakenHigh,nearestUntakenLow,
    roleReversals4h,brokenSupportRetest,brokenResistanceRetest,
    liquidity:{h4:liq4h,d1:liq1d}
  }
}
function htfRiskContext(direction,ctx,price){
  const warnings=[],critical=[];
  const av=ctx.dailyAtr||Math.max(price*.01,1e-8);
  if(direction==='LONG'){
    if(ctx.brokenSupportRetest?.active)critical.push(`4H S/R flip: kırılmış destek direnç retestinde`);
    const r=ctx.nearestResistance;
    if(r){
      const dist=r.price-price;
      if(dist>0&&dist<=av*.45)critical.push(`1D/1W direnç çok yakın (${r.timeframe})`);
      else if(dist>0&&dist<=av*1.0)warnings.push(`Yakında ${r.timeframe} direnç`);
    }
    if(Number.isFinite(ctx.extensionAtr)&&ctx.extensionAtr>=3.0)warnings.push(`Fiyat günlük EMA50'den ${ctx.extensionAtr.toFixed(1)} ATR uzakta`);
    if(ctx.nearestUntakenHigh)warnings.push('Yukarıda alınmamış likidite havuzu var');
    if(ctx.previousWeekHigh&&price<ctx.previousWeekHigh&&ctx.previousWeekHigh-price<=av*.35)warnings.push('Previous Week High yakın');
  }else{
    if(ctx.brokenResistanceRetest?.active)critical.push(`4H S/R flip: kırılmış direnç destek retestinde`);
    const s=ctx.nearestSupport;
    if(s){
      const dist=price-s.price;
      if(dist>0&&dist<=av*.45)critical.push(`1D/1W destek çok yakın (${s.timeframe})`);
      else if(dist>0&&dist<=av*1.0)warnings.push(`Yakında ${s.timeframe} destek`);
    }
    if(Number.isFinite(ctx.extensionAtr)&&ctx.extensionAtr<=-3.0)warnings.push(`Fiyat günlük EMA50'nin ${Math.abs(ctx.extensionAtr).toFixed(1)} ATR altında`);
    if(ctx.nearestUntakenLow)warnings.push('Aşağıda alınmamış likidite havuzu var');
    if(ctx.previousWeekLow&&price>ctx.previousWeekLow&&price-ctx.previousWeekLow<=av*.35)warnings.push('Previous Week Low yakın');
  }
  return{blocked:false,critical:[...new Set(critical)],warnings:[...new Set([...critical,...warnings])]}
}

function proximityGrade(distanceAtr){
 if(!Number.isFinite(distanceAtr))return'YOK';
 if(distanceAtr<=.35)return'ÇOK YAKIN';
 if(distanceAtr<=.75)return'YAKIN';
 if(distanceAtr<=1.5)return'ORTA';
 return'UZAK'
}
function levelInfo(level,close,av){
 if(!level||!Number.isFinite(Number(level.price)))return null;
 const price=Number(level.price),distance=Math.abs(price-close),distanceAtr=distance/Math.max(av,1e-12),distancePct=close?distance/close*100:null;
 return{...level,price,distance,distanceAtr:Number(distanceAtr.toFixed(2)),distancePct:Number.isFinite(distancePct)?Number(distancePct.toFixed(2)):null,proximity:proximityGrade(distanceAtr)}
}
function ema200BreakContext(c,ema200Series){
 if(!c?.length||!ema200Series?.length)return{position:'UNKNOWN',lastBreak:null};
 const i=c.length-1,e=ema200Series[i],position=!Number.isFinite(e)?'UNKNOWN':c[i].close>=e?'ABOVE':'BELOW';
 let lastBreak=null;
 for(let j=i;j>=Math.max(200,i-14);j--){
  const pe=ema200Series[j-1],ce=ema200Series[j];
  if(!Number.isFinite(pe)||!Number.isFinite(ce))continue;
  const prev=c[j-1]?.close,cur=c[j]?.close;
  if(prev<=pe&&cur>ce){lastBreak={type:'RECLAIM_UP',time:c[j].time,price:cur,ageBars:i-j};break}
  if(prev>=pe&&cur<ce){lastBreak={type:'BREAK_DOWN',time:c[j].time,price:cur,ageBars:i-j};break}
 }
 return{value:Number.isFinite(e)?e:null,position,lastBreak}
}
function frameContext(tf,c){
 if(!c?.length)return{timeframe:tf,bias:'NEUTRAL',strength:0,error:'veri yok'};
 const i=indicatorSnapshot(c),s=detectStructure(c),last=c.at(-1),close=last.close,av=i.atr||atr(c,14).at(-1)||Math.max(close*.006,1e-8);
 let long=0,short=0,reasons=[];
 if(s.trend==='UP'){long+=3;reasons.push('HH/HL trend')}else if(s.trend==='DOWN'){short+=3;reasons.push('LH/LL trend')}
 const ev=lastRecent(s.events,c,120);if(ev?.side==='UP'){long+=2;reasons.push((ev.type||'BOS')+' yukarı')}else if(ev?.side==='DOWN'){short+=2;reasons.push((ev.type||'BOS')+' aşağı')}
 if(Number.isFinite(i.ema200)){if(close>i.ema200){long+=2;reasons.push('EMA200 üstü')}else{short+=2;reasons.push('EMA200 altı')}}
 if(Number.isFinite(i.ema50)&&Number.isFinite(i.ema200)){if(i.ema50>i.ema200)long+=1;else if(i.ema50<i.ema200)short+=1}
 const sw=lastRecent(s.sweeps,c,80);if(sw?.side==='LOW')long+=1;else if(sw?.side==='HIGH')short+=1;
 const edge=Math.abs(long-short),bias=edge<2?'NEUTRAL':long>short?'LONG':'SHORT',strength=clamp(Math.round(50+edge*7),50,95);
 const lows=(s.pivots?.lows||[]).filter(x=>x.price<close).sort((a,b)=>b.price-a.price),highs=(s.pivots?.highs||[]).filter(x=>x.price>close).sort((a,b)=>a.price-b.price);
 const liq=buildLiquidityMap(c,tf),uHigh=nearestAbove(liq.untakenHighs,close),uLow=nearestBelow(liq.untakenLows,close);
 const closeSeries=c.map(x=>x.close),e200=ema(closeSeries,200),ema200=ema200BreakContext(c,e200);
 const flips=tf==='4h'?detectRoleReversalZones(c,'4h'):[];
 return{timeframe:tf,bias,strength,trend:s.trend,close,atr:av,reasons:reasons.slice(0,6),marketBreak:ev?{type:ev.type,side:ev.side,time:ev.time,price:ev.price}:null,recentSweep:sw?{side:sw.side,time:sw.time,price:sw.price}:null,ema200,support:levelInfo(lows[0],close,av),resistance:levelInfo(highs[0],close,av),liquidity:{nearestUntakenHigh:levelInfo(uHigh,close,av),nearestUntakenLow:levelInfo(uLow,close,av),untakenHighPools:liq.untakenHighs.length,untakenLowPools:liq.untakenLows.length,takenHighPools:liq.takenHighs.length,takenLowPools:liq.takenLows.length},roleReversal:flips[0]||null}
}
async function buildTopDownContext(symbol){
 const frames=[];
 for(const tf of HTF_ORDER){frames.push(frameContext(tf,await candles(symbol,tf)))}
 return{version:ANALYSIS_VERSION,order:[...HTF_ORDER],builtAt:new Date().toISOString(),frames}
}
function majorTrendDecision(ctx){
 const frames=ctx?.frames||[],map=Object.fromEntries(frames.map(x=>[x.timeframe,x]));
 let longScore=0,shortScore=0;
 for(const f of frames){
  const w=HTF_WEIGHT[f.timeframe]||1;
  if(f.bias==='LONG')longScore+=w;
  else if(f.bias==='SHORT')shortScore+=w;
  else{
   if(f.trend==='UP')longScore+=w*.35;
   else if(f.trend==='DOWN')shortScore+=w*.35;
   if(f.ema200?.position==='ABOVE')longScore+=w*.20;
   else if(f.ema200?.position==='BELOW')shortScore+=w*.20;
  }
 }
 const fallback=[map['4h'],map['1h'],map['1d'],map['1w']].find(f=>f?.bias&&f.bias!=='NEUTRAL');
 const direction=longScore===shortScore?(fallback?.bias||'LONG'):(longScore>shortScore?'LONG':'SHORT');
 const total=Math.max(longScore+shortScore,1),edge=Math.abs(longScore-shortScore);
 const conviction=clamp(Math.round(55+(edge/total)*40),55,95);
 const warnings=[],supports=[];
 const side=direction==='LONG'?'UP':'DOWN';
 for(const f of frames){
  const favorableSweep=direction==='LONG'?'LOW':'HIGH';
  if(f.recentSweep?.side===favorableSweep)supports.push(`${f.timeframe.toUpperCase()} likidite sweep ${favorableSweep}`);
  if(f.marketBreak?.side===side)supports.push(`${f.timeframe.toUpperCase()} ${f.marketBreak.type||'BOS'} ${side}`);
  const target=direction==='LONG'?f.liquidity?.nearestUntakenHigh:f.liquidity?.nearestUntakenLow;
  if(target)supports.push(`${f.timeframe.toUpperCase()} trend yönünde alınmamış likidite · ${target.distanceAtr} ATR`);
  const obstacle=direction==='LONG'?f.resistance:f.support;
  if(obstacle?.distanceAtr<=.35)warnings.push(`${f.timeframe.toUpperCase()} ${direction==='LONG'?'direnç':'destek'} çok yakın · ${obstacle.distanceAtr} ATR`);
  else if(obstacle?.distanceAtr<=.8)warnings.push(`${f.timeframe.toUpperCase()} ${direction==='LONG'?'direnç':'destek'} yakın · ${obstacle.distanceAtr} ATR`);
 }
 const arrow=f=>!f?'—':f.bias==='LONG'?'↑':f.bias==='SHORT'?'↓':'↔';
 const summary=`1W ${arrow(map['1w'])} · 1D ${arrow(map['1d'])} · 4H ${arrow(map['4h'])} · 1H ${arrow(map['1h'])}`;
 return{direction,longScore:Number(longScore.toFixed(2)),shortScore:Number(shortScore.toFixed(2)),conviction,summary,warnings:[...new Set(warnings)],supports:[...new Set(supports)]}
}
function topDownDecision(direction,ctx,price){
 const major=majorTrendDecision(ctx);
 const allowed=direction===major.direction;
 return{
  allowed,direction,majorDirection:major.direction,
  alignedScore:direction==='LONG'?major.longScore:major.shortScore,
  oppositeScore:direction==='LONG'?major.shortScore:major.longScore,
  summary:major.summary,
  blockers:allowed?[]:[`Minör yön ${direction}, majör yön ${major.direction} ile ters`],
  warnings:major.warnings,
  supports:major.supports,
  conviction:major.conviction
 }
}
function nearestMajorObstacle(ctx,direction,entry){
 const frames=ctx?.frames||[];
 const levels=[];
 for(const f of frames){
  const x=direction==='LONG'?f.resistance:f.support;
  if(!x||!Number.isFinite(Number(x.price)))continue;
  const p=Number(x.price);
  if(direction==='LONG'&&p>entry)levels.push({price:p,timeframe:f.timeframe,type:'RESISTANCE'});
  if(direction==='SHORT'&&p<entry)levels.push({price:p,timeframe:f.timeframe,type:'SUPPORT'});
 }
 if(!levels.length)return null;
 return levels.sort((a,b)=>Math.abs(a.price-entry)-Math.abs(b.price-entry))[0]
}
function buildMinorSetup(symbol,tf,c,major){
 const i=indicatorSnapshot(c),s=detectStructure(c),last=c.at(-1),entry=last.close,av=i.atr||atr(c,14).at(-1)||Math.max(entry*.004,1e-8);
 const dir=major.direction,up=dir==='LONG',ev=lastRecent(s.events,c,90),sw=lastRecent(s.sweeps,c,70);
 const liq=buildLiquidityMap(c,tf),recentFrom=c[Math.max(0,c.length-90)]?.time??0;
 const recentTaken=up
  ? (liq.takenLows||[]).filter(x=>(x.takenAt||0)>=recentFrom)
  : (liq.takenHighs||[]).filter(x=>(x.takenAt||0)>=recentFrom);
 const sweepAligned=up?sw?.side==='LOW':sw?.side==='HIGH';
 const liquidityTaken=Boolean(sweepAligned||recentTaken.length);
 const eventAligned=up?ev?.side==='UP':ev?.side==='DOWN';
 const trendAligned=up?s.trend==='UP':s.trend==='DOWN';
 const structureAligned=Boolean(trendAligned||eventAligned);
 let score=0;
 if(trendAligned)score+=2;
 if(eventAligned)score+=2;
 if(liquidityTaken)score+=2;
 if(up&&entry>i.ema50||!up&&entry<i.ema50)score+=1;
 if(up&&entry>i.ema200||!up&&entry<i.ema200)score+=1;
 if(!structureAligned||!liquidityTaken||score<5)return null;
 const lows=s.pivots?.lows?.slice(-6)||[],highs=s.pivots?.highs?.slice(-6)||[];
 let stop;
 if(up){const swing=lows.filter(x=>x.price<entry).at(-1)?.price;stop=Math.min(entry-av*.9,Number.isFinite(swing)?swing-av*.12:Infinity)}
 else{const swing=highs.filter(x=>x.price>entry).at(-1)?.price;stop=Math.max(entry+av*.9,Number.isFinite(swing)?swing+av*.12:-Infinity)}
 if(!Number.isFinite(stop)||stop===entry)stop=up?entry-av*1.1:entry+av*1.1;
 const risk=Math.max(Math.abs(entry-stop),av*.55),sgn=up?1:-1;
 let tp1=entry+sgn*risk*1.25,tp2=entry+sgn*risk*2.0,tp3=entry+sgn*risk*3.0;
 const obstacle=nearestMajorObstacle({frames:major.frames},dir,entry);
 if(obstacle){
  const room=Math.abs(obstacle.price-entry)/risk;
  if(room<.75)return null;
  if(room<3){
   const safe=entry+sgn*Math.abs(obstacle.price-entry)*.92;
   tp3=safe;
   tp2=entry+sgn*Math.min(risk*2.0,Math.abs(safe-entry)*.72);
   tp1=entry+sgn*Math.min(risk*1.25,Math.abs(safe-entry)*.45);
  }
 }
 const rr=Math.abs(tp3-entry)/risk;
 if(rr<MIN_RR)return null;
 const confidence=clamp(Math.round(62+score*3+major.conviction*.12),65,95);
 const context=paContext(s,c,i,av);
 const liquidityEvidence={
   sweep:sweepAligned&&sw?{side:sw.side,time:sw.time,price:sw.price}:null,
   recentlyTaken:recentTaken.slice(-3),
   source:sweepAligned?'SWEEP':'TAKEN_POOL'
 };
 return{symbol,timeframe:tf,price:entry,direction:dir,confidence,entry,stop,tp1,tp2,tp3,riskReward:Number(rr.toFixed(2)),indicators:i,structure:s,priceAction:context,score:{minor:score},quality:confidence>=82?'GÜÇLÜ':'SEÇİCİ',reasons:[`Majör yön ${dir}`,trendAligned?'Minör trend majör yönle uyumlu':'',eventAligned?`${ev.type} ${ev.side}`:'',sweepAligned?'Minör likidite sweep alındı':'Yakın geçmişte likidite havuzu alındı',up&&entry>i.ema200||!up&&entry<i.ema200?'EMA200 yönle uyumlu':''].filter(Boolean).slice(0,7),invalidation:up?'Stop altında minör yapının bozulması':'Stop üzerinde minör yapının bozulması',liquidityTaken:true,liquidityEvidence,majorObstacle:obstacle}
}

function fmtNum(v){
 const n=Number(v);if(!Number.isFinite(n))return'—';
 const a=Math.abs(n);const d=a>=1000?1:a>=100?2:a>=1?4:a>=.1?5:7;
 return n.toFixed(d).replace(/0+$/,'').replace(/\.$/,'')
}
function dirLabel(v){return v==='LONG'?'↑ LONG':v==='SHORT'?'↓ SHORT':'↔ NÖTR'}
function topDownCommentary(setup){
 const td=setup?.topDownContext,d=td?.decision,lower=setup?.lowerFrameContext,le=setup?.liquidityEvidence||{};
 if(!d)return `${setup.symbol} ${setup.timeframe}: majör/minör bağlam verisi yok; sinyal üretilmemeliydi.`;
 const major=`Majör yön ${d.majorDirection||setup.direction} · ${d.summary} · güç %${d.conviction??'—'}`;
 const ema=(td.frames||[]).map(f=>`${String(f.timeframe||'').toUpperCase()} EMA200 ${f.ema200?.position==='ABOVE'?'üstü':f.ema200?.position==='BELOW'?'altı':'nötr'}`).join(' · ');
 const ev=lower?.marketBreak?`${lower.marketBreak.type} ${lower.marketBreak.side} @ ${fmtNum(lower.marketBreak.price)}`:'kırılım yok';
 const sweep=le.sweep?`${le.sweep.side} sweep @ ${fmtNum(le.sweep.price)}`:(le.recentlyTaken?.length?`${le.recentlyTaken.length} yakın likidite havuzu alınmış`:'likidite teyidi yok');
 const minor=`${String(setup.timeframe||'').toUpperCase()} minör trend ${lower?.trend||setup?.priceAction?.trend||'RANGE'} · ${ev} · ${sweep}`;
 const obstacle=setup?.majorObstacle?`Ön bölge: ${String(setup.majorObstacle.timeframe||'').toUpperCase()} ${setup.majorObstacle.type} @ ${fmtNum(setup.majorObstacle.price)}.`:'';
 const warn=(d.warnings||[]).slice(0,2).join('; ');
 return `${major}. ${ema}. ${minor}. ${obstacle}${warn?` Risk: ${warn}.`:''}`.replace(/\s+/g,' ').trim()
}

function paContext(s,c,i,av){const last=c.at(-1),event=lastRecent(s.events,c,90),sweep=lastRecent(s.sweeps,c,70),ob=(s.orderBlocks||[]).at(-1)||null,fvg=(s.fvgs||[]).at(-1)||null;return{trend:s.trend,lastEvent:event?{type:event.type,side:event.side,price:event.price,time:event.time}:null,lastSweep:sweep?{side:sweep.side,price:sweep.price,time:sweep.time}:null,lastOrderBlock:ob,lastFvg:fvg,lastCandle:{open:last.open,high:last.high,low:last.low,close:last.close,volume:last.volume},atr:av,ema9:i.ema9,ema50:i.ema50,ema200:i.ema200,rsi:i.rsi,macdHist:i.macdHist}}
function analyzeSingle(symbol,tf,c){
 const minBars=tf==='1M'?72:tf==='1w'?100:tf==='3d'?140:180;if(c.length<minBars)return waitResult(symbol,tf,c.at(-1)?.close??null,0,['Yeterli mum yok'],`Bu zaman diliminde en az ${minBars} mum gerekli`);
 const i=indicatorSnapshot(c),s=detectStructure(c),last=c.at(-1),close=last.close,av=i.atr||atr(c,14).at(-1)||Math.max(close*.004,1e-8);let long=0,short=0,reasons=[];
 if(close>i.ema9){long+=.75;reasons.push('Fiyat EMA9 üzerinde')}else if(close<i.ema9){short+=.75;reasons.push('Fiyat EMA9 altında')}
 if(c.length>=200&&i.ema9>i.ema50&&i.ema50>i.ema200){long+=2.25;reasons.push('EMA dizilimi yükseliş')}else if(c.length>=200&&i.ema9<i.ema50&&i.ema50<i.ema200){short+=2.25;reasons.push('EMA dizilimi düşüş')}else if(i.ema9>i.ema50){long+=1.35;reasons.push('EMA9/50 yükseliş')}else if(i.ema9<i.ema50){short+=1.35;reasons.push('EMA9/50 düşüş')}
 if(i.rsi!=null){if(i.rsi>=52&&i.rsi<=72)long+=.6;if(i.rsi<=48&&i.rsi>=28)short+=.6}
 if(i.macdHist!=null){if(i.macdHist>0)long+=.55;else if(i.macdHist<0)short+=.55}
 if(s.trend==='UP'){long+=2.25;reasons.push('Price action HH/HL')}else if(s.trend==='DOWN'){short+=2.25;reasons.push('Price action LH/LL')}
 const ev=lastRecent(s.events,c,90);if(ev?.side==='UP'){long+=ev.type==='CHoCH'?2.1:1.6;reasons.push(`${ev.type} yukarı kırılım`)}else if(ev?.side==='DOWN'){short+=ev.type==='CHoCH'?2.1:1.6;reasons.push(`${ev.type} aşağı kırılım`)}
 const sw=lastRecent(s.sweeps,c,70);if(sw?.side==='LOW'){long+=1.8;reasons.push('Aşağı likidite sweep')}else if(sw?.side==='HIGH'){short+=1.8;reasons.push('Yukarı likidite sweep')}
 const ob=(s.orderBlocks||[]).at(-1);if(ob){const mid=(ob.low+ob.high)/2,near=Math.abs(close-mid)<=av*1.8;if(near&&ob.side==='BULL'){long+=1.0;reasons.push('Bullish OB yakınlığı')}if(near&&ob.side==='BEAR'){short+=1.0;reasons.push('Bearish OB yakınlığı')}}
 const fvg=(s.fvgs||[]).at(-1);if(fvg){const mid=(fvg.from+fvg.to)/2,near=Math.abs(close-mid)<=av*2.2;if(near&&fvg.side==='BULL')long+=.65;if(near&&fvg.side==='BEAR')short+=.65}
 const body=Math.abs(last.close-last.open),range=Math.max(last.high-last.low,1e-12),disp=body/Math.max(av,1e-12);if(disp>.55){if(last.close>last.open){long+=.8;reasons.push('Yukarı displacement')}else if(last.close<last.open){short+=.8;reasons.push('Aşağı displacement')}}
 const closePos=(last.close-last.low)/range;if(closePos>.72)long+=.35;else if(closePos<.28)short+=.35;
 const winner=Math.max(long,short),edge=Math.abs(long-short),direction=winner<5.8||edge<2.8?'WAIT':long>short?'LONG':'SHORT',confidence=direction==='WAIT'?clamp(Math.round(44+edge*4),45,68):clamp(Math.round(56+winner*3.2+edge*2.4),60,94),context=paContext(s,c,i,av);
 if(direction==='WAIT')return waitResult(symbol,tf,close,confidence,reasons,'Price action teyitleri aynı yönde yeterince birleşmedi',{indicators:i,structure:s,priceAction:context,score:{long:Number(long.toFixed(2)),short:Number(short.toFixed(2))}});
 const lows=s.pivots?.lows?.slice(-4)||[],highs=s.pivots?.highs?.slice(-4)||[];let stop;if(direction==='LONG'){const swing=lows.filter(x=>x.price<close).at(-1)?.price;stop=Math.min(close-av*1.05,Number.isFinite(swing)?swing-av*.18:Infinity)}else{const swing=highs.filter(x=>x.price>close).at(-1)?.price;stop=Math.max(close+av*1.05,Number.isFinite(swing)?swing+av*.18:-Infinity)}
 if(!Number.isFinite(stop)||stop===close)stop=direction==='LONG'?close-av*1.25:close+av*1.25;const entry=close,risk=Math.max(Math.abs(entry-stop),av*.65),sgn=direction==='LONG'?1:-1,tp1=entry+sgn*risk*1.35,tp2=entry+sgn*risk*2.05,tp3=entry+sgn*risk*3.0,rr=3.0,quality=confidence>=82&&edge>=4.2?'GÜÇLÜ':'SEÇİCİ';
 return{symbol,timeframe:tf,price:close,direction,confidence,entry,stop,tp1,tp2,tp3,riskReward:rr,indicators:i,structure:s,reasons:[...new Set(reasons)].slice(0,7),invalidation:direction==='LONG'?'Stop altında kapanış veya son HL/price-action yapısının kaybı':'Stop üzerinde kapanış veya son LH/price-action yapısının kaybı',quality,priceAction:context,score:{long:Number(long.toFixed(2)),short:Number(short.toFixed(2))}}
}

const cache=new Map();
function loadSignalState(){
  let state;
  try{state=JSON.parse(fs.readFileSync(STATE_PATH,'utf8'))}catch{state={}}
  state.version=4;
  state.signals=state.signals||{};
  state.activeSignals=state.activeSignals||{};
  state.history=Array.isArray(state.history)?state.history:[];
  return state
}
function saveSignalState(state){fs.mkdirSync('.github/state',{recursive:true});fs.writeFileSync(STATE_PATH,JSON.stringify(state,null,2)+'\n')}
function structuralFingerprint(setup){
 const lower=setup?.lowerFrameContext||{},pa=setup?.priceAction||{},d=setup?.topDownContext?.decision||{};
 return [
  setup.symbol,'futures',setup.timeframe,setup.direction,d.majorDirection||setup.direction,
  lower.trend||pa.trend||'RANGE',
  lower.marketBreak?.type||pa.lastEvent?.type||'',
  lower.marketBreak?.side||pa.lastEvent?.side||'',
  lower.marketBreak?.time||pa.lastEvent?.time||0,
  setup?.liquidityEvidence?.sweep?.side||'',
  setup?.liquidityEvidence?.sweep?.time||0
 ].join('|')
}
function duplicateReason(state,setup){
  const tf=String(setup.timeframe||'15m').toLowerCase(),now=Date.now();
  const active=Object.values(state.activeSignals||{}).find(x=>
    x?.symbol===setup.symbol &&
    String(x.timeframe||'15m').toLowerCase()===tf &&
    !['TP3','STOP','EXPIRED','AMBIGUOUS'].includes(x.status)
  );
  if(active)return 'aynı timeframe aktif sinyal var';

  const fp=structuralFingerprint(setup);
  const recentClosed=(state.history||[])
    .filter(x=>x?.symbol===setup.symbol&&String(x.timeframe||'15m').toLowerCase()===tf&&x.direction===setup.direction)
    .sort((a,b)=>(Date.parse(b.closedAt||0)||0)-(Date.parse(a.closedAt||0)||0))[0];
  if(recentClosed){
    const closedAt=Date.parse(recentClosed.closedAt||0),age=Number.isFinite(closedAt)?now-closedAt:Infinity;
    if(age<terminalReentryMs(tf))return 'terminal sonrası yeniden giriş bekleme süresi';
    const oldFp=recentClosed.fingerprint||recentClosed.structureKey||'';
    if(oldFp===fp&&age<dupTtlMs(tf))return 'aynı yapı terminal sonrası tekrar etti';
  }

  const keyed=state.signals?.[signalStateKey(setup.symbol,tf)];
  const legacy=Object.values(state.signals||{})
    .filter(x=>x?.symbol===setup.symbol&&String(x.timeframe||'15m').toLowerCase()===tf)
    .sort((a,b)=>(Date.parse(b.sentAt||0)||0)-(Date.parse(a.sentAt||0)||0))[0];
  const prev=keyed||legacy;
  if(!prev)return null;
  const sentAt=Date.parse(prev.sentAt||0),age=Number.isFinite(sentAt)?now-sentAt:Infinity;
  if(age<cooldownMs(tf))return 'timeframe cooldown';
  if((prev.fingerprint||prev.structureKey)===fp&&age<dupTtlMs(tf))return 'aynı yapısal setup';
  return null
}

function rememberSignal(state,setup,telegramResult,analysisMeta={}){
  state.version=4;state.signals=state.signals||{};state.activeSignals=state.activeSignals||{};state.history=Array.isArray(state.history)?state.history:[];
  const sentAt=new Date().toISOString(),fingerprint=structuralFingerprint(setup);
  const base={fingerprint,structureKey:fingerprint,signalId:setup.signalId,symbol:setup.symbol,market:'futures',timeframe:setup.timeframe,direction:setup.direction,confidence:setup.confidence,riskReward:setup.riskReward,sentAt,entry:setup.entry,stop:setup.stop,tp1:setup.tp1,tp2:setup.tp2,tp3:setup.tp3,messageId:telegramResult?.messageId??null,analysisVersion:ANALYSIS_VERSION,topDownContext:setup.topDownContext||null,lowerFrameContext:setup.lowerFrameContext||null,liquidityEvidence:setup.liquidityEvidence||null,majorObstacle:setup.majorObstacle||null,commentary:String(analysisMeta.commentary||''),commentaryProvider:String(analysisMeta.provider||''),contextSnapshot:setup.htfContext?{previousDayHigh:setup.htfContext.previousDayHigh,previousDayLow:setup.htfContext.previousDayLow,previousWeekHigh:setup.htfContext.previousWeekHigh,previousWeekLow:setup.htfContext.previousWeekLow,dailyAtr:setup.htfContext.dailyAtr,dailyEma50:setup.htfContext.dailyEma50,extensionAtr:setup.htfContext.extensionAtr,riseFrom20dLowPct:setup.htfContext.riseFrom20dLowPct,fallFrom20dHighPct:setup.htfContext.fallFrom20dHighPct,nearestResistance:setup.htfContext.nearestResistance,nearestSupport:setup.htfContext.nearestSupport,nearestUntakenHigh:setup.htfContext.nearestUntakenHigh,nearestUntakenLow:setup.htfContext.nearestUntakenLow,brokenSupportRetest:setup.htfContext.brokenSupportRetest,brokenResistanceRetest:setup.htfContext.brokenResistanceRetest,decision:setup.liquidityContext?.decision||null}:null};
  state.signals[signalStateKey(setup.symbol,setup.timeframe)]=base;
  state.activeSignals[setup.signalId]={...base,status:'WAIT_ENTRY',stage:0,enteredAt:null,lastCheckedAt:sentAt,notified:{entry:false,tp1:false,tp2:false,tp3:false,stop:false,ambiguous:false}};
  for(const [k,v] of Object.entries(state.signals)){const t=Date.parse(v?.sentAt||0);if(!Number.isFinite(t)||Date.now()-t>7*24*60*60*1000)delete state.signals[k]}
  saveSignalState(state)
}
const signalState=loadSignalState();
async function candles(symbol,tf){const key=`${symbol}|${tf}`;if(cache.has(key))return cache.get(key);const u=`${FUTURES}/fapi/v1/klines?symbol=${symbol}&interval=${tf}&limit=500`;const r=await fetch(u);if(!r.ok)throw new Error(`${symbol} ${tf} Binance HTTP ${r.status}`);const d=await r.json();const rows=d.map(k=>({time:Number(k[0]),openTime:Number(k[0]),open:Number(k[1]),high:Number(k[2]),low:Number(k[3]),close:Number(k[4]),volume:Number(k[5]),closeTime:Number(k[6])})).filter(x=>x.closeTime<Date.now()-500);cache.set(key,rows);return rows}

function activeSignalForSymbol(state,symbol,timeframe){
  const tf=String(timeframe||'15m').toLowerCase();
  return Object.values(state.activeSignals||{}).find(x=>
    x?.symbol===symbol &&
    String(x.timeframe||'15m').toLowerCase()===tf &&
    !['TP3','STOP','EXPIRED','AMBIGUOUS'].includes(x.status)
  )||null
}
async function shadowReanalysis(active){
  active.reanalysis=active.reanalysis||{max:REANALYSIS_MAX,snapshots:[],lastCandleCloseTime:0};
  active.reanalysis.snapshots=Array.isArray(active.reanalysis.snapshots)?active.reanalysis.snapshots:[];
  if(active.reanalysis.snapshots.length>=REANALYSIS_MAX)return false;

  const baseTf=String(active.timeframe||'15m').toLowerCase();
  const base=await candles(active.symbol,baseTf);
  if(base.length<180)return false;
  const last=base.at(-1),sentAt=Date.parse(active.sentAt||0);
  if(!last?.closeTime||last.closeTime<=sentAt||last.closeTime<=Number(active.reanalysis.lastCandleCloseTime||0))return false;

  const topDown=await buildTopDownContext(active.symbol),majorCore=majorTrendDecision(topDown),major={...majorCore,frames:topDown.frames};
  const current=buildMinorSetup(active.symbol,baseTf,base,major);
  const sameMajor=majorCore.direction===active.direction;
  let verdict='BEKLE';
  if(!sameMajor)verdict='TERS_MAJOR';
  else if(current?.direction===active.direction)verdict='AYNI_YON';
  else verdict='BEKLE';

  const lower=frameContext(baseTf,base);
  const snap={
    no:active.reanalysis.snapshots.length+1,
    checkedAt:new Date().toISOString(),
    candleCloseTime:last.closeTime,
    price:last.close,
    originalDirection:active.direction,
    majorDirection:majorCore.direction,
    majorConviction:majorCore.conviction,
    currentDirection:current?.direction||'WAIT',
    currentConfidence:current?.confidence??null,
    lowerTrend:lower.trend,
    lowerMarketBreak:lower.marketBreak||null,
    lowerSweep:lower.recentSweep||null,
    verdict,
    commentary:`${active.symbol} ${baseTf} yeniden kontrol: majör ${majorCore.direction} · minör ${current?.direction||'WAIT'} · ${majorCore.summary}.`
  };
  active.reanalysis.snapshots.push(snap);
  active.reanalysis.lastCandleCloseTime=last.closeTime;
  active.reanalysis.summary={
    same:active.reanalysis.snapshots.filter(x=>x.verdict==='AYNI_YON').length,
    wait:active.reanalysis.snapshots.filter(x=>x.verdict==='BEKLE').length,
    opposite:active.reanalysis.snapshots.filter(x=>x.verdict==='TERS_MAJOR').length,
    total:active.reanalysis.snapshots.length
  };
  signalState.activeSignals[active.signalId]=active;
  saveSignalState(signalState);
  console.log(active.symbol,'MAJOR-MINOR YENİDEN ANALİZ',snap.no+'/'+REANALYSIS_MAX,verdict,{major:majorCore.direction,minor:current?.direction||'WAIT'});
  return true
}

function canonicalAnalysis(setup){
 return{provider:'ŞAOMİ RC5.26 MAJOR-MINOR',commentary:topDownCommentary(setup)}
}

async function telegram(setup,commentary,provider){const r=await fetch(`${BASE}/api/telegram`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({setup,commentary,provider,riskReward:setup.riskReward,mode:'github-pa-v1',signalId:setup.signalId})});const j=await r.json().catch(()=>({}));if(!r.ok||!j.ok)throw new Error(j.error||`Telegram HTTP ${r.status}`);return j}

async function buildSetup(symbol,baseTf,topDown){
 const baseCandles=await candles(symbol,baseTf);if(baseCandles.length<200)return null;const last=baseCandles.at(-1),age=Date.now()-last.closeTime;if(age>12*60*1000)return null;
 const majorCore=majorTrendDecision(topDown);
 const major={...majorCore,frames:topDown.frames};
 const current=buildMinorSetup(symbol,baseTf,baseCandles,major);
 if(!current)return null;
 const previousCandles=baseCandles.slice(0,-1),previous=buildMinorSetup(symbol,baseTf,previousCandles,major);
 const eventAligned=current.priceAction?.lastEvent?.side===(current.direction==='LONG'?'UP':'DOWN');
 const sweepAligned=current.priceAction?.lastSweep?.side===(current.direction==='LONG'?'LOW':'HIGH');
 if(!previous&&!(eventAligned||sweepAligned))return null;
 const lowerFrameContext=frameContext(baseTf,baseCandles),topDecision=topDownDecision(current.direction,topDown,current.price);
 if(!topDecision.allowed){console.log(symbol,baseTf,'MAJÖR/MİNÖR TERS',topDecision.blockers);return null}
 const wantedConfirm=confirmFrames(baseTf),frames=[current];for(const tf of wantedConfirm){const cc=await candles(symbol,tf);frames.push(analyzeSingle(symbol,tf,cc))}
 const confirm=frames.slice(1),aligned=confirm.filter(x=>x.direction===current.direction).length,opposite=confirm.filter(x=>x.direction!=='WAIT'&&x.direction!==current.direction).length,available=confirm.filter(x=>x.direction!=='WAIT').length,agreement=available?aligned/available:0;
 const htfContext=await buildHtfContext(symbol,current.price);
 const htfDecision=htfRiskContext(current.direction,htfContext,current.price);
 const baseLiquidity=buildLiquidityMap(baseCandles,baseTf);
 let confidence=clamp(current.confidence+aligned*2-opposite*2-(topDecision.warnings.length?1:0),60,95);
 if(confidence<MIN_CONFIDENCE)return null;
 const ev=current.priceAction?.lastEvent?.time||0,sw=current.priceAction?.lastSweep?.time||0,ob=current.priceAction?.lastOrderBlock?.time||0,fvg=current.priceAction?.lastFvg?.time||0,signalId=`${symbol}|futures|${baseTf}|${current.direction}|${ev}|${sw}|${ob}|${fvg}`;
 return{...current,market:'futures',timeframe:baseTf,confidence,quality:confidence>=82?'GÜÇLÜ':'SEÇİCİ',locked:true,lockedAt:last.time,candleCloseTime:last.closeTime,multiTimeframe:frames,agreement,mtf:{frames:[baseTf,...wantedConfirm],aligned,opposite,available,status:'MAJOR_MINOR'},htfContext,liquidityContext:{base:baseLiquidity,decision:htfDecision},topDownContext:{...topDown,decision:topDecision,major:majorCore},lowerFrameContext,analysisVersion:ANALYSIS_VERSION,signalId,reasons:[`MAJÖR ${majorCore.direction}: ${majorCore.summary}`,...(current.reasons||[]),...(topDecision.supports||[]).slice(0,2),...(topDecision.warnings||[]).slice(0,2)].slice(0,10)}
}

let sent=0;console.log(`ŞAOMİ ${ANALYSIS_VERSION} taraması: ${new Date().toISOString()} · Sinyal TF=${BASE_TFS.join(',')} · HTF=${HTF_ORDER.join('→')}`);
scanLoop:
for(const symbol of SYMBOLS){
 try{
  const topDown=await buildTopDownContext(symbol);
  const major=majorTrendDecision(topDown); console.log(symbol,'MAJÖR YÖN',major.direction,major.summary,'güç',major.conviction);
  for(const baseTf of BASE_TFS){
   try{
    const active=activeSignalForSymbol(signalState,symbol,baseTf);
    if(active){
      await shadowReanalysis(active);
      console.log(symbol,baseTf,'AKTİF SİNYAL VAR · aynı timeframe için yeni işlem üretilmedi');
      continue;
    }
    const setup=await buildSetup(symbol,baseTf,topDown);
    if(!setup){console.log(symbol,baseTf,'BEKLE / filtre dışı');continue}
    const dup=duplicateReason(signalState,setup);
    if(dup){console.log(symbol,baseTf,`TEKRAR GÖNDERİLMEDİ (${dup})`,{signalId:setup.signalId});continue}
    console.log(symbol,baseTf,{direction:setup.direction,confidence:setup.confidence,rr:setup.riskReward,htf:setup.topDownContext.decision.summary});
    const g=canonicalAnalysis(setup);
    const t=await telegram(setup,g.commentary,g.provider);
    rememberSignal(signalState,setup,t,g);
    sent++;
    console.log(`GÖNDERİLDİ ${symbol} ${baseTf}`,t);
    if(sent>=MAX_SIGNALS){console.log('Bu tur maksimum güçlü sinyal sayısına ulaşıldı.');break scanLoop}
   }catch(e){console.error(`HATA ${symbol} ${baseTf}:`,e?.message||e)}
  }
 }catch(e){console.error(`HTF HATA ${symbol}:`,e?.message||e)}
}
console.log(`ŞAOMİ ${ANALYSIS_VERSION} bitti. Gönderilen: ${sent}`);
