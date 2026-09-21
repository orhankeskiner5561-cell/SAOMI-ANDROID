import fs from 'node:fs';
const TELEGRAM_PUBLIC='https://saomi-trade-ai.vercel.app';
const TELEGRAM_ENDPOINT_CANDIDATES=[TELEGRAM_PUBLIC];
const TELEGRAM_BOT_TOKEN=String(process.env.TELEGRAM_BOT_TOKEN||process.env.TELEGRAM_TOKEN||'').trim();
const TELEGRAM_CHAT_ID=String(process.env.TELEGRAM_CHANNEL_ID||process.env.TELEGRAM_CHAT_ID||'').trim();
let TELEGRAM_SELECTED_ENDPOINT=TELEGRAM_PUBLIC;
let TELEGRAM_READY=false;
const FUTURES='https://www.binance.com';
const BASE_TFS=['1m','5m','15m','30m'];
const FUTURES_BATCH_SIZE=40;
const HOT_LANE_SIZE=24;
const UNIVERSE_REFRESH_MS=6*60*60*1000;
const HTF_ORDER=['1w','1d','4h','1h'];
const HTF_WEIGHT={'1w':4,'1d':3,'4h':2,'1h':1};
const ANALYSIS_VERSION='RC5.47_STRICT_HTF_RETEST_PA';
const LEGACY_TELEGRAM_SYMBOLS=new Set(['BTCUSDT','ETHUSDT','XRPUSDT','SOLUSDT','BNBUSDT','DOGEUSDT','ADAUSDT']);
const TELEGRAM_SYMBOL_POLICY='binance-usdm-trading-perpetual';
// Production delivery stays fail-closed until a live non-legacy USD-M perpetual symbol passes the root-clean endpoint contract.
const pickTelegramProbeSymbol=universe=>(universe||[]).find(x=>!LEGACY_TELEGRAM_SYMBOLS.has(String(x).toUpperCase()))||null;
const MIN_CONFIDENCE=78;
const MIN_RR=2;
const MAX_SIGNALS=12;
const MAX_SIGNALS_PER_SYMBOL=1;
const STATE_PATH='.github/state/saomi-telegram-state.json';
const REANALYSIS_MAX=3;
const TF_DUP_TTL_MS={'1m':30*60*1000,'5m':2*60*60*1000,'15m':6*60*60*1000,'30m':8*60*60*1000};
const TF_COOLDOWN_MS={'1m':5*60*1000,'5m':15*60*1000,'15m':30*60*1000,'30m':60*60*1000};
const TERMINAL_REENTRY_MS={'1m':15*60*1000,'5m':30*60*1000,'15m':60*60*1000,'30m':2*60*60*1000};
const terminalReentryMs=tf=>TERMINAL_REENTRY_MS[String(tf||'15m').toLowerCase()]||60*60*1000;
const cooldownMs=tf=>TF_COOLDOWN_MS[String(tf||'15m').toLowerCase()]||30*60*1000;
const dupTtlMs=tf=>TF_DUP_TTL_MS[String(tf||'15m').toLowerCase()]||12*60*60*1000;
const signalStateKey=(symbol,tf)=>String(symbol||'').toUpperCase()+'|'+String(tf||'15m').toLowerCase();
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const finite=x=>x!==null&&x!==undefined&&x!==''&&Number.isFinite(Number(x));
const tfMs=tf=>{const n=parseInt(tf,10);if(tf.endsWith('m'))return n*60000;if(tf.endsWith('h'))return n*3600000;if(tf.endsWith('d'))return n*86400000;if(tf.endsWith('w'))return n*604800000;return 60000};
const rejectStats={};
const rejectReason=reason=>{rejectStats[reason]=(rejectStats[reason]||0)+1;return null};

function sma(a,n){const out=Array(a.length).fill(null);let s=0;for(let i=0;i<a.length;i++){s+=a[i];if(i>=n)s-=a[i-n];if(i>=n-1)out[i]=s/n}return out}
function ema(a,n){const out=Array(a.length).fill(null);if(!a.length)return out;const k=2/(n+1);let x=a[0];for(let i=0;i<a.length;i++){x=i===0?a[i]:a[i]*k+x*(1-k);if(i>=n-1)out[i]=x}return out}
function trueRange(c){return c.map((x,i)=>i===0?x.high-x.low:Math.max(x.high-x.low,Math.abs(x.high-c[i-1].close),Math.abs(x.low-c[i-1].close)))}
function atr(c,n=14){return ema(trueRange(c),n)}
function pivots(c,left=3,right=3){const highs=[],lows=[];for(let i=left;i<c.length-right;i++){let hi=true,lo=true;for(let j=i-left;j<=i+right;j++){if(j===i)continue;if(c[j].high>=c[i].high)hi=false;if(c[j].low<=c[i].low)lo=false}if(hi)highs.push({i,time:c[i].time,price:c[i].high});if(lo)lows.push({i,time:c[i].time,price:c[i].low})}return{highs,lows}}
function detectStructure(c){
 const p=pivots(c),events=[],hs=p.highs.slice(-10),ls=p.lows.slice(-10);let trend='RANGE';
 if(hs.length>=2&&ls.length>=2){const hh=hs.at(-1).price>hs.at(-2).price,hl=ls.at(-1).price>ls.at(-2).price,lh=hs.at(-1).price<hs.at(-2).price,ll=ls.at(-1).price<ls.at(-2).price;if(hh&&hl)trend='UP';else if(lh&&ll)trend='DOWN'}
 for(let i=1;i<c.length;i++){const prevH=p.highs.filter(x=>x.i<i).at(-1),prevL=p.lows.filter(x=>x.i<i).at(-1);if(prevH&&c[i].close>prevH.price&&c[i-1].close<=prevH.price)events.push({type:trend==='DOWN'?'CHoCH':'BOS',side:'UP',time:c[i].time,price:prevH.price,index:i,breakClose:c[i].close});if(prevL&&c[i].close<prevL.price&&c[i-1].close>=prevL.price)events.push({type:trend==='UP'?'CHoCH':'BOS',side:'DOWN',time:c[i].time,price:prevL.price,index:i,breakClose:c[i].close})}
 const equalHighs=[],equalLows=[],ref=Math.max(1,c.at(-1)?.close||1),tol=ref*.0008;
 for(let i=0;i<hs.length;i++)for(let j=i+1;j<hs.length;j++)if(Math.abs(hs[i].price-hs[j].price)<=tol)equalHighs.push({a:hs[i],b:hs[j],price:(hs[i].price+hs[j].price)/2});
 for(let i=0;i<ls.length;i++)for(let j=i+1;j<ls.length;j++)if(Math.abs(ls[i].price-ls[j].price)<=tol)equalLows.push({a:ls[i],b:ls[j],price:(ls[i].price+ls[j].price)/2});
 const fvgs=[];for(let i=Math.max(2,c.length-160);i<c.length;i++){if(c[i].low>c[i-2].high)fvgs.push({side:'BULL',from:c[i-2].high,to:c[i].low,time:c[i].time,index:i});if(c[i].high<c[i-2].low)fvgs.push({side:'BEAR',from:c[i].high,to:c[i-2].low,time:c[i].time,index:i})}
 const obs=[];for(const e of events.slice(-8)){const idx=e.index;for(let j=idx-1;j>=Math.max(0,idx-8);j--){const bull=c[j].close>c[j].open;if((e.side==='UP'&&!bull)||(e.side==='DOWN'&&bull)){obs.push({side:e.side==='UP'?'BULL':'BEAR',time:c[j].time,low:c[j].low,high:c[j].high,index:j,eventTime:e.time});break}}}
 const sweeps=[];for(let i=Math.max(1,c.length-80);i<c.length;i++){const prior=c.slice(Math.max(0,i-20),i);if(!prior.length)continue;const ph=Math.max(...prior.map(x=>x.high)),pl=Math.min(...prior.map(x=>x.low));if(c[i].high>ph&&c[i].close<ph)sweeps.push({side:'HIGH',time:c[i].time,price:ph,extreme:c[i].high,index:i,close:c[i].close});if(c[i].low<pl&&c[i].close>pl)sweeps.push({side:'LOW',time:c[i].time,price:pl,extreme:c[i].low,index:i,close:c[i].close})}
 return{trend,pivots:p,events:events.slice(-20),equalHighs:equalHighs.slice(-6),equalLows:equalLows.slice(-6),fvgs:fvgs.slice(-12),orderBlocks:obs.slice(-8),sweeps:sweeps.slice(-8)}
}
function lastRecent(arr,c,bars=100){if(!arr?.length||!c?.length)return null;const min=c[Math.max(0,c.length-bars)]?.time??-Infinity;return[...arr].reverse().find(x=>(x.time??0)>=min)||null}

