import fs from 'node:fs';
const BASE = 'https://saomi-trade-ai.vercel.app';
const FUTURES = 'https://www.binance.com';
const SYMBOLS = ['BTCUSDT','ETHUSDT','XRPUSDT','SOLUSDT','BNBUSDT','DOGEUSDT','ADAUSDT'];
const BASE_TF = '15m';
const CONFIRM_TFS = ['1h','4h'];
const MIN_CONFIDENCE = 84;
const MIN_RR = 2.5;
const MAX_SIGNALS = 3;
const STATE_PATH = '.github/state/saomi-telegram-state.json';
const DUP_TTL_MS = 12*60*60*1000;
const SYMBOL_COOLDOWN_MS = 30*60*1000;
const REANALYSIS_MAX = 3;

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
    liquidity:{h4:liq4h,d1:liq1d}
  }
}
function htfContextDecision(direction,ctx,price){
  const reasons=[],warnings=[];let blocked=false;
  const av=ctx.dailyAtr||Math.max(price*.01,1e-8);
  if(direction==='LONG'){
    const r=ctx.nearestResistance;
    if(r){
      const dist=r.price-price;
      if(dist>0&&dist<=av*.45){blocked=true;reasons.push(`1D/1W direnç çok yakın (${r.timeframe})`)}
      else if(dist>0&&dist<=av*1.0)warnings.push(`Yakında ${r.timeframe} direnç`);
    }
    if(Number.isFinite(ctx.extensionAtr)&&ctx.extensionAtr>=3.0){
      warnings.push(`Fiyat günlük EMA50'den ${ctx.extensionAtr.toFixed(1)} ATR uzakta`);
      if(r&&r.price-price<=av*1.0){blocked=true;reasons.push('Aşırı yükselmiş + HTF direnç kombinasyonu')}
    }
    if(ctx.nearestUntakenHigh)warnings.push('Yukarıda alınmamış likidite havuzu var');
    if(ctx.previousWeekHigh&&price<ctx.previousWeekHigh&&ctx.previousWeekHigh-price<=av*.35)warnings.push('Previous Week High yakın');
  }else if(direction==='SHORT'){
    const s=ctx.nearestSupport;
    if(s){
      const dist=price-s.price;
      if(dist>0&&dist<=av*.45){blocked=true;reasons.push(`1D/1W destek çok yakın (${s.timeframe})`)}
      else if(dist>0&&dist<=av*1.0)warnings.push(`Yakında ${s.timeframe} destek`);
    }
    if(Number.isFinite(ctx.extensionAtr)&&ctx.extensionAtr<=-3.0){
      warnings.push(`Fiyat günlük EMA50'nin ${Math.abs(ctx.extensionAtr).toFixed(1)} ATR altında`);
      if(s&&price-s.price<=av*1.0){blocked=true;reasons.push('Aşırı düşmüş + HTF destek kombinasyonu')}
    }
    if(ctx.nearestUntakenLow)warnings.push('Aşağıda alınmamış likidite havuzu var');
    if(ctx.previousWeekLow&&price>ctx.previousWeekLow&&price-ctx.previousWeekLow<=av*.35)warnings.push('Previous Week Low yakın');
  }
  return{blocked,reasons,warnings}
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
function isStableSetupPair(current,previous){if(!current||!previous||current.direction==='WAIT'||previous.direction!==current.direction)return false;const edge=Math.abs((current.score?.long||0)-(current.score?.short||0)),prevEdge=Math.abs((previous.score?.long||0)-(previous.score?.short||0));return(current.confidence||0)>=80&&(previous.confidence||0)>=76&&edge>=4.0&&prevEdge>=3.2&&(current.riskReward||0)>=2.5}

const cache=new Map();
function loadSignalState(){
  let state;
  try{state=JSON.parse(fs.readFileSync(STATE_PATH,'utf8'))}catch{state={}}
  state.version=2;
  state.signals=state.signals||{};
  state.activeSignals=state.activeSignals||{};
  state.history=Array.isArray(state.history)?state.history:[];
  return state
}
function saveSignalState(state){fs.mkdirSync('.github/state',{recursive:true});fs.writeFileSync(STATE_PATH,JSON.stringify(state,null,2)+'\n')}
function structuralFingerprint(setup){const pa=setup?.priceAction||{};return [setup.symbol,'futures',setup.timeframe,setup.direction,pa.lastEvent?.type||'',pa.lastEvent?.side||'',pa.lastEvent?.time||0,pa.lastSweep?.side||'',pa.lastSweep?.time||0,pa.lastOrderBlock?.time||0,pa.lastFvg?.time||0].join('|')}
function duplicateReason(state,setup){
  const active=Object.values(state.activeSignals||{}).find(x=>x?.symbol===setup.symbol&&!['TP3','STOP','EXPIRED','AMBIGUOUS'].includes(x.status));
  if(active)return 'aktif sinyal var';
  const prev=state.signals?.[setup.symbol];
  if(!prev)return null;
  const sentAt=Date.parse(prev.sentAt||0),age=Number.isFinite(sentAt)?Date.now()-sentAt:Infinity;
  if(age<SYMBOL_COOLDOWN_MS)return 'sembol cooldown';
  const fp=structuralFingerprint(setup);
  if(prev.fingerprint===fp&&age<DUP_TTL_MS)return 'aynı yapısal setup';
  return null
}
function rememberSignal(state,setup,telegramResult){
  state.version=2;state.signals=state.signals||{};state.activeSignals=state.activeSignals||{};state.history=Array.isArray(state.history)?state.history:[];
  const sentAt=new Date().toISOString(),fingerprint=structuralFingerprint(setup);
  const base={fingerprint,signalId:setup.signalId,symbol:setup.symbol,market:'futures',timeframe:setup.timeframe,direction:setup.direction,confidence:setup.confidence,riskReward:setup.riskReward,sentAt,entry:setup.entry,stop:setup.stop,tp1:setup.tp1,tp2:setup.tp2,tp3:setup.tp3,messageId:telegramResult?.messageId??null};
  state.signals[setup.symbol]=base;
  state.activeSignals[setup.signalId]={...base,status:'WAIT_ENTRY',stage:0,enteredAt:null,lastCheckedAt:sentAt,notified:{entry:false,tp1:false,tp2:false,tp3:false,stop:false,ambiguous:false}};
  for(const [k,v] of Object.entries(state.signals)){const t=Date.parse(v?.sentAt||0);if(!Number.isFinite(t)||Date.now()-t>7*24*60*60*1000)delete state.signals[k]}
  saveSignalState(state)
}
const signalState=loadSignalState();
async function candles(symbol,tf){const key=`${symbol}|${tf}`;if(cache.has(key))return cache.get(key);const u=`${FUTURES}/fapi/v1/klines?symbol=${symbol}&interval=${tf}&limit=500`;const r=await fetch(u);if(!r.ok)throw new Error(`${symbol} ${tf} Binance HTTP ${r.status}`);const d=await r.json();const rows=d.map(k=>({time:Number(k[0]),openTime:Number(k[0]),open:Number(k[1]),high:Number(k[2]),low:Number(k[3]),close:Number(k[4]),volume:Number(k[5]),closeTime:Number(k[6])})).filter(x=>x.closeTime<Date.now()-500);cache.set(key,rows);return rows}

function activeSignalForSymbol(state,symbol){
  return Object.values(state.activeSignals||{}).find(x=>x?.symbol===symbol&&!['TP3','STOP','EXPIRED','AMBIGUOUS'].includes(x.status))||null
}
async function geminiRecheck(active,current,frames,verdict){
  const payload={
    analysisProfile:'PRICE_ACTION_RECHECK',
    symbol:active.symbol,market:'futures',timeframe:active.timeframe||BASE_TF,
    originalDirection:active.direction,originalEntry:active.entry,originalStop:active.stop,
    originalTp1:active.tp1,originalTp2:active.tp2,originalTp3:active.tp3,
    currentDirection:current.direction,currentConfidence:current.confidence,currentScore:current.score,
    currentPrice:current.price,currentReasons:current.reasons,currentPriceAction:current.priceAction,
    multiTimeframe:frames.map(x=>({timeframe:x.timeframe,direction:x.direction,confidence:x.confidence,score:x.score})),
    verdict,
    request:'Bu mevcut sinyalin yeniden kontrolüdür. Yeni giriş/stop/hedef üretme. Orijinal seviyeleri değiştirme. Yalnız setup aynı yönde güçlü mü, zayıfladı mı, ters mi dönüyor kısa Türkçe değerlendir.'
  };
  try{
    const r=await fetch(`${BASE}/api/ai`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)});
    const j=await r.json().catch(()=>({}));
    if(!r.ok)return{ok:false,error:`HTTP ${r.status}`};
    return{ok:/gemini/i.test(String(j.provider||'')),provider:j.provider||'',commentary:String(j.commentary||'').trim().slice(0,600)}
  }catch(e){return{ok:false,error:e?.message||String(e)}}
}
async function shadowReanalysis(active){
  active.reanalysis=active.reanalysis||{max:REANALYSIS_MAX,snapshots:[],lastCandleCloseTime:0};
  active.reanalysis.snapshots=Array.isArray(active.reanalysis.snapshots)?active.reanalysis.snapshots:[];
  if(active.reanalysis.snapshots.length>=REANALYSIS_MAX)return false;

  const base=await candles(active.symbol,BASE_TF);
  if(base.length<180)return false;
  const last=base.at(-1);
  const sentAt=Date.parse(active.sentAt||0);
  if(!last?.closeTime||last.closeTime<=sentAt||last.closeTime<=Number(active.reanalysis.lastCandleCloseTime||0))return false;

  const current=analyzeSingle(active.symbol,BASE_TF,base);
  const frames=[current];
  for(const tf of CONFIRM_TFS){frames.push(analyzeSingle(active.symbol,tf,await candles(active.symbol,tf)))}
  const mtf=frames.slice(1);
  const mtfAligned=mtf.filter(x=>x.direction===active.direction).length;
  const mtfOpposite=mtf.filter(x=>x.direction!=='WAIT'&&x.direction!==active.direction).length;
  let verdict='BEKLE';
  if(current.direction===active.direction&&mtfOpposite===0)verdict='AYNI_YON';
  else if(current.direction===active.direction)verdict='AYNI_YON_MTF_ZAYIF';
  else if(current.direction!=='WAIT'&&current.direction!==active.direction)verdict='TERS';

  const ai=await geminiRecheck(active,current,frames,verdict);
  const snap={
    no:active.reanalysis.snapshots.length+1,
    checkedAt:new Date().toISOString(),
    candleCloseTime:last.closeTime,
    price:current.price,
    originalDirection:active.direction,
    currentDirection:current.direction,
    currentConfidence:current.confidence,
    score:current.score,
    mtf:mtf.map(x=>({timeframe:x.timeframe,direction:x.direction,confidence:x.confidence})),
    mtfAligned,mtfOpposite,verdict,
    gemini:ai
  };
  active.reanalysis.snapshots.push(snap);
  active.reanalysis.lastCandleCloseTime=last.closeTime;
  active.reanalysis.summary={
    same:active.reanalysis.snapshots.filter(x=>x.verdict==='AYNI_YON'||x.verdict==='AYNI_YON_MTF_ZAYIF').length,
    wait:active.reanalysis.snapshots.filter(x=>x.verdict==='BEKLE').length,
    opposite:active.reanalysis.snapshots.filter(x=>x.verdict==='TERS').length,
    total:active.reanalysis.snapshots.length
  };
  signalState.activeSignals[active.signalId]=active;
  saveSignalState(signalState);
  console.log(active.symbol,'GÖLGE YENİDEN ANALİZ',snap.no+'/'+REANALYSIS_MAX,verdict,{direction:current.direction,confidence:current.confidence,mtf:mtf.map(x=>x.direction)});
  return true
}

