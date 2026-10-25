import fs from 'node:fs';
// SAOMI FREE: zero paid LLM/API dependencies. This rules engine is NOT GPT.
const BASE='https://saomi-trade-ai.vercel.app';
const PATH='.github/state/saomi-free-btc15m-state.json';
const MANUAL=process.env.SAOMI_FREE_RUN_ONCE==='true';
const MONITOR=process.env.SAOMI_FREE_MONITOR_ENABLED==='true';
const SEND=process.env.SAOMI_FREE_TELEGRAM_ENABLED==='true'&&!MANUAL;
const TOKEN=(process.env.TELEGRAM_BOT_TOKEN||process.env.TELEGRAM_TOKEN||'').trim();
const CHAT=(process.env.TELEGRAM_CHANNEL_ID||process.env.TELEGRAM_CHAT_ID||'').trim();
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const round=(x,n=2)=>Math.round(x*10**n)/10**n;
function state(){try{return JSON.parse(fs.readFileSync(PATH,'utf8'))}catch{return{}}}
function persist(s){fs.mkdirSync('.github/state',{recursive:true});fs.writeFileSync(PATH,JSON.stringify(s,null,2)+'\n')}
async function fetchData(path){
 const q=new URLSearchParams({symbol:'BTCUSDT',interval:'15m',limit:'300'});
 const r=await fetch(BASE+path+'?'+q,{cache:'no-store',signal:AbortSignal.timeout(15000)});
 if(!r.ok)throw Error(path+' HTTP '+r.status);
 const x=await r.json();
 if(!x.ok||x.symbol!=='BTCUSDT'||x.interval!=='15m'||x.market!=='USD-M FUTURES'||x.stale!==false||x.signalAllowed!==true)
  throw Error('Invalid market data '+path);
 return x;
}
export function verify(a,b,now=Date.now()){
 if(!Array.isArray(b.candles)||b.candles.length<211)throw Error('Insufficient candles');
 const c=b.candles.filter(x=>x.closed===true),last=c.at(-1);
 if(c.length<210||a.closedCandleCount!==c.length||a.lastClosedCandle?.closeTime!==last.closeTime||a.lastClosedCandle?.close!==last.close)
  throw Error('Closed candles disagree');
 if(Math.abs(Date.parse(a.fetchedAt)-Date.parse(b.fetchedAt))>30000)throw Error('API snapshot times disagree');
 if(last.closeTime>now||now-last.closeTime>20*60000)throw Error('Last closed candle stale');
 for(let i=1;i<c.length;i++)if(c[i].openTime!==c[i-1].openTime+900000||c[i].closeTime!==c[i].openTime+899999)
  throw Error('Candles have missing or malformed intervals');
 const d=a.indicators;
 if(!finite(d?.atr14)||!finite(d?.rsi14)||!finite(d?.volume20Average)||!finite(d?.macd?.histogram)||
  !finite(d?.ema?.['9'])||!finite(d?.ema?.['21'])||!['UP','DOWN'].includes(d?.supertrend10_3?.direction))
  throw Error('Missing technical indicators');
 return c;
}
export function evaluate(c,d){
 if(c.length<210||!finite(d.atr14)||d.atr14<=0)return {decision:'BEKLE',reason:'History or ATR unavailable'};
 const n=c.length,atr=d.atr14,last=c.at(-1),events=[];
 for(let i=Math.max(21,n-14);i<n-1;i++){
  const prev=c.slice(i-20,i),bar=c[i],p=c[i-1];
  const hi=Math.max(...prev.map(x=>x.high)),lo=Math.min(...prev.map(x=>x.low));
  const volAvg=prev.reduce((s,x)=>s+x.volume,0)/20;
  for(const direction of ['LONG','SHORT']){
   const level=direction==='LONG'?hi:lo;
   const broke=direction==='LONG'?bar.close>hi+atr*.06&&p.close<=hi&&bar.close>bar.open:
    bar.close<lo-atr*.06&&p.close>=lo&&bar.close<bar.open;
   if(!broke||bar.volume<1.2*volAvg)continue;
   const after=c.slice(i+1),retest=[];
   for(let j=i+1;j<n;j++){
    const b=c[j];
    if(direction==='LONG'&&b.low<=level+atr*.2&&b.close>=level+atr*.02)retest.push(j);
    if(direction==='SHORT'&&b.high>=level-atr*.2&&b.close<=level-atr*.02)retest.push(j);
   }
   if(!retest.length||n-1-retest.at(-1)>2)continue;
   if(!after.every(x=>direction==='LONG'?x.close>level-atr*.12:x.close<level+atr*.12))continue;
   if(direction==='LONG'?last.close<=level+atr*.06:last.close>=level-atr*.06)continue;
   events.push({direction,level,at:bar.closeTime,index:i,ratio:bar.volume/volAvg,
    low:Math.min(...after.map(x=>x.low)),high:Math.max(...after.map(x=>x.high))});
  }
 }
 if(!events.length)return {decision:'BEKLE',reason:'No recent high-volume breakout followed by confirmed retest'};
 const e=events.at(-1),direction=e.direction;
 const momentum=direction==='LONG'?d.rsi14>=52&&d.rsi14<=72&&d.macd.histogram>0&&d.supertrend10_3.direction==='UP'&&d.ema['9']>d.ema['21']:
  d.rsi14<=48&&d.rsi14>=28&&d.macd.histogram<0&&d.supertrend10_3.direction==='DOWN'&&d.ema['9']<d.ema['21'];
 const volume=e.ratio>=1.2&&last.volume>=d.volume20Average*.65;
 const entry=last.close,stop=direction==='LONG'?Math.min(e.level-atr*.2,e.low)-atr*.1:Math.max(e.level+atr*.2,e.high)+atr*.1;
 const risk=Math.abs(entry-stop);
 const reason=[];
 if(!momentum)reason.push('RSI/MACD/Supertrend/EMA not aligned');
 if(!volume)reason.push('Volume not confirmed');
 if(risk<atr*.35||risk>atr*2)reason.push('Invalid structure-based stop');
 if(Math.abs(entry-e.level)>atr*1.3)reason.push('Entry too far from retest');
 const tp1=direction==='LONG'?entry+2*risk:entry-2*risk;
 const tp2=direction==='LONG'?entry+3*risk:entry-3*risk;
 const tp3=direction==='LONG'?entry+4*risk:entry-4*risk;
 if(tp3<=0)reason.push('Nonpositive target');
 const old=c.slice(Math.max(0,e.index-70),e.index-20);
 const barriers=old.flatMap(x=>direction==='LONG'&&x.high>entry+atr*.05?[x.high]:
  direction==='SHORT'&&x.low<entry-atr*.05?[x.low]:[]);
 if(barriers.length&&(direction==='LONG'?Math.min(...barriers)<tp1:Math.max(...barriers)>tp1))
  reason.push('Opposing prior structure ahead of TP1');
 if(reason.length)return {decision:'BEKLE',reason:reason.join('; '),checks:{structure:true,momentum,volume}};
 return {decision:direction,reason:'Breakout + retest, aligned momentum, and volume independently confirmed',
  breakTime:e.at,level:round(e.level),entry:round(entry),stop:round(stop),tp1:round(tp1),tp2:round(tp2),
  tp3:round(tp3),riskReward:2,volumeRatio:round(e.ratio),checks:{structure:true,momentum:true,volume:true}};
}
async function telegram(d,last){
 if(!TOKEN||!CHAT)throw Error('Telegram secrets missing');
 const t=['<b>ŞAOMİ ÜCRETSİZ KURAL MOTORU — BTCUSDT 15M '+d.decision+'</b>',
  'Not: Bu sinyal GPT tarafından üretilmemiştir. Ücretsiz Orhan Setup kurallarıyla hesaplanmıştır.',
  'Son kapanmış mum: '+new Date(last.closeTime).toISOString(),
  'Kırılım: '+d.level+' | Hacim x'+d.volumeRatio,
  'Giriş: '+d.entry+' | STOP: '+d.stop,
  'TP1: '+d.tp1+' | TP2: '+d.tp2+' | TP3: '+d.tp3,
  'Teyitler: kapanış+kırılım+yeniden test, momentum, hacim; TP1 R/R 1:2',
  'Bu bir olasılık değerlendirmesidir; emir gönderilmedi.'].join('\n');
 const r=await fetch('https://api.telegram.org/bot'+TOKEN+'/sendMessage',{
  method:'POST',headers:{'content-type':'application/json'},
  body:JSON.stringify({chat_id:CHAT,text:t,parse_mode:'HTML',disable_web_page_preview:true}),
  signal:AbortSignal.timeout(15000)});
 if(!r.ok)throw Error('Telegram HTTP '+r.status);
 const j=await r.json();if(!j.ok)throw Error('Telegram did not confirm delivery');
 return j.result?.message_id??null;
}
async function main(){
 if(!MONITOR&&!MANUAL){console.log('SAOMI_FREE_DISABLED (no paid API calls)');return}
 const [a,b]=await Promise.all([fetchData('/api/analysis'),fetchData('/api/market')]);
 const c=verify(a,b),last=c.at(-1),decision=evaluate(c,a.indicators),prior=state();
 console.log('SAOMI_FREE_RESULT',JSON.stringify({symbol:'BTCUSDT',interval:'15m',closedCount:c.length,
  candleTime:new Date(last.closeTime).toISOString(),decision,telegramEnabled:SEND}));
 if(!SEND||decision.decision==='BEKLE'){console.log('SAOMI_FREE_SHADOW_OR_WAIT: no alert');return}
 const key=decision.decision+'|'+decision.breakTime;
 if(prior.lastSent?.key===key){console.log('SAOMI_FREE_DEDUPED',key);return}
 const messageId=await telegram(decision,last);
 persist({lastEvaluatedCloseTime:last.closeTime,lastSent:{key,messageId,at:new Date().toISOString()}});
 console.log('SAOMI_FREE_TELEGRAM_SENT',messageId);
}
if(process.argv[1]&&import.meta.url==='file://'+process.argv[1])
 main().catch(e=>{console.error('SAOMI_FREE_ERROR',e.message);process.exitCode=1});