function supertrend(c,period=10,multiplier=3){
 const a=atr(c,period),line=Array(c.length).fill(null),direction=Array(c.length).fill('NEUTRAL');let pu=null,pl=null,pd='NEUTRAL';
 for(let i=0;i<c.length;i++){if(!finite(a[i]))continue;const mid=(c[i].high+c[i].low)/2,bu=mid+multiplier*a[i],bl=mid-multiplier*a[i],pc=i?c[i-1].close:c[i].close,fu=pu==null?bu:(bu<pu||pc>pu?bu:pu),fl=pl==null?bl:(bl>pl||pc<pl?bl:pl);let d=pd;if(d==='NEUTRAL')d=c[i].close>=mid?'LONG':'SHORT';else if(d==='SHORT'&&c[i].close>fu)d='LONG';else if(d==='LONG'&&c[i].close<fl)d='SHORT';direction[i]=d;line[i]=d==='LONG'?fl:fu;pu=fu;pl=fl;pd=d}
 const i=c.length-1;return{direction:direction[i],value:line[i],period,multiplier}
}
function lastCross(a,b,c,lookback=50){for(let i=a.length-1;i>=Math.max(1,a.length-lookback);i--){if(!finite(a[i])||!finite(b[i])||!finite(a[i-1])||!finite(b[i-1]))continue;if(a[i]>b[i]&&a[i-1]<=b[i-1])return{side:'UP',time:c[i].time,index:i};if(a[i]<b[i]&&a[i-1]>=b[i-1])return{side:'DOWN',time:c[i].time,index:i}}return null}
function trendIndicator(c){
 const close=c.map(x=>x.close),e9=ema(close,9),e21=ema(close,21),e50=ema(close,50),e200=ema(close,200),i=c.length-1,vals={ema9:e9[i],ema21:e21[i],ema50:e50[i],ema200:e200[i]};
 const alignment=finite(vals.ema200)&&vals.ema9>vals.ema21&&vals.ema21>vals.ema50&&vals.ema50>vals.ema200?'LONG':finite(vals.ema200)&&vals.ema9<vals.ema21&&vals.ema21<vals.ema50&&vals.ema50<vals.ema200?'SHORT':'NEUTRAL';
 const fastCross=lastCross(e9,e21,c,32),midCross=lastCross(e21,e50,c,50);let long=0,short=0;if(alignment==='LONG')long+=3;else if(alignment==='SHORT')short+=3;if(fastCross?.side==='UP')long+=1.4;if(fastCross?.side==='DOWN')short+=1.4;if(midCross?.side==='UP')long+=1.2;if(midCross?.side==='DOWN')short+=1.2;if(finite(vals.ema200)){if(c[i].close>vals.ema200)long+=1;else short+=1}
 return{...vals,alignment,fastCross,midCross,bias:Math.abs(long-short)<1?'NEUTRAL':long>short?'LONG':'SHORT',longScore:long,shortScore:short}
}
function volumeIndicator(c,period=20){
 const vols=c.map(x=>Math.max(0,Number(x.volume)||0)),avg=sma(vols,period),i=c.length-1,last=vols[i]||0,base=avg[i]||avg.slice(0,i+1).filter(Number.isFinite).at(-1)||0,rvol=base>0?last/base:1,k=c[i]||{},buy=finite(k.takerBuyVolume)?clamp(Number(k.takerBuyVolume),0,last):null,sell=buy==null?null:Math.max(0,last-buy),deltaPct=buy==null||last<=0?null:((buy-sell)/last)*100,obv=Array(c.length).fill(0);
 for(let j=1;j<c.length;j++)obv[j]=obv[j-1]+(c[j].close>c[j-1].close?vols[j]:c[j].close<c[j-1].close?-vols[j]:0);const slope=(obv[i]||0)-(obv[Math.max(0,i-10)]||0);let long=0,short=0;if(deltaPct!=null){if(deltaPct>=8)long+=1.6;else if(deltaPct<=-8)short+=1.6}if(slope>0)long+=1;else if(slope<0)short+=1;if(rvol>=1.15){if(c[i].close>=c[i].open)long+=.8;else short+=.8}
 return{rvol:Number(rvol.toFixed(2)),average:base,current:last,deltaPct:deltaPct==null?null:Number(deltaPct.toFixed(1)),obvSlope:slope,bias:Math.abs(long-short)<.75?'NEUTRAL':long>short?'LONG':'SHORT',longScore:long,shortScore:short}
}
function cluster(points,tol,side){const rows=(points||[]).slice(-80).sort((a,b)=>a.price-b.price),groups=[];for(const p of rows){let g=groups.find(x=>Math.abs(x.price-p.price)<=tol);if(!g){g={side,price:p.price,members:[]};groups.push(g)}g.members.push(p);g.price=g.members.reduce((s,x)=>s+x.price,0)/g.members.length}return groups.filter(x=>x.members.length>=2)}
function supportResistanceIndicator(c,s){
 const av=atr(c,14).at(-1)||Math.max(c.at(-1).close*.004,1e-8),price=c.at(-1).close,tol=Math.max(av*.18,price*.0007),dec=x=>({...x,touches:x.members.length,distanceAtr:Number((Math.abs(x.price-price)/Math.max(av,1e-12)).toFixed(2))}),ss=cluster(s.pivots?.lows,tol,'SUPPORT').map(dec).filter(x=>x.price<price).sort((a,b)=>b.price-a.price),rr=cluster(s.pivots?.highs,tol,'RESISTANCE').map(dec).filter(x=>x.price>price).sort((a,b)=>a.price-b.price);
 return{supports:ss.slice(0,5),resistances:rr.slice(0,5),nearestSupport:ss[0]||null,nearestResistance:rr[0]||null,tolerance:tol}
}
function resolvedAfter(c,idx,price,side,pad){const rows=c.slice(Math.max(0,idx+1));return side==='HIGH'?rows.some(k=>k.high>price+pad):rows.some(k=>k.low<price-pad)}
function liquidityIndicator(c,s){
 const av=atr(c,14).at(-1)||Math.max(c.at(-1).close*.004,1e-8),price=c.at(-1).close,pad=av*.08,highs=[],lows=[];
 for(const q of s.equalHighs||[]){const idx=Math.max(q.a?.i??-1,q.b?.i??-1);if(idx>=0&&!resolvedAfter(c,idx,q.price,'HIGH',pad))highs.push({side:'HIGH',price:q.price,index:idx,time:q.b?.time||q.a?.time||null,distanceAtr:Number((Math.abs(q.price-price)/Math.max(av,1e-12)).toFixed(2))})}
 for(const q of s.equalLows||[]){const idx=Math.max(q.a?.i??-1,q.b?.i??-1);if(idx>=0&&!resolvedAfter(c,idx,q.price,'LOW',pad))lows.push({side:'LOW',price:q.price,index:idx,time:q.b?.time||q.a?.time||null,distanceAtr:Number((Math.abs(q.price-price)/Math.max(av,1e-12)).toFixed(2))})}
 const sw=lastRecent(s.sweeps,c,90);return{untakenHighs:highs.filter(x=>x.price>price).sort((a,b)=>a.price-b.price).slice(0,5),untakenLows:lows.filter(x=>x.price<price).sort((a,b)=>b.price-a.price).slice(0,5),lastSweep:sw?{side:sw.side,time:sw.time,price:sw.price,extreme:sw.extreme,index:sw.index}:null}
}
function fibonacciIndicator(c,s){
 let low=null,high=null,direction='UP',hs=s.pivots?.highs||[],ls=s.pivots?.lows||[];
 if(hs.length&&ls.length){const lh=hs.at(-1),ll=ls.at(-1);if(lh.i>ll.i){const pl=[...ls].reverse().find(x=>x.i<lh.i);if(pl){low=pl;high=lh;direction='UP'}}else{const ph=[...hs].reverse().find(x=>x.i<ll.i);if(ph){high=ph;low=ll;direction='DOWN'}}}
 if(!low||!high){const start=Math.max(0,c.length-120),rows=c.slice(start);let li=0,hi=0;for(let i=1;i<rows.length;i++){if(rows[i].low<rows[li].low)li=i;if(rows[i].high>rows[hi].high)hi=i}low={i:start+li,time:rows[li].time,price:rows[li].low};high={i:start+hi,time:rows[hi].time,price:rows[hi].high};direction=high.i>low.i?'UP':'DOWN'}
 const lo=low.price,hi=high.price,range=hi-lo;if(!(range>0))return null;const ratios=[0,.236,.382,.5,.618,.786,1],levels=ratios.map(r=>({ratio:r,price:lo+range*r})),price=c.at(-1).close,mid=lo+range*.5,bias=direction==='UP'&&price>=mid?'LONG':direction==='DOWN'&&price<=mid?'SHORT':'NEUTRAL';
 const extensions=direction==='UP'?[{ratio:1.272,price:hi+range*.272},{ratio:1.618,price:hi+range*.618}]:[{ratio:1.272,price:lo-range*.272},{ratio:1.618,price:lo-range*.618}];
 return{direction,low:{time:low.time,price:lo,index:low.i},high:{time:high.time,price:hi,index:high.i},range,levels,extensions,golden:{low:lo+range*.5,high:lo+range*.618},bias}
}
function smartMoneyIndicator(c,s){const ev=lastRecent(s.events,c,100),sw=lastRecent(s.sweeps,c,90),ob=(s.orderBlocks||[]).at(-1)||null,fvg=(s.fvgs||[]).at(-1)||null;let long=0,short=0;if(s.trend==='UP')long+=2;else if(s.trend==='DOWN')short+=2;if(ev?.side==='UP')long+=2;else if(ev?.side==='DOWN')short+=2;if(sw?.side==='LOW')long+=1.25;else if(sw?.side==='HIGH')short+=1.25;return{trend:s.trend,lastEvent:ev,lastSweep:sw,lastOrderBlock:ob,lastFvg:fvg,bias:Math.abs(long-short)<1?'NEUTRAL':long>short?'LONG':'SHORT',longScore:long,shortScore:short}}