function validAiText(text,a){if(typeof text!=='string'||text.trim().length<20)return false;const t=text.toLowerCase();if(/\bagreement\b|\bis\s+(long|short)\b|\*\s*agreement|```|json|use exact|standard formatting|without invent|system prompt|instruction|prompt:/i.test(t))return false;if((t.match(/\b(the|and|with|without|should|must|use|exact|numbers)\b/g)||[]).length>5)return false;if(a.direction==='LONG'&&/\bshort\b/.test(t)&&!/short\s+değil|short\s+değildir/.test(t))return false;if(a.direction==='SHORT'&&/\blong\b/.test(t)&&!/long\s+değil|long\s+değildir/.test(t))return false;return true}
function aiPayload(a){return{analysisProfile:'PRICE_ACTION_CONFIRMATION',symbol:a.symbol,market:'futures',timeframe:a.timeframe,direction:a.direction,confidence:a.confidence,quality:a.quality,price:a.price,entry:a.entry,stop:a.stop,tp1:a.tp1,tp2:a.tp2,tp3:a.tp3,riskReward:a.riskReward,reasons:a.reasons,invalidation:a.invalidation,score:a.score,priceAction:a.priceAction,htfContext:a.htfContext,liquidityContext:a.liquidityContext,multiTimeframe:(a.multiTimeframe||[]).map(x=>({timeframe:x.timeframe,direction:x.direction,confidence:x.confidence,quality:x.quality,score:x.score,reasons:(x.reasons||[]).slice(0,4),priceAction:x.priceAction?{trend:x.priceAction.trend,lastEvent:x.priceAction.lastEvent,lastSweep:x.priceAction.lastSweep}:null})),mtf:a.mtf,agreement:a.agreement,request:'Türkçe price action değerlendirmesi: setup güçlü mü, hangi teyitler var, hangi risk/geçersizlik şartı kritik; sayı uydurma ve teknik seviyeleri değiştirme.'}}
async function gemini(setup){const r=await fetch(`${BASE}/api/ai`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(aiPayload(setup))});if(!r.ok)throw new Error(`Gemini HTTP ${r.status}`);const j=await r.json();const commentary=String(j.commentary||'').trim(),provider=String(j.provider||'');if(!/gemini/i.test(provider))throw new Error(`Gemini provider doğrulanmadı: ${provider||'boş'}`);if(!validAiText(commentary,setup))throw new Error('Gemini yorumu doğrulama filtresini geçmedi');return{provider,commentary}}
async function telegram(setup,commentary,provider){const r=await fetch(`${BASE}/api/telegram`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({setup,commentary,provider,riskReward:setup.riskReward,mode:'github-pa-v1',signalId:setup.signalId})});const j=await r.json().catch(()=>({}));if(!r.ok||!j.ok)throw new Error(j.error||`Telegram HTTP ${r.status}`);return j}

async function buildSetup(symbol){
 const baseCandles=await candles(symbol,BASE_TF);if(baseCandles.length<200)return null;const last=baseCandles.at(-1);const age=Date.now()-last.closeTime;if(age>12*60*1000)return null;
 const current=analyzeSingle(symbol,BASE_TF,baseCandles),previous=analyzeSingle(symbol,BASE_TF,baseCandles.slice(0,-1));if(!isStableSetupPair(current,previous)||current.quality!=='GÜÇLÜ')return null;
 const frames=[current];for(const tf of CONFIRM_TFS){const c=await candles(symbol,tf);frames.push(analyzeSingle(symbol,tf,c))}
 const confirm=frames.slice(1),aligned=confirm.filter(x=>x.direction===current.direction).length,opposite=confirm.filter(x=>x.direction!=='WAIT'&&x.direction!==current.direction).length,available=confirm.filter(x=>x.direction!=='WAIT').length,agreement=available?aligned/available:0;if(opposite>0||aligned<1)return null;
 const htfContext=await buildHtfContext(symbol,current.price);
 const htfDecision=htfContextDecision(current.direction,htfContext,current.price);
 if(htfDecision.blocked){console.log(symbol,'HTF CONTEXT ENGELLEDİ',htfDecision.reasons);return null}
 const baseLiquidity=buildLiquidityMap(baseCandles,BASE_TF);
 const confidence=clamp((current.confidence||60)+aligned*3-(htfDecision.warnings.length?1:0),55,95);if(confidence<MIN_CONFIDENCE||(current.riskReward||0)<MIN_RR)return null;
 const ev=current.priceAction?.lastEvent?.time||0,sw=current.priceAction?.lastSweep?.time||0,ob=current.priceAction?.lastOrderBlock?.time||0,fvg=current.priceAction?.lastFvg?.time||0,signalId=`${symbol}|futures|${BASE_TF}|${current.direction}|${ev}|${sw}|${ob}|${fvg}`;
 return{...current,market:'futures',confidence,quality:'GÜÇLÜ',locked:true,lockedAt:last.time,candleCloseTime:last.closeTime,multiTimeframe:frames,agreement,mtf:{frames:[BASE_TF,...CONFIRM_TFS],aligned,opposite,available,status:'UYUMLU'},htfContext,liquidityContext:{base:baseLiquidity,decision:htfDecision},signalId,reasons:[...(current.reasons||[]),'İki kapanış teyidi','MTF uyumu',...htfDecision.warnings].slice(0,9)}
}

let sent=0;console.log(`ŞAOMİ Telegram PA+Gemini V1 taraması: ${new Date().toISOString()}`);
for(const symbol of SYMBOLS){try{
  const active=activeSignalForSymbol(signalState,symbol);
  if(active){
    await shadowReanalysis(active);
    console.log(symbol,'AKTİF SİNYAL VAR · yeni işlem üretilmedi');
    continue;
  }
  const setup=await buildSetup(symbol);
  if(!setup){console.log(symbol,'BEKLE / filtre dışı');continue}
  const dup=duplicateReason(signalState,setup);
  if(dup){console.log(symbol,`TEKRAR GÖNDERİLMEDİ (${dup})`,{signalId:setup.signalId});continue}
  console.log(symbol,{direction:setup.direction,confidence:setup.confidence,rr:setup.riskReward,mtf:setup.mtf});
  const g=await gemini(setup);
  const t=await telegram(setup,g.commentary,g.provider);
  rememberSignal(signalState,setup,t);
  sent++;
  console.log(`GÖNDERİLDİ ${symbol}`,t);
  if(sent>=MAX_SIGNALS){console.log('Bu tur maksimum güçlü sinyal sayısına ulaşıldı.');break}
}catch(e){console.error(`HATA ${symbol}:`,e?.message||e)}}
console.log(`ŞAOMİ Telegram PA+Gemini V1 bitti. Gönderilen: ${sent}`);