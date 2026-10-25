import fs from 'node:fs';

const BASE='https://saomi-trade-ai.vercel.app';
const STATE='.github/state/saomi-gpt-btc15m-state.json';
const SYMBOL='BTCUSDT';
const INTERVAL='15m';
const MAX_CANDLE_AGE=20*60*1000;
const MODEL=String(process.env.SAOMI_GPT_MODEL||'gpt-6.1-sol').trim();
const KEY=String(process.env.OPENAI_API_KEY||'').trim();
const ENABLED=process.env.SAOMI_GPT_TELEGRAM_ENABLED==='true';
const TOKEN=String(process.env.TELEGRAM_BOT_TOKEN||process.env.TELEGRAM_TOKEN||'').trim();
const CHAT=String(process.env.TELEGRAM_CHANNEL_ID||process.env.TELEGRAM_CHAT_ID||'').trim();

const finite=v=>typeof v==='number'&&Number.isFinite(v);
const round=(v,n=2)=>Math.round(v*10**n)/10**n;
const state=()=>{try{return JSON.parse(fs.readFileSync(STATE,'utf8'))}catch{return{}}};
const save=s=>{fs.mkdirSync('.github/state',{recursive:true});fs.writeFileSync(STATE,JSON.stringify(s,null,2)+'\n')};
function fail(message){console.error('GPT_BTC15M_BLOCKED:',message);process.exitCode=1}
async function load(path){
 const url=BASE+path+'?'+new URLSearchParams({symbol:SYMBOL,interval:INTERVAL,limit:'300'});
 const response=await fetch(url,{signal:AbortSignal.timeout(15000),headers:{'cache-control':'no-cache'}});
 if(!response.ok)throw Error('API HTTP '+response.status+': '+path);
 const data=await response.json();
 if(!data.ok||data.market!=='USD-M FUTURES'||data.stale!==false||data.signalAllowed!==true||data.symbol!==SYMBOL||data.interval!==INTERVAL)
   throw Error('API fail-closed validation: '+path);
 return data;
}
function verify(a,b){
 if(!Array.isArray(b.candles)||b.candles.length<211)throw Error('Insufficient OHLCV');
 const closed=b.candles.filter(x=>x.closed===true);
 if(closed.length<210||a.closedCandleCount!==closed.length)throw Error('Closed candle count mismatch');
 const last=closed.at(-1);
 if(a.lastClosedCandle?.closeTime!==last.closeTime||a.lastClosedCandle?.close!==last.close)
   throw Error('Last closed candle mismatch');
 if(Math.abs(Date.parse(a.fetchedAt)-Date.parse(b.fetchedAt))>30000)throw Error('Dual-API time mismatch');
 if(Date.now()-last.closeTime>MAX_CANDLE_AGE||last.closeTime>Date.now())throw Error('Candle stale/clock discrepancy');
 for(let i=1;i<closed.length;i++)if(closed[i].openTime<=closed[i-1].openTime)throw Error('Unsorted candles');
 if(!a.indicators?.ema||!finite(a.indicators?.rsi14)||!finite(a.indicators?.atr14))
   throw Error('Missing technical indicators');
 return closed;
}
function contexts(c,atr){
 const events=[];
 const start=Math.max(21,c.length-24);
 for(let i=start;i<c.length-1;i++){
   const prior=c.slice(i-20,i);
   const hi=Math.max(...prior.map(x=>x.high));
   const lo=Math.min(...prior.map(x=>x.low));
   const mean=prior.reduce((s,x)=>s+x.volume,0)/prior.length;
   const dir=c[i].close>hi&&c[i-1].close<=hi?'LONG':c[i].close<lo&&c[i-1].close>=lo?'SHORT':null;
   if(!dir)continue;
   const level=dir==='LONG'?hi:lo;
   const after=c.slice(i+1);
   // A true retest must occur after the breakout, with no later full reversal.
   const retests=after.filter(x=>dir==='LONG'?
     x.low<=level+atr*.3&&x.close>=level:
     x.high>=level-atr*.3&&x.close<=level);
   const intact=after.every(x=>dir==='LONG'?x.close>=level-atr*.12:x.close<=level+atr*.12);
   const last=c.at(-1);
   const aligned=dir==='LONG'?last.close>level:last.close<level;
   events.push({direction:dir,level:round(level,5),breakCloseTime:c[i].closeTime,
      breakVolumeRatio:round(c[i].volume/Math.max(mean,1),3),
      retestCount:retests.length,intact,aligned,ageBars:c.length-1-i});
 }
 return events.slice(-15);
}
function schema(){
 const num={type:['number','null']},str={type:'string'};
 return {type:'object',additionalProperties:false,properties:{
   decision:{type:'string',enum:['BEKLE','LONG','SHORT']},
   reasoning:str,structureEvidence:str,momentumEvidence:str,volumeEvidence:str,
   breakoutLevel:num,retestValidated:{type:'boolean'},
   entry:num,stop:num,tp1:num,tp2:num,tp3:num
 },required:['decision','reasoning','structureEvidence','momentumEvidence','volumeEvidence',
 'breakoutLevel','retestValidated','entry','stop','tp1','tp2','tp3']};
}
async function gpt(snapshot){
 const instructions=[
  'Sen ŞAOMİ ORHAN SETUP bağımsız GPT işlem analistisin. Telegram kararını SEN verirsin; eski ŞAOMİ sinyali giriş olarak verilmez.',
  'Sadece sağlanan kapanmış Binance Futures mumlarını ve hesaplanmış göstergeleri kullan. Mum grafiklerini yorumla.',
  '3 BAĞIMSIZ teyit gerekir: (1) kapanışla kırılım, başarılı sonradan yeniden test ve korunan yapı; (2) RSI/MACD/Supertrend uyumlu momentum; (3) kırılım sırasında 20 mumluk ortalamanın en az 1.15 katı yönlü hacim.',
  'recentStructuralBreaks alanındaki doğrulanabilir kırılım/retest yoksa BEKLE. Tek başına EMA kesişimi sinyal değildir.',
  'Entry güncel SON KAPANMIŞ mum fiyatına yakın olmalı. Stop yapısal geçersizlikte olmalı. TP1 dahi giriş-stop riskinin en az 2 katı mesafede olmalı.',
  'Likidite, FVG, OB, BOS veya CHoCH gözlemi veriyle doğrulanamıyorsa gerçekleşmiş gibi yazma.',
  'Uygun setup yoksa BEKLE ver. BEKLE için entry stop tp1 tp2 tp3 breakoutLevel null, retestValidated false.',
  'Sinyal üretmek zorunlu değildir. Garantili kazanç ve yüzdelik başarı iddiası yapma.',
  'Yanıt sadece JSON şemasına uysun. Türkçe kısa ve teknik gerekçeler ver.'
 ].join('\n');
 const request={model:MODEL,instructions,input:JSON.stringify(snapshot),
   text:{format:{type:'json_schema',name:'saomi_gpt_signal',strict:true,schema:schema()}},
   max_output_tokens:1300};
 const r=await fetch('https://api.openai.com/v1/responses',{method:'POST',
   headers:{authorization:'Bearer '+KEY,'content-type':'application/json'},
   body:JSON.stringify(request),signal:AbortSignal.timeout(90000)});
 if(!r.ok)throw Error('OpenAI HTTP '+r.status+' '+(await r.text()).slice(0,240));
 const output=await r.json();
 if(output.status!=='completed')throw Error('OpenAI incomplete response '+String(output.status));
 const txt=(output.output||[]).flatMap(x=>x.content||[]).filter(x=>x.type==='output_text').map(x=>x.text).join('');
 if(!txt)throw Error('OpenAI produced no text');
 const obj=JSON.parse(txt);
 if(!['BEKLE','LONG','SHORT'].includes(obj.decision))throw Error('Invalid GPT decision');
 return obj;
}
function vet(d,a,closed,events){
 const reasons=[];
 if(d.decision==='BEKLE')return {approved:false,reasons:['GPT independently decided BEKLE']};
 const dir=d.decision,atr=a.indicators.atr14,ind=a.indicators,last=closed.at(-1);
 const ev=events.filter(x=>x.direction===dir&&x.retestCount>0&&x.intact&&x.aligned&&
   x.breakVolumeRatio>=1.15&&x.ageBars<=9).at(-1);
 if(!ev)reasons.push('Confirmed recent breakout+retest+volume absent');
 if(!d.retestValidated||!finite(d.breakoutLevel)||!ev||Math.abs(d.breakoutLevel-ev.level)>atr*.3)
   reasons.push('GPT structure claim disagrees with OHLCV evidence');
 const momentum=dir==='LONG'?ind.rsi14>=52&&ind.macd.histogram>0&&ind.supertrend10_3.direction==='UP'&&ind.ema['9']>=ind.ema['21']:
   ind.rsi14<=48&&ind.macd.histogram<0&&ind.supertrend10_3.direction==='DOWN'&&ind.ema['9']<=ind.ema['21'];
 if(!momentum)reasons.push('Independent momentum confirmation fails');
 if(![d.entry,d.stop,d.tp1,d.tp2,d.tp3].every(finite))reasons.push('Incomplete price levels');
 else{
   const risk=Math.abs(d.entry-d.stop);
   if(!(risk>=atr*.3&&risk<=atr*2.5))reasons.push('Invalid ATR stop distance');
   if(Math.abs(d.entry-last.close)>atr*.45)reasons.push('Entry too far from last close');
   if(dir==='LONG'){
     if(!(d.stop<d.entry&&d.entry<d.tp1&&d.tp1<=d.tp2&&d.tp2<=d.tp3))reasons.push('LONG price geometry invalid');
     if(!(d.tp1-d.entry>=2*risk))reasons.push('TP1 RR < 1:2');
   }else{
     if(!(d.stop>d.entry&&d.entry>d.tp1&&d.tp1>=d.tp2&&d.tp2>=d.tp3))reasons.push('SHORT price geometry invalid');
     if(!(d.entry-d.tp1>=2*risk))reasons.push('TP1 RR < 1:2');
   }
 }
 if([d.structureEvidence,d.momentumEvidence,d.volumeEvidence].some(x=>typeof x!=='string'||x.trim().length<12))
   reasons.push('3 independent evidence fields incomplete');
 return {approved:reasons.length===0,reasons,verifiedBreak:ev??null};
}
function esc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}
async function send(d,a,ev){
 if(!TOKEN||!CHAT)throw Error('Telegram secrets missing');
 const dir=d.decision;
 const text=[
  '<b>ŞAOMİ GPT ONAYLI — BTCUSDT 15M '+esc(dir)+'</b>',
  'Kaynak: '+esc(MODEL)+' · Binance USD-M FUTURES',
  'Kapanmış mum: '+new Date(a.lastClosedCandle.closeTime).toISOString(),
  'Giriş planı: <b>'+round(d.entry)+'</b>',
  'STOP: <b>'+round(d.stop)+'</b>',
  'TP1: '+round(d.tp1)+' · TP2: '+round(d.tp2)+' · TP3: '+round(d.tp3),
  'TP1 R/R: '+round(Math.abs(d.tp1-d.entry)/Math.abs(d.entry-d.stop)),
  '',
  'Yapı: '+esc(d.structureEvidence).slice(0,300),
  'Momentum: '+esc(d.momentumEvidence).slice(0,300),
  'Hacim: '+esc(d.volumeEvidence).slice(0,300),
  'GPT kararı: '+esc(d.reasoning).slice(0,500),
  'Kırılım: '+round(ev.level)+' | Hacim x'+ev.breakVolumeRatio,
  '',
  '<i>GPT değerlendirmesidir, kesin kazanç garantisi değildir. Otomatik emir verilmez.</i>'
 ].join('\n');
 const response=await fetch('https://api.telegram.org/bot'+TOKEN+'/sendMessage',{
   method:'POST',headers:{'content-type':'application/json'},
   body:JSON.stringify({chat_id:CHAT,text,parse_mode:'HTML',disable_web_page_preview:true}),
   signal:AbortSignal.timeout(18000)});
 if(!response.ok)throw Error('Telegram HTTP '+response.status+' '+(await response.text()).slice(0,180));
 const data=await response.json();if(!data.ok)throw Error('Telegram did not acknowledge alert');
 return data.result?.message_id??null;
}
async function main(){
 if(!KEY){console.log('GPT_BTC15M_NOT_ENABLED: OPENAI_API_KEY secret missing. Existing scanner unchanged.');return}
 const [analysis,market]=await Promise.all([load('/api/analysis'),load('/api/market')]);
 const closed=verify(analysis,market);
 const last=closed.at(-1),s=state();
 if(s.lastEvaluatedCloseTime===last.closeTime){console.log('Already evaluated this closed 15M candle');return}
 const events=contexts(closed,analysis.indicators.atr14);
 const snapshot={
  symbol:SYMBOL,timeframe:INTERVAL,market:market.market,
  analysisFetchedAt:analysis.fetchedAt,candlesFetchedAt:market.fetchedAt,
  lastClosed:analysis.lastClosedCandle,indicators:analysis.indicators,
  recentStructuralBreaks:events,
  closedCandles:closed.slice(-110).map(x=>[x.openTime,x.open,x.high,x.low,x.close,x.volume])
 };
 const decision=await gpt(snapshot);
 const gate=vet(decision,analysis,closed,events);
 console.log(JSON.stringify({model:MODEL,candleCloseTime:last.closeTime,decision:decision.decision,gate,reasoning:decision.reasoning,sendEnabled:ENABLED},null,2));
 // Never mark a signal as sent unless Telegram confirms delivery.
 if(gate.approved&&ENABLED){
   const messageId=await send(decision,analysis,gate.verifiedBreak);
   console.log('GPT_TELEGRAM_SENT',messageId);
   s.lastSent={closeTime:last.closeTime,direction:decision.decision,messageId};
 }
 s.lastEvaluatedCloseTime=last.closeTime;
 s.lastDecision=decision.decision;
 s.lastGateApproved=gate.approved;
 s.updatedAt=new Date().toISOString();
 save(s);
}
main().catch(e=>fail(e instanceof Error?e.message:String(e)));