function simpleStructure(c){
 const p=pivots(c),hs=p.highs.slice(-12),ls=p.lows.slice(-12),events=[];let trend='RANGE';
 if(hs.length>=2&&ls.length>=2){
  const hh=hs.at(-1).price>hs.at(-2).price,hl=ls.at(-1).price>ls.at(-2).price,lh=hs.at(-1).price<hs.at(-2).price,ll=ls.at(-1).price<ls.at(-2).price;
  if(hh&&hl)trend='UP';else if(lh&&ll)trend='DOWN';
 }
 for(let i=Math.max(1,c.length-100);i<c.length;i++){
  const prevH=hs.filter(x=>x.i<i).at(-1),prevL=ls.filter(x=>x.i<i).at(-1);
  if(prevH&&c[i].close>prevH.price&&c[i-1].close<=prevH.price)events.push({type:'TREND_BREAK',side:'UP',time:c[i].time,price:prevH.price,index:i,breakClose:c[i].close});
  if(prevL&&c[i].close<prevL.price&&c[i-1].close>=prevL.price)events.push({type:'TREND_BREAK',side:'DOWN',time:c[i].time,price:prevL.price,index:i,breakClose:c[i].close});
 }
 return{trend,pivots:p,events:events.slice(-20)}
}
function fusionFrameContext(tf,c){
 if(!c?.length)return{timeframe:tf,bias:'NEUTRAL',strength:0,error:'veri yok'};
 const s=simpleStructure(c),close=c.map(x=>x.close),e200=ema(close,200),i=c.length-1,price=c[i].close,ema200=e200[i],cross=lastCross(close,e200,c,40),lastBreak=(s.events||[]).at(-1)||null;
 const breakAge=lastBreak?i-Number(lastBreak.index):Infinity,crossAge=cross?i-Number(cross.index):Infinity,emaSide=finite(ema200)?(price>ema200?'LONG':price<ema200?'SHORT':'NEUTRAL'):'NEUTRAL';
 let long=0,short=0;
 if(s.trend==='UP')long+=3;else if(s.trend==='DOWN')short+=3;
 if(emaSide==='LONG')long+=3;else if(emaSide==='SHORT')short+=3;
 if(lastBreak&&breakAge<=20){if(lastBreak.side==='UP')long+=3;else short+=3}
 if(cross&&crossAge<=24){if(cross.side==='UP')long+=3;else short+=3}
 const edge=Math.abs(long-short),bias=edge<2?'NEUTRAL':long>short?'LONG':'SHORT',strength=clamp(Math.round(55+edge*4),55,92);
 return{
  timeframe:tf,bias,strength,price,atr:atr(c,14).at(-1)||Math.max(price*.004,1e-8),
  trend:{ema200,alignment:bias,structure:s.trend,ema200Side:emaSide,ema200Cross:cross?{...cross,ageBars:crossAge}:null,lastBreak:lastBreak?{...lastBreak,ageBars:breakAge}:null},
  priceAction:{structureTrend:s.trend,lastBreak:lastBreak?{...lastBreak,ageBars:breakAge}:null},
  supertrend:null,volume:null,supportResistance:null,liquidity:null,fibonacci:null,smartMoney:null,
  reasons:[
   'Trend '+s.trend,
   'EMA200 '+emaSide,
   lastBreak&&breakAge<=20?'Trend kirilimi '+lastBreak.side:null,
   cross&&crossAge<=24?'EMA200 kirilimi '+cross.side:null
  ].filter(Boolean)
 }
}

function majorFusionDecision(frames){
 const map=Object.fromEntries((frames||[]).map(x=>[x.timeframe,x]));let long=0,short=0;
 for(const f of frames||[]){
  const w=HTF_WEIGHT[f.timeframe]||1;
  if(f.bias==='LONG')long+=w;
  else if(f.bias==='SHORT')short+=w;
 }
 const edge=Math.abs(long-short),direction=edge<1?'NEUTRAL':long>short?'LONG':'SHORT',total=Math.max(1,long+short),conviction=clamp(Math.round(55+(edge/total)*35),55,90);
 const arrow=f=>!f?'—':f.bias==='LONG'?'↑':f.bias==='SHORT'?'↓':'↔';
 return{direction,longScore:long,shortScore:short,conviction,summary:'1W '+arrow(map['1w'])+' · 1D '+arrow(map['1d'])+' · 4H '+arrow(map['4h'])+' · 1H '+arrow(map['1h']),warnings:[],supports:[]}
}
async function buildTopDownContext(symbol){const frames=[];for(const tf of HTF_ORDER)frames.push(fusionFrameContext(tf,await candles(symbol,tf)));const major=majorFusionDecision(frames);return{version:ANALYSIS_VERSION,order:[...HTF_ORDER],builtAt:new Date().toISOString(),frames,major}}
function strictHtfGate(direction,frames){
 const rows=(frames||[]).filter(x=>x&&HTF_ORDER.includes(x.timeframe));
 const opposite=rows.filter(x=>x.bias!=='NEUTRAL'&&x.bias!==direction);
 const aligned=rows.filter(x=>x.bias===direction);
 const alignedScore=aligned.reduce((n,x)=>n+(HTF_WEIGHT[x.timeframe]||1),0);
 const map=Object.fromEntries(rows.map(x=>[x.timeframe,x]));
 const lowerMajorOk=map['1h']?.bias===direction;
 const higherSupport=['4h','1d','1w'].some(tf=>map[tf]?.bias===direction);
 return{allowed:opposite.length===0&&alignedScore>=6&&lowerMajorOk&&higherSupport,opposite,aligned,alignedScore}
}
function topDownDecision(direction,ctx){
 const major=ctx.major||majorFusionDecision(ctx.frames||[]),gate=strictHtfGate(direction,ctx.frames||[]);
 const allowed=major.direction===direction&&gate.allowed;
 return{allowed,direction,majorDirection:major.direction,alignedScore:direction==='LONG'?major.longScore:major.shortScore,oppositeScore:direction==='LONG'?major.shortScore:major.longScore,summary:major.summary,conviction:major.conviction,blockers:allowed?[]:['STRICT_HTF_CONFLICT_OR_WEAK_ALIGNMENT'],warnings:[],supports:gate.aligned.map(x=>x.timeframe)}
}

function zoneCandidates(s,event,dir,av){const up=dir==='LONG',tol=av*.24,out=[{type:'BREAK_RETEST',low:event.price-tol,high:event.price+tol,level:event.price}];for(const f of (s.fvgs||[]).filter(x=>x.time>=event.time&&(up?x.side==='BULL':x.side==='BEAR')).slice(-4))out.push({type:'FVG_RETEST',low:Math.min(f.from,f.to),high:Math.max(f.from,f.to),level:(f.from+f.to)/2,time:f.time});for(const ob of (s.orderBlocks||[]).filter(x=>(up?x.side==='BULL':x.side==='BEAR')&&x.time>=event.time-1).slice(-4))out.push({type:'OB_RETEST',low:ob.low,high:ob.high,level:(ob.low+ob.high)/2,time:ob.time});return out}
function findRetest(c,s,event,dir,av,tf='15m'){
 const idx=finite(event.index)?event.index:c.findIndex(x=>x.time===event.time),lastI=c.length-1;if(idx<0)return null;
 const maxAge=String(tf)==='1m'?8:String(tf)==='5m'?6:String(tf)==='15m'?5:4;
 let best=null;
 for(let i=idx+1;i<c.length;i++){
  const k=c[i];
  for(const z of zoneCandidates(s,event,dir,av)){
   if(k.low>z.high||k.high<z.low)continue;
   const held=dir==='LONG'?k.close>=z.low-av*.08:k.close<=z.high+av*.08;
   if(!held)continue;
   const age=lastI-i;if(age>maxAge)continue;
   const dist=Math.abs(c.at(-1).close-z.level)/Math.max(av,1e-12);if(dist>.8)continue;
   const row={...z,time:k.time,index:i,ageBars:age,distanceAtr:Number(dist.toFixed(2)),candle:{open:k.open,high:k.high,low:k.low,close:k.close}};
   if(!best||row.ageBars<best.ageBars||row.ageBars===best.ageBars&&row.distanceAtr<best.distanceAtr)best=row
  }
 }
 return best
}
function liquidityEntrySequence(c,direction,tf='15m'){
 const s=detectStructure(c),av=atr(c,14).at(-1)||Math.max(c.at(-1).close*.004,1e-8),wantSweep=direction==='LONG'?'LOW':'HIGH',wantBreak=direction==='LONG'?'UP':'DOWN';
 const sweeps=(s.sweeps||[]).filter(x=>x.side===wantSweep).slice().reverse();
 if(!sweeps.length)return rejectReason('SEQ_NO_DIRECTIONAL_SWEEP');
 let sawBreak=false,sawRetest=false,sawIntegrity=false;
 for(const rawSweep of sweeps){
   // Liquidity raid can print several wicks before structure actually flips.
   // Treat them as one raid and use the final/extreme wick as stop reference.
   let event=(s.events||[]).find(e=>e.side===wantBreak&&e.time>rawSweep.time);
   if(!event){
     const anchor=direction==='LONG'
       ? [...(s.pivots?.highs||[])].reverse().find(p=>p.i<rawSweep.index&&rawSweep.index-p.i<=40)
       : [...(s.pivots?.lows||[])].reverse().find(p=>p.i<rawSweep.index&&rawSweep.index-p.i<=40);
     if(anchor){
       for(let j=rawSweep.index+1;j<c.length;j++){
         const crossed=direction==='LONG'?c[j].close>anchor.price:c[j].close<anchor.price;
         if(crossed){event={type:'MICRO_CHOCH',side:wantBreak,time:c[j].time,price:anchor.price,index:j,breakClose:c[j].close};break}
       }
     }
   }
   if(!event)continue;
   sawBreak=true;
   const eventIndex=finite(event.index)?Number(event.index):c.findIndex(x=>x.time===event.time);
   if(eventIndex<=rawSweep.index)continue;
   const raidCandles=c.slice(rawSweep.index,eventIndex+1);
   const effectiveExtreme=direction==='LONG'
     ? Math.min(...raidCandles.map(k=>k.low))
     : Math.max(...raidCandles.map(k=>k.high));
   const extremeIndex=direction==='LONG'
     ? rawSweep.index+raidCandles.findIndex(k=>k.low===effectiveExtreme)
     : rawSweep.index+raidCandles.findIndex(k=>k.high===effectiveExtreme);
   const sweep={...rawSweep,extreme:effectiveExtreme,index:extremeIndex,time:c[extremeIndex]?.time??rawSweep.time,clustered:true};
   // After the structure break, a CLOSE beyond the raid extreme invalidates it.
   const postBreak=c.slice(eventIndex+1);
   const closeInvalid=direction==='LONG'
     ? postBreak.some(k=>k.close<effectiveExtreme-av*.05)
     : postBreak.some(k=>k.close>effectiveExtreme+av*.05);
   if(closeInvalid)continue;
   sawIntegrity=true;
   const retest=findRetest(c,s,event,direction,av,tf);
   if(!retest)continue;
   sawRetest=true;
   if(!(sweep.time<event.time&&event.time<retest.time))continue;
   const closeHeld=direction==='LONG'
     ? retest.candle.close>=effectiveExtreme-av*.05
     : retest.candle.close<=effectiveExtreme+av*.05;
   if(!closeHeld)continue;
   return{sweep,event,retest,structure:s,atr:av}
 }
 if(!sawBreak)return rejectReason('SEQ_NO_POST_SWEEP_BREAK');
 if(!sawIntegrity)return rejectReason('SEQ_POST_BREAK_CLOSE_INVALID');
 if(!sawRetest)return rejectReason('SEQ_NO_RECENT_RETEST');
 return rejectReason('SEQ_ORDER_OR_SWEEP_INTEGRITY')
}
function nearestMajorObstacle(frames,direction,entry){const rows=[];for(const f of frames||[]){const x=direction==='LONG'?f.supportResistance?.nearestResistance:f.supportResistance?.nearestSupport;if(!x||!finite(x.price))continue;if(direction==='LONG'&&x.price>entry||direction==='SHORT'&&x.price<entry)rows.push({price:Number(x.price),source:'HTF_'+(direction==='LONG'?'RESISTANCE':'SUPPORT'),timeframe:f.timeframe})}return rows.sort((a,b)=>Math.abs(a.price-entry)-Math.abs(b.price-entry))[0]||null}
function nearestForward(ctx,direction,entry,frames){
 const rows=[];if(direction==='LONG'){for(const x of ctx.supportResistance?.resistances||[])if(x.price>entry)rows.push({price:x.price,source:'LOCAL_RESISTANCE',timeframe:ctx.timeframe});for(const x of ctx.liquidity?.untakenHighs||[])if(x.price>entry)rows.push({price:x.price,source:'LOCAL_LIQUIDITY',timeframe:ctx.timeframe});for(const x of ctx.fibonacci?.extensions||[])if(x.price>entry)rows.push({price:x.price,source:'FIB_EXTENSION',timeframe:ctx.timeframe})}else{for(const x of ctx.supportResistance?.supports||[])if(x.price<entry)rows.push({price:x.price,source:'LOCAL_SUPPORT',timeframe:ctx.timeframe});for(const x of ctx.liquidity?.untakenLows||[])if(x.price<entry)rows.push({price:x.price,source:'LOCAL_LIQUIDITY',timeframe:ctx.timeframe});for(const x of ctx.fibonacci?.extensions||[])if(x.price<entry)rows.push({price:x.price,source:'FIB_EXTENSION',timeframe:ctx.timeframe})}const major=nearestMajorObstacle(frames,direction,entry);if(major)rows.push(major);return rows.sort((a,b)=>Math.abs(a.price-entry)-Math.abs(b.price-entry))[0]||null}

function buildCanonicalTradePlan(symbol,tf,c,major){
 const ctx=fusionFrameContext(tf,c),i=c.length-1,ema200=ctx.trend?.ema200,breakEvent=ctx.priceAction?.lastBreak,cross=ctx.trend?.ema200Cross;
 if(!finite(ema200))return rejectReason('STRICT_EMA200_UNAVAILABLE');
 if(!breakEvent)return rejectReason('STRICT_NO_TREND_BREAK');
 const breakAge=Number(breakEvent.ageBars);
 if(!Number.isFinite(breakAge)||breakAge>3)return rejectReason('STRICT_BREAK_NOT_FRESH');
 const direction=breakEvent.side==='UP'?'LONG':breakEvent.side==='DOWN'?'SHORT':null;
 if(!direction)return rejectReason('STRICT_BREAK_DIRECTION_INVALID');
 const up=direction==='LONG',requiredStructure=up?'UP':'DOWN';
 if(ctx.priceAction?.structureTrend==='RANGE')return rejectReason('STRICT_RANGE_BLOCK');
 if(ctx.priceAction?.structureTrend!==requiredStructure)return rejectReason('STRICT_STRUCTURE_DIRECTION_MISMATCH');
 if(ctx.trend?.ema200Side!==direction)return rejectReason('STRICT_EMA200_SIDE_MISMATCH');
 if(major.direction!==direction)return rejectReason('STRICT_MAJOR_DIRECTION_MISMATCH');
 const htfGate=strictHtfGate(direction,major.frames||[]);
 if(!htfGate.allowed)return rejectReason('STRICT_HTF_CONFLICT_OR_WEAK_ALIGNMENT');

 const s=simpleStructure(c),av=ctx.atr||Math.max(c.at(-1).close*.004,1e-8);
 const breakIndex=finite(breakEvent.index)?Number(breakEvent.index):c.findIndex(x=>x.time===breakEvent.time);
 if(breakIndex<0||breakIndex>=i)return rejectReason('STRICT_BREAK_INDEX_INVALID');
 const level=Number(breakEvent.price),tol=av*.22;
 let retest=null,confirm=null;
 for(let r=breakIndex+1;r<i;r++){
   const k=c[r],cf=c[r+1];
   if(!cf)continue;
   const touchedLevel=k.low<=level+tol&&k.high>=level-tol;
   const held=up?k.close>=level-av*.05:k.close<=level+av*.05;
   if(!touchedLevel||!held)continue;
   const body=Math.abs(cf.close-cf.open);
   const directional=up?cf.close>cf.open:cf.close<cf.open;
   const confirmsLevel=up?cf.close>level+av*.05:cf.close<level-av*.05;
   const confirmsRetest=up?cf.close>Math.max(k.open,k.close):cf.close<Math.min(k.open,k.close);
   const recentConfirm=i-(r+1)<=1;
   if(directional&&confirmsLevel&&confirmsRetest&&body>=av*.12&&recentConfirm){
     retest={time:k.time,index:r,ageBars:i-r,level,candle:{open:k.open,high:k.high,low:k.low,close:k.close}};
     confirm={time:cf.time,index:r+1,ageBars:i-(r+1),candle:{open:cf.open,high:cf.high,low:cf.low,close:cf.close},bodyAtr:Number((body/Math.max(av,1e-12)).toFixed(2))};
   }
 }
 if(!retest||!confirm)return rejectReason('STRICT_RETEST_CONFIRM_MISSING');

 const entry=Number(c.at(-1).close);
 const stillHolding=up?entry>level-av*.05:entry<level+av*.05;
 if(!stillHolding)return rejectReason('STRICT_POST_CONFIRM_HOLD_FAILED');
 const chaseAtr=Math.abs(entry-level)/Math.max(av,1e-12);
 if(chaseAtr>1.25)return rejectReason('STRICT_ENTRY_TOO_EXTENDED');

 const pivot=up?[...(s.pivots?.lows||[])].reverse().find(x=>x.i<retest.index):[...(s.pivots?.highs||[])].reverse().find(x=>x.i<retest.index);
 const recent=c.slice(Math.max(0,breakIndex-12),retest.index+1);
 const fallback=up?Math.min(...recent.map(x=>x.low)):Math.max(...recent.map(x=>x.high));
 const anchor=finite(pivot?.price)?Number(pivot.price):fallback;
 const buffer=Math.max(Math.abs(entry)*.0004,av*.25);
 const stop=up?anchor-buffer:anchor+buffer;
 const risk=Math.abs(entry-stop);
 if(!(risk>0))return rejectReason('STRICT_STOP_GEOMETRY');
 const riskAtr=risk/Math.max(av,1e-12);
 if(riskAtr<2)return rejectReason('STRICT_STOP_LT_2ATR');
 if(riskAtr>9)return rejectReason('STRICT_STOP_GT_9ATR');

 const sgn=up?1:-1,tp1=entry+sgn*risk*1.25,tp2=entry+sgn*risk*2,tp3=entry+sgn*risk*3,rr=3;
 let confidence=55;
 confidence+=Math.min(10,htfGate.alignedScore);
 confidence+=5;
 confidence+=breakAge<=2?6:4;
 confidence+=6;
 confidence+=6;
 confidence+=ctx.trend?.ema200Side===direction?4:0;
 confidence+=riskAtr>=3?4:2;
 confidence=clamp(Math.round(confidence),78,89);

 const entryTrigger={
  order:['HTF','STRUCTURE','FRESH_BREAK','RETEST','CONFIRMATION','ENTRY'],
  type:'TREND_BREAK_RETEST_CONFIRM',time:breakEvent.time,
  break:{type:'TREND_BREAK',side:breakEvent.side,time:breakEvent.time,price:level,ageBars:breakAge,index:breakIndex},
  ema200Cross:cross?{side:cross.side,time:cross.time,ageBars:cross.ageBars}:null,
  structureTrend:ctx.priceAction?.structureTrend,
  ema200,ema200Side:ctx.trend?.ema200Side,retest,confirmation:confirm,
  stopBasis:{type:'STRUCTURAL_SWING_PLUS_VOLATILITY',anchor,buffer,minRiskAtr:2,riskAtr:Number(riskAtr.toFixed(2))}
 };
 return{
  symbol,timeframe:tf,direction,price:entry,entry,stop,tp1,tp2,tp3,riskReward:rr,confidence,
  quality:confidence>=86?'GUCLU':'TEMIZ',
  indicatorContext:ctx,entryTrigger,entrySequence:entryTrigger,liquidityEvidence:null,majorObstacle:null,
  riskAtr:Number(riskAtr.toFixed(2)),
  reasons:['STRICT HTF '+major.summary,'Yapi '+ctx.priceAction?.structureTrend,'Taze kirilim '+breakAge+' mum','Retest onayli','Kapanmis onay mumu','EMA200 taraf '+ctx.trend?.ema200Side,'Stop '+Number(riskAtr.toFixed(2))+' ATR'],
  invalidation:up?'Yapisal swing dibi + volatilite tamponu alti':'Yapisal swing tepesi + volatilite tamponu ustu'
 }
}
function fmtNum(v){if(v===null||v===undefined||v==='')return'—';const x=Number(v);if(!Number.isFinite(x))return'—';const a=Math.abs(x),d=a>=1000?1:a>=100?2:a>=1?4:a>=.1?5:7;return x.toFixed(d).replace(/0+$/,'').replace(/\.$/,'')}

function commentary(setup){
 const d=setup.topDownContext?.decision||{},ctx=setup.indicatorContext||{},tr=setup.entryTrigger||{};
 const cross=tr.ema200Cross?('EMA200 '+tr.ema200Cross.side+' kirilimi'):'EMA200 taraf '+(ctx.trend?.ema200Side||'—');
 const br=tr.break?('Trend kirilimi '+tr.break.side):'Trend '+(ctx.priceAction?.structureTrend||'RANGE');
 return 'STRICT HTF + Price Action. '+(d.summary||'')+'. '+br+'. Retest + kapanmis onay mumu zorunlu. '+setup.direction+' giris '+fmtNum(setup.entry)+'. STOP '+fmtNum(setup.stop)+' ('+fmtNum(setup.riskAtr)+' ATR) · TP1 '+fmtNum(setup.tp1)+' · TP2 '+fmtNum(setup.tp2)+' · TP3 '+fmtNum(setup.tp3)+'. EMA200 sadece yon filtresidir; tek basina sinyal degildir.';
}
const cache=new Map();
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function futuresFetch(url,label,attempt=0){
  const r=await fetch(url);
  if(r.ok)return r;
  if((r.status===429||r.status===418||r.status>=500)&&attempt<3){
    const wait=Math.min(12000,1200*Math.pow(2,attempt));
    console.log('BINANCE RETRY',label,'HTTP',r.status,'wait',wait);
    await sleep(wait);
    return futuresFetch(url,label,attempt+1)
  }
  throw new Error(label+' Binance HTTP '+r.status)
}
async function loadFuturesUniverse(){
  const u=FUTURES+'/fapi/v1/exchangeInfo',r=await futuresFetch(u,'exchangeInfo'),d=await r.json();
  return (d.symbols||[])
    .filter(x=>x?.status==='TRADING'&&x?.contractType==='PERPETUAL'&&x?.symbol)
    .map(x=>String(x.symbol).toUpperCase())
    .sort((a,b)=>a.localeCompare(b))
}
async function loadHotLane(universe){
  const allowed=new Set(universe||[]);
  const r=await futuresFetch(FUTURES+'/fapi/v1/ticker/24hr','ticker24h'),d=await r.json();
  return (Array.isArray(d)?d:[])
    .filter(x=>allowed.has(String(x.symbol||'').toUpperCase()))
    .map(x=>({symbol:String(x.symbol).toUpperCase(),quoteVolume:Number(x.quoteVolume)||0}))
    .sort((a,b)=>b.quoteVolume-a.quoteVolume)
    .slice(0,HOT_LANE_SIZE)
    .map(x=>x.symbol)
}
async function candles(symbol,tf){
  const key=symbol+'|'+tf;if(cache.has(key))return cache.get(key);
  const u=FUTURES+'/fapi/v1/klines?symbol='+encodeURIComponent(symbol)+'&interval='+tf+'&limit=500';
  const r=await futuresFetch(u,symbol+' '+tf),d=await r.json();
  const rows=d.map(k=>({time:Number(k[0]),openTime:Number(k[0]),open:Number(k[1]),high:Number(k[2]),low:Number(k[3]),close:Number(k[4]),volume:Number(k[5]),closeTime:Number(k[6]),quoteVolume:Number(k[7]),takerBuyVolume:Number(k[9]),takerBuyQuote:Number(k[10])})).filter(x=>x.closeTime<Date.now()-500);
  cache.set(key,rows);
  await sleep(45);
  return rows
}

function loadSignalState(){
 let state;try{state=JSON.parse(fs.readFileSync(STATE_PATH,'utf8'))}catch{state={}}
 state.version=8;state.signals=state.signals||{};state.activeSignals=state.activeSignals||{};state.history=Array.isArray(state.history)?state.history:[];
 state.scannerUniverse=state.scannerUniverse||{cursor:0,total:0,lastRefreshAt:null,lastBatchAt:null,lastBatch:[]};
 return state
}
function saveSignalState(state){fs.mkdirSync('.github/state',{recursive:true});fs.writeFileSync(STATE_PATH,JSON.stringify(state,null,2)+'\n')}

function structuralFingerprint(setup){
 const t=setup.entryTrigger||{},d=setup.topDownContext?.decision||{};
 return[setup.symbol,'futures',setup.timeframe,setup.direction,d.majorDirection||setup.direction,t.type||'',t.time||0,t.break?.side||'',t.break?.time||0,t.ema200Cross?.side||'',t.ema200Cross?.time||0,t.structureTrend||'',t.ema200Side||''].join('|')
}
function duplicateReason(state,setup){const tf=String(setup.timeframe||'15m').toLowerCase(),now=Date.now(),active=Object.values(state.activeSignals||{}).find(x=>x?.symbol===setup.symbol&&String(x.timeframe||'15m').toLowerCase()===tf&&!['TP3','STOP','EXPIRED','AMBIGUOUS','CANCELLED'].includes(x.status));if(active)return'ayni timeframe aktif sinyal var';const fp=structuralFingerprint(setup),recent=(state.history||[]).filter(x=>x?.symbol===setup.symbol&&String(x.timeframe||'15m').toLowerCase()===tf&&x.direction===setup.direction).sort((a,b)=>(Date.parse(b.closedAt||0)||0)-(Date.parse(a.closedAt||0)||0))[0];if(recent){const t=Date.parse(recent.closedAt||0),age=Number.isFinite(t)?now-t:Infinity;if(age<terminalReentryMs(tf))return'terminal sonrasi yeniden giris bekleme suresi';if((recent.fingerprint||recent.structureKey)===fp&&age<dupTtlMs(tf))return'ayni yapi terminal sonrasi tekrar etti'}const prev=state.signals?.[signalStateKey(setup.symbol,tf)];if(!prev)return null;const t=Date.parse(prev.sentAt||0),age=Number.isFinite(t)?now-t:Infinity;if(age<cooldownMs(tf))return'timeframe cooldown';if((prev.fingerprint||prev.structureKey)===fp&&age<dupTtlMs(tf))return'ayni yapisal setup';return null}
function rememberSignal(state,setup,tg,meta){state.version=8;const sentAt=new Date().toISOString(),fingerprint=structuralFingerprint(setup),base={fingerprint,structureKey:fingerprint,signalId:setup.signalId,symbol:setup.symbol,market:'futures',timeframe:setup.timeframe,direction:setup.direction,confidence:setup.confidence,riskReward:setup.riskReward,sentAt,entry:setup.entry,stop:setup.stop,tp1:setup.tp1,tp2:setup.tp2,tp3:setup.tp3,messageId:tg?.messageId??null,analysisVersion:ANALYSIS_VERSION,topDownContext:setup.topDownContext,lowerFrameContext:setup.lowerFrameContext,indicatorContext:setup.indicatorContext,entryTrigger:setup.entryTrigger,entrySequence:setup.entrySequence,liquidityEvidence:setup.liquidityEvidence,majorObstacle:setup.majorObstacle,riskAtr:setup.riskAtr,commentary:String(meta.commentary||''),commentaryProvider:String(meta.provider||'')};state.signals[signalStateKey(setup.symbol,setup.timeframe)]=base;state.activeSignals[setup.signalId]={...base,status:'WAIT_ENTRY',stage:0,enteredAt:null,lastCheckedAt:sentAt,notified:{entry:false,tp1:false,tp2:false,tp3:false,stop:false,ambiguous:false}};saveSignalState(state)}

const signalState=loadSignalState();
function chooseRotatingBatch(universe,state){
 const clean=[...new Set(universe||[])].filter(Boolean),n=clean.length;if(!n)return[];
 const old=state.scannerUniverse||{},cursor=((Number(old.cursor)||0)%n+n)%n,size=Math.min(FUTURES_BATCH_SIZE,n),batch=[];
 for(let i=0;i<size;i++)batch.push(clean[(cursor+i)%n]);
 const next=(cursor+size)%n;
 state.scannerUniverse={
   cursor:next,total:n,lastRefreshAt:new Date().toISOString(),lastBatchAt:new Date().toISOString(),lastBatch:batch,
   batchSize:size,cyclesCompleted:Number(old.cyclesCompleted||0)+(next<cursor?1:0)
 };
 return batch
}
function activeSymbols(state){return [...new Set(Object.values(state.activeSignals||{}).filter(x=>x&&!['TP3','STOP','EXPIRED','AMBIGUOUS','CANCELLED'].includes(x.status)).map(x=>String(x.symbol||'').toUpperCase()).filter(Boolean))]}
function activeSignalForSymbol(state,symbol,tf){return Object.values(state.activeSignals||{}).find(x=>x?.symbol===symbol&&String(x.timeframe||'15m').toLowerCase()===String(tf).toLowerCase()&&!['TP3','STOP','EXPIRED','AMBIGUOUS','CANCELLED'].includes(x.status))||null}

async function shadowReanalysis(active){
 active.reanalysis=active.reanalysis||{max:REANALYSIS_MAX,snapshots:[],lastCandleCloseTime:0};
 active.reanalysis.snapshots=Array.isArray(active.reanalysis.snapshots)?active.reanalysis.snapshots:[];
 if(active.reanalysis.snapshots.length>=REANALYSIS_MAX)return false;
 const tf=String(active.timeframe||'15m').toLowerCase(),base=await candles(active.symbol,tf),last=base.at(-1),sent=Date.parse(active.sentAt||0);
 if(!last?.closeTime||last.closeTime<=sent||last.closeTime<=Number(active.reanalysis.lastCandleCloseTime||0))return false;
 const top=await buildTopDownContext(active.symbol),major=top.major,lower=fusionFrameContext(tf,base),lowerDir=lower.bias==='NEUTRAL'?'WAIT':lower.bias;
 const verdict=major.direction!=='NEUTRAL'&&major.direction!==active.direction?'TERS_MAJOR':lowerDir===active.direction?'AYNI_YON':lowerDir==='WAIT'?'BEKLE':'TERS_MINOR';
 const snap={no:active.reanalysis.snapshots.length+1,checkedAt:new Date().toISOString(),candleCloseTime:last.closeTime,price:last.close,originalDirection:active.direction,majorDirection:major.direction,majorConviction:major.conviction,currentDirection:lowerDir,currentConfidence:lower.strength,lowerTrend:lower.trend,lowerPriceAction:lower.priceAction,verdict,commentary:active.symbol+' '+tf+' recheck: major '+major.direction+' · trend/EMA200/PA '+lowerDir+' · '+major.summary};
 active.reanalysis.snapshots.push(snap);active.reanalysis.lastCandleCloseTime=last.closeTime;
 active.reanalysis.summary={same:active.reanalysis.snapshots.filter(x=>x.verdict==='AYNI_YON').length,wait:active.reanalysis.snapshots.filter(x=>x.verdict==='BEKLE').length,opposite:active.reanalysis.snapshots.filter(x=>x.verdict==='TERS_MAJOR'||x.verdict==='TERS_MINOR').length,total:active.reanalysis.snapshots.length};
 signalState.activeSignals[active.signalId]=active;saveSignalState(signalState);
 console.log(active.symbol,'STRICT HTF RETEST PA RECHECK',snap.no+'/'+REANALYSIS_MAX,verdict);return true
}
function tgEsc(v){return String(v??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}
function tgNum(v){if(v===null||v===undefined||v==='')return '—';const n=Number(v);if(!Number.isFinite(n))return '—';const a=Math.abs(n),d=a>=1000?1:a>=100?2:a>=1?4:a>=0.01?5:7;return n.toLocaleString('en-US',{minimumFractionDigits:d,maximumFractionDigits:d})}
function tgText(setup,commentaryText){
 const rr=finite(setup.riskReward)?Number(setup.riskReward):null,conf=finite(setup.confidence)?'%'+Math.round(Number(setup.confidence)):'—';
 return '<b>'+tgEsc(setup.symbol)+' — '+tgEsc(setup.direction)+'</b>\n'
  +'Zaman: <b>'+tgEsc(setup.timeframe)+'</b> · Piyasa: FUTURES\n'
  +'Güven: <b>'+conf+'</b>'+(Number.isFinite(rr)?' · R/R: <b>'+rr.toFixed(2)+'</b>':'')+'\n\n'
  +'Giriş: <b>'+tgNum(setup.entry)+'</b>\nStop: <b>'+tgNum(setup.stop)+'</b>\n'
  +'TP1: '+tgNum(setup.tp1)+'\nTP2: '+tgNum(setup.tp2)+'\nTP3: '+tgNum(setup.tp3)+'\n\n'
  +tgEsc(String(commentaryText||'ŞAOMİ TRADE AI teknik analiz sinyali.')).slice(0,900)
  +'\n\n<i>Olasılık analizidir; yatırım tavsiyesi değildir.</i>'
}
async function telegram(setup,commentaryText,provider){
 if(TELEGRAM_BOT_TOKEN&&TELEGRAM_CHAT_ID){
   const r=await fetch('https://api.telegram.org/bot'+TELEGRAM_BOT_TOKEN+'/sendMessage',{
     method:'POST',
     headers:{'content-type':'application/json'},
     body:JSON.stringify({
       chat_id:TELEGRAM_CHAT_ID,
       text:tgText(setup,commentaryText),
       parse_mode:'HTML',
       disable_web_page_preview:true
     }),
     signal:AbortSignal.timeout(15000)
   });
   const j=await r.json().catch(()=>({}));
   if(!r.ok||!j.ok)throw new Error(j.description||('Telegram direct HTTP '+r.status));
   return {ok:true,messageId:j?.result?.message_id,mode:'direct-github'}
 }
 if(!TELEGRAM_READY)throw new Error('Telegram all-Futures transport is not ready');
 const r=await fetch(TELEGRAM_SELECTED_ENDPOINT+'/api/telegram',{
   method:'POST',
   headers:{'content-type':'application/json'},
   body:JSON.stringify({
     setup,
     commentary:commentaryText,
     provider,
     riskReward:setup.riskReward,
     mode:'github-pa-v1',
     signalId:setup.signalId
   }),
   signal:AbortSignal.timeout(15000)
 });
 const raw=await r.text();let j={};try{j=JSON.parse(raw)}catch{}
 if(!r.ok||!j.ok)throw new Error((typeof j.error==='string'?j.error:JSON.stringify(j.error))||('Telegram HTTP '+r.status+' '+raw.slice(0,240)));
 return {...j,mode:'vercel-all-futures',endpoint:TELEGRAM_SELECTED_ENDPOINT}
}
async function validateTelegramTransport(state,universe){
 const now=new Date().toISOString();
 const probeSymbol=pickTelegramProbeSymbol(universe);
 if(!probeSymbol){state.telegramTransport={mode:'unavailable',endpoint:null,allFutures:false,validated:false,validatedAt:now,error:'No non-legacy Binance USD-M probe symbol'};saveSignalState(state);return false}
 if(TELEGRAM_BOT_TOKEN&&TELEGRAM_CHAT_ID){
   TELEGRAM_READY=true;
   state.telegramTransport={mode:'direct-github',allFutures:true,validated:true,validatedAt:now,symbolPolicy:TELEGRAM_SYMBOL_POLICY};
   saveSignalState(state);
   console.log('TELEGRAM_TRANSPORT direct-github allFutures=true');
   return true
 }
 const failures=[];
 for(const base of TELEGRAM_ENDPOINT_CANDIDATES){
   try{
     const probeUrl=base+'/api/telegram?symbol='+encodeURIComponent(probeSymbol);
     const r=await fetch(probeUrl,{cache:'no-store',redirect:'manual',signal:AbortSignal.timeout(10000)});
     const raw=await r.text();let j={};try{j=JSON.parse(raw)}catch{}
     const configured=r.ok&&j&&typeof j==='object'&&!Array.isArray(j)&&j.configured===true;
     const legacyWhitelist=Array.isArray(j.allowedSymbols);
     const policyOk=j?.symbolPolicy===TELEGRAM_SYMBOL_POLICY;
     const probeOk=String(j?.probeSymbol||'').toUpperCase()===probeSymbol&&j?.symbolAccepted===true;
     const rootClean=configured&&!legacyWhitelist&&policyOk&&probeOk;
     console.log('TELEGRAM_ENDPOINT_PROBE',base,'http='+r.status,'configured='+configured,'policy='+String(j?.symbolPolicy||'missing'),'probe='+String(j?.probeSymbol||'missing'),'accepted='+String(j?.symbolAccepted),'legacyWhitelist='+legacyWhitelist);
     if(rootClean){
       TELEGRAM_READY=true;
       TELEGRAM_SELECTED_ENDPOINT=base;
       state.telegramTransport={mode:'vercel-binance-usdm-perpetual',endpoint:base,allFutures:true,validated:true,validatedAt:now,symbolPolicy:TELEGRAM_SYMBOL_POLICY,probeSymbol:probeSymbol};
       saveSignalState(state);
       console.log('TELEGRAM_TRANSPORT root-clean endpoint='+base+' probe='+probeSymbol);
       return true
     }
     failures.push(base+':'+(!configured?'not-configured':legacyWhitelist?'legacy-whitelist':!policyOk?'wrong-policy':!probeOk?'probe-rejected':'invalid-config'));
   }catch(e){
     failures.push(base+':'+String(e?.message||e).slice(0,120));
     console.log('TELEGRAM_ENDPOINT_PROBE_FAIL',base,String(e?.message||e).slice(0,140));
   }
 }
 TELEGRAM_READY=false;
 state.telegramTransport={mode:'unavailable',endpoint:null,allFutures:false,validated:false,validatedAt:now,symbolPolicy:TELEGRAM_SYMBOL_POLICY,probeSymbol:probeSymbol,error:failures.join(' | ').slice(0,500)};
 saveSignalState(state);
 console.error('TELEGRAM_TRANSPORT root-clean probe failed',failures.join(' | '));
 return false
}

async function buildSetup(symbol,tf,topDown){
 const base=await candles(symbol,tf);if(base.length<220)return rejectReason('SETUP_LT_220_BARS');
 const last=base.at(-1),age=Date.now()-last.closeTime,maxAge=tfMs(tf)*1.35+120000;if(age>maxAge)return rejectReason('SETUP_STALE_CANDLE');
 const major={...topDown.major,frames:topDown.frames},plan=buildCanonicalTradePlan(symbol,tf,base,major);if(!plan)return null;
 const decision=topDownDecision(plan.direction,topDown);if(!decision.allowed)return rejectReason('SETUP_MAJOR_DIRECTION_MISMATCH');
 const trigger=plan.entryTrigger||{},signalId=symbol+'|futures|'+tf+'|'+plan.direction+'|'+(trigger.type||'PA')+':'+(trigger.time||last.time);
 return{...plan,market:'futures',locked:true,lockedAt:last.time,candleCloseTime:last.closeTime,analysisVersion:ANALYSIS_VERSION,signalId,topDownContext:{...topDown,decision},lowerFrameContext:plan.indicatorContext,mtf:{frames:[tf],status:'STRICT_HTF_RETEST_CONFIRM'}}
}

let sent=0;
const universe=await loadFuturesUniverse();
const telegramReady=await validateTelegramTransport(signalState,universe);
const universeSet=new Set(universe);
const rotationBatch=chooseRotatingBatch(universe,signalState);
const hotLane=await loadHotLane(universe);
const actives=activeSymbols(signalState);
const scanSymbols=[...new Set([...actives,...rotationBatch,...hotLane])];
console.log('SAOMI '+ANALYSIS_VERSION+' scan '+new Date().toISOString()+' · FUTURES universe='+universe.length+' · hotLane='+hotLane.length+' · rotating batch='+rotationBatch.length+' · active extras='+actives.length+' · SIGNAL TF='+BASE_TFS.join(',')+' · HTF='+HTF_ORDER.join('→'));
console.log('HOT',hotLane.join(','));
console.log('BATCH',rotationBatch.join(','));
scanLoop:
for(const symbol of scanSymbols){
 let symbolSent=0;
 try{
  const topDown=await buildTopDownContext(symbol),major=topDown.major;
  console.log(symbol,'MAJOR',major.direction,major.summary,'strength',major.conviction);
  for(const tf of BASE_TFS){
   try{
    const active=activeSignalForSymbol(signalState,symbol,tf);
    if(active){
      await shadowReanalysis(active);
      console.log(symbol,tf,'ACTIVE SIGNAL · no duplicate');
      continue
    }
    const setup=await buildSetup(symbol,tf,topDown);
    if(!setup){console.log(symbol,tf,'WAIT / filter');continue}
    const direction=String(setup.direction||'').toUpperCase();
    const validLevels=[setup.entry,setup.stop,setup.tp1,setup.tp2,setup.tp3].every(finite);
    if(!universeSet.has(String(setup.symbol||'').toUpperCase())||!['LONG','SHORT'].includes(direction)||!validLevels){
      console.error('INVALID_TRADE_SETUP_REJECTED',symbol,tf,{symbol:setup.symbol,direction:setup.direction,entry:setup.entry,stop:setup.stop,tp1:setup.tp1,tp2:setup.tp2,tp3:setup.tp3});
      continue
    }
    const dup=duplicateReason(signalState,setup);
    if(dup){console.log(symbol,tf,'NOT SENT ('+dup+')');continue}
    console.log(symbol,tf,{direction:setup.direction,confidence:setup.confidence,rr:setup.riskReward,major:setup.topDownContext.decision.summary,trend:setup.indicatorContext?.priceAction?.structureTrend,ema200:setup.indicatorContext?.trend?.ema200Side,trigger:setup.entryTrigger?.type});
    const meta={provider:'SAOMI RC5.47 STRICT HTF RETEST PRICE ACTION',commentary:commentary(setup)};
    if(!telegramReady){
      console.log('SIGNAL_READY_TELEGRAM_BLOCKED',symbol,tf,{direction:setup.direction,confidence:setup.confidence,rr:setup.riskReward});
      continue
    }
    const tg=await telegram(setup,meta.commentary,meta.provider);
    rememberSignal(signalState,setup,tg,meta);
    sent++;
    symbolSent++;
    console.log('SENT',symbol,tf,tg,'symbolSent='+symbolSent,'totalSent='+sent);
    if(sent>=MAX_SIGNALS)break scanLoop;
    if(symbolSent>=MAX_SIGNALS_PER_SYMBOL){console.log(symbol,'FAIRNESS LIMIT · next symbol');break}
   }catch(e){console.error('ERROR '+symbol+' '+tf+':',e?.message||e)}
  }
 }catch(e){console.error('HTF ERROR '+symbol+':',e?.message||e)}
}
saveSignalState(signalState);
console.log('SAOMI '+ANALYSIS_VERSION+' finished. Sent: '+sent+' · universe='+universe.length+' · nextCursor='+signalState.scannerUniverse.cursor+' · cycles='+signalState.scannerUniverse.cyclesCompleted);console.log('REJECT_STATS',JSON.stringify(Object.fromEntries(Object.entries(rejectStats).sort((a,b)=>b[1]-a[1]))));
if(!telegramReady)throw new Error('TELEGRAM_TRANSPORT_NOT_READY: production /api/telegram did not pass Binance USD-M TRADING/PERPETUAL root-clean probe; scan completed but delivery gate failed');
