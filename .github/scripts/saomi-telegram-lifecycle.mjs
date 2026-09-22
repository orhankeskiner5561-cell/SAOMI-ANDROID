import fs from 'node:fs';

const TELEGRAM_PUBLIC='https://saomi-trade-ai.vercel.app';
const LEGACY_TELEGRAM_SYMBOLS=new Set(['BTCUSDT','ETHUSDT','XRPUSDT','SOLUSDT','BNBUSDT','DOGEUSDT','ADAUSDT']);
const TELEGRAM_SYMBOL_POLICY='binance-usdm-trading-perpetual';
const TELEGRAM_ENDPOINT_CANDIDATES=[TELEGRAM_PUBLIC];
let TELEGRAM_SELECTED_ENDPOINT=TELEGRAM_PUBLIC;
let TELEGRAM_READY=false;
const TELEGRAM_BOT_TOKEN=String(process.env.TELEGRAM_BOT_TOKEN||process.env.TELEGRAM_TOKEN||'').trim();
const TELEGRAM_CHAT_ID=String(process.env.TELEGRAM_CHANNEL_ID||process.env.TELEGRAM_CHAT_ID||'').trim();
const FUTURES='https://www.binance.com';
const STATE_PATH='.github/state/saomi-telegram-state.json';
const TRACKED_TFS=['1m','5m','15m','30m','1h','4h'];
const ORHAN_ANALYSIS_VERSION='RC5.48_ORHAN_SR_BREAKOUT_CONFIRM';
const ORHAN_SIGNAL_TAG='ORHAN_SR_BREAKOUT_CONFIRM';
function isOrhanSignal(sig){
  return String(sig?.analysisVersion||'')===ORHAN_ANALYSIS_VERSION &&
    String(sig?.signalId||'').includes('|'+ORHAN_SIGNAL_TAG+':');
}
const PENDING_EXPIRY_BY_TF={
  '1m':20*60*1000,
  '5m':60*60*1000,
  '15m':3*60*60*1000,
  '30m':6*60*60*1000,
  '1h':12*60*60*1000,
  '4h':48*60*60*1000
};
const ACTIVE_EXPIRY_BY_TF={
  '1m':6*60*60*1000,
  '5m':12*60*60*1000,
  '15m':24*60*60*1000,
  '30m':36*60*60*1000,
  '1h':72*60*60*1000,
  '4h':7*24*60*60*1000
};
const pendingExpiryMs=tf=>PENDING_EXPIRY_BY_TF[String(tf||'15m').toLowerCase()]??12*60*60*1000;
const activeExpiryMs=tf=>ACTIVE_EXPIRY_BY_TF[String(tf||'15m').toLowerCase()]??72*60*60*1000;
const MAX_HISTORY=500;

function finite(v){return v!==null&&v!==undefined&&v!==''&&Number.isFinite(Number(v))}
function iso(ms){return new Date(ms).toISOString()}
function fmtPrice(v){
  if(v===null||v===undefined||v==='')return'—';
  const n=Number(v);if(!Number.isFinite(n))return'—';
  const a=Math.abs(n),d=a>=1000?1:a>=100?2:a>=1?4:a>=.1?5:7;
  return n.toFixed(d).replace(/0+$/,'').replace(/\.$/,'')
}
function entryFilledAtPrice(sig,p){return sig.direction==='LONG'?p<=sig.entry:p>=sig.entry}
function stageAtPrice(sig,p){
  if(sig.direction==='LONG'){
    if(p>=sig.tp3)return 3;if(p>=sig.tp2)return 2;if(p>=sig.tp1)return 1;
  }else{
    if(p<=sig.tp3)return 3;if(p<=sig.tp2)return 2;if(p<=sig.tp1)return 1;
  }
  return 0
}
function protectiveStop(sig,stage=sig.stage||0){
 const original=finite(sig.initialStop)?Number(sig.initialStop):Number(sig.stop);
 if(Number(stage)>=2)return Number(sig.tp1);
 if(Number(stage)>=1)return Number(sig.entry);
 return original
}
function stopAtPrice(sig,p,stage=sig.stage||0){const stop=protectiveStop(sig,stage);return sig.direction==='LONG'?p<=stop:p>=stop}
async function aggregateTrades(symbol,startMs,endMs){
  const rows=[];let first=true,fromId=null;
  for(let page=0;page<8;page++){
    let url;
    if(first){
      url=`${FUTURES}/fapi/v1/aggTrades?symbol=${encodeURIComponent(symbol)}&startTime=${Math.max(0,Math.floor(startMs))}&endTime=${Math.floor(endMs)}&limit=1000`;
      first=false;
    }else{
      url=`${FUTURES}/fapi/v1/aggTrades?symbol=${encodeURIComponent(symbol)}&fromId=${fromId}&limit=1000`;
    }
    const r=await fetch(url);
    if(!r.ok)throw new Error(`${symbol} aggTrades HTTP ${r.status}`);
    const d=await r.json();
    if(!Array.isArray(d)||!d.length)break;
    for(const x of d){
      const time=Number(x.T),price=Number(x.p),id=Number(x.a);
      if(time>=startMs&&time<=endMs&&Number.isFinite(price))rows.push({time,price,id});
    }
    const last=d.at(-1),lastTime=Number(last?.T),lastId=Number(last?.a);
    if(!Number.isFinite(lastId)||d.length<1000||lastTime>endMs)break;
    fromId=lastId+1;
  }
  const uniq=new Map(rows.map(x=>[x.id,x]));
  return [...uniq.values()].sort((a,b)=>a.time-b.time||a.id-b.id)
}
async function resolveSequence(sig,c,startMs,enteredInitially=false,stageInitially=0){
  const trades=await aggregateTrades(sig.symbol,Math.max(startMs,c.openTime),c.closeTime);
  if(!trades.length)return null;
  let entered=enteredInitially,entryTime=enteredInitially?Date.parse(sig.enteredAt||startMs):null,stage=stageInitially;
  const stageEvents=[];
  for(const t of trades){
    if(!entered){
      if(!entryFilledAtPrice(sig,t.price))continue;
      entered=true;entryTime=t.time;
    }
    if(stopAtPrice(sig,t.price,stage))return{entered,entryTime,stage,stageEvents,terminal:'STOP',time:t.time,price:t.price,stopPrice:protectiveStop(sig,stage)};
    const ns=stageAtPrice(sig,t.price);
    if(ns>stage){
      for(let s=stage+1;s<=ns;s++)stageEvents.push({stage:s,time:t.time,price:s===1?sig.tp1:s===2?sig.tp2:sig.tp3});
      stage=ns;
      if(stage===3)return{entered,entryTime,stage,stageEvents,terminal:'TP3',time:t.time,price:t.price};
    }
  }
  return{entered,entryTime,stage,stageEvents,terminal:null,time:trades.at(-1).time,price:trades.at(-1).price}
}
function loadState(){
  let state;
  try{state=JSON.parse(fs.readFileSync(STATE_PATH,'utf8'))}catch{state={}}
  state.version=8;
  state.signals=state.signals||{};
  state.activeSignals=state.activeSignals||{};
  state.history=Array.isArray(state.history)?state.history:[];
  return state
}
function saveState(state){
  state.version=8;
  fs.mkdirSync('.github/state',{recursive:true});
  fs.writeFileSync(STATE_PATH,JSON.stringify(state,null,2)+'\n');
}
async function minuteCandles(symbol,startMs){
  const out=[];
  let cursor=Math.max(0,Math.floor(startMs)-60_000);
  const end=Date.now();
  for(let page=0;page<12 && cursor<end;page++){
    const url=`${FUTURES}/fapi/v1/klines?symbol=${encodeURIComponent(symbol)}&interval=1m&startTime=${cursor}&limit=1000`;
    const r=await fetch(url);
    if(!r.ok)throw new Error(`${symbol} lifecycle Binance HTTP ${r.status}`);
    const d=await r.json();
    if(!Array.isArray(d)||!d.length)break;
    for(const k of d){
      const row={openTime:Number(k[0]),open:Number(k[1]),high:Number(k[2]),low:Number(k[3]),close:Number(k[4]),closeTime:Number(k[6])};
      if(row.closeTime>=startMs-60_000)out.push(row);
    }
    const last=Number(d.at(-1)?.[6]||0);
    if(!last||d.length<1000)break;
    cursor=last+1;
  }
  const uniq=new Map(out.map(x=>[x.openTime,x]));
  return [...uniq.values()].sort((a,b)=>a.openTime-b.openTime);
}
function touched(c,price){return c.low<=price&&c.high>=price}
function targetStage(sig,c){
  if(sig.direction==='LONG'){
    if(c.high>=sig.tp3)return 3;
    if(c.high>=sig.tp2)return 2;
    if(c.high>=sig.tp1)return 1;
  }else{
    if(c.low<=sig.tp3)return 3;
    if(c.low<=sig.tp2)return 2;
    if(c.low<=sig.tp1)return 1;
  }
  return 0
}
function stopHit(sig,c){
  const stop=protectiveStop(sig,sig.stage||0);
  return sig.direction==='LONG'?c.low<=stop:c.high>=stop
}
function reanalysisSummaryText(sig){
  const s=sig?.reanalysis?.summary;
  if(!s?.total)return 'Yeniden analiz testi: henüz kontrol oluşmadı.';
  return `Yeniden analiz testi: ${s.total}/3 kontrol · aynı yön ${s.same||0} · BEKLE ${s.wait||0} · ters ${s.opposite||0}.`
}
function htfSummaryText(sig){const s=sig?.topDownContext?.decision?.summary;return s?` HTF: ${s}.`:''}
function stageText(stage){return stage>=2?'TP1 ve TP2 görüldü':stage===1?'TP1 görüldü':'hedef görülmedi'}
function levelsText(sig){return `Giriş ${fmtPrice(sig.entry)} · STOP ${fmtPrice(protectiveStop(sig,sig.stage||0))} · TP1 ${fmtPrice(sig.tp1)} · TP2 ${fmtPrice(sig.tp2)} · TP3 ${fmtPrice(sig.tp3)}`}
function eventSetup(sig,event){
  return {
    symbol:sig.symbol,market:'futures',timeframe:sig.timeframe||'15m',
    direction:sig.direction,confidence:finite(sig.confidence)?Number(sig.confidence):null,quality:'TAKİP',
    price:event.price??sig.entry,entry:sig.entry,stop:sig.stop,
    tp1:sig.tp1,tp2:sig.tp2,tp3:sig.tp3,riskReward:sig.riskReward??3,
    analysisVersion:sig.analysisVersion||null,topDownContext:sig.topDownContext||null,lowerFrameContext:sig.lowerFrameContext||null,
    signalId:sig.signalId
  }
}
function tgEsc(v){return String(v??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}
function lifecycleText(sig,event){
  const conf=finite(sig.confidence)?'%'+Math.round(Number(sig.confidence)):'—';
  return '<b>'+tgEsc(sig.symbol)+' — '+tgEsc(sig.direction)+'</b>\n'
    +'Zaman: <b>'+tgEsc(sig.timeframe||'15m')+'</b> · TAKİP\n'
    +'Güven: <b>'+conf+'</b>\n\n'
    +tgEsc(('TAKİP — AYNI SİNYAL · '+event.text+htfSummaryText(sig)).trim())+'\n\n'
    +tgEsc(levelsText(sig));
}
async function liveNonLegacyProbeSymbol(){
  const r=await fetch(FUTURES+'/fapi/v1/exchangeInfo',{cache:'no-store',signal:AbortSignal.timeout(10000)});
  if(!r.ok)throw new Error('Binance exchangeInfo probe HTTP '+r.status);
  const j=await r.json();
  const symbol=(j.symbols||[]).filter(x=>x?.status==='TRADING'&&x?.contractType==='PERPETUAL'&&x?.symbol).map(x=>String(x.symbol).toUpperCase()).find(x=>!LEGACY_TELEGRAM_SYMBOLS.has(x));
  if(!symbol)throw new Error('No non-legacy Binance USD-M probe symbol');
  return symbol
}
async function resolveTelegramEndpoint(){
  const probeSymbol=await liveNonLegacyProbeSymbol();
  if(TELEGRAM_READY)return TELEGRAM_SELECTED_ENDPOINT;
  const failures=[];
  for(const base of TELEGRAM_ENDPOINT_CANDIDATES){
    try{
      const r=await fetch(base+'/api/telegram?symbol='+encodeURIComponent(probeSymbol),{cache:'no-store',redirect:'manual',signal:AbortSignal.timeout(10000)});
      const raw=await r.text();let j={};try{j=JSON.parse(raw)}catch{}
      const configured=r.ok&&j&&typeof j==='object'&&!Array.isArray(j)&&j.configured===true;
      const legacyWhitelist=Array.isArray(j.allowedSymbols);
      const policyOk=j?.symbolPolicy===TELEGRAM_SYMBOL_POLICY;
      const probeOk=String(j?.probeSymbol||'').toUpperCase()===probeSymbol&&j?.symbolAccepted===true;
      if(configured&&!legacyWhitelist&&policyOk&&probeOk){
        TELEGRAM_SELECTED_ENDPOINT=base;
        TELEGRAM_READY=true;
        console.log('LIFECYCLE_TELEGRAM_TRANSPORT root-clean endpoint='+base+' probe='+probeSymbol);
        return base
      }
      failures.push(base+':'+(!configured?'not-configured':legacyWhitelist?'legacy-whitelist':!policyOk?'wrong-policy':!probeOk?'probe-rejected':'invalid-config'));
    }catch(e){
      failures.push(base+':'+String(e?.message||e).slice(0,120));
    }
  }
  throw new Error('No root-clean Binance USD-M lifecycle Telegram endpoint: '+failures.join(' | '))
}
async function notify(sig,event){
  const setup=eventSetup(sig,event);
  const endpoint=await resolveTelegramEndpoint();
  const r=await fetch(endpoint+'/api/telegram',{
    method:'POST',
    headers:{'content-type':'application/json'},
    body:JSON.stringify({
      setup,
      commentary:`TAKİP — AYNI SİNYAL · ${event.text}${htfSummaryText(sig)}`.trim(),
      provider:'ŞAOMİ TAKİP',
      riskReward:sig.riskReward??3,
      mode:'github-lifecycle',
      signalId:setup.signalId,
      lifecycle:{
        eventType:String(event.type||'').toUpperCase(),
        status:String(event.type||'').toUpperCase()==='ENTRY'?'ACTIVE':String(event.type||'').toUpperCase(),
        stage:String(event.type||'').toUpperCase()==='TP1'?1:String(event.type||'').toUpperCase()==='TP2'?2:String(event.type||'').toUpperCase()==='TP3'?3:Number(sig.stage||0),
        result:['TP3','STOP','EXPIRED','CANCELLED','AMBIGUOUS'].includes(String(event.type||'').toUpperCase())?String(event.type||'').toUpperCase():null,
        enteredAt:String(event.type||'').toUpperCase()==='ENTRY'?new Date(Number(event.time)).toISOString():(sig.enteredAt||null),
        closedAt:['TP3','STOP','EXPIRED','CANCELLED','AMBIGUOUS'].includes(String(event.type||'').toUpperCase())?new Date(Number(event.time)).toISOString():null,
        currentPrice:event.price??null
      }
    }),
    signal:AbortSignal.timeout(15000)
  });
  const raw=await r.text();let j={};try{j=JSON.parse(raw)}catch{}
  if(!r.ok||!j.ok)throw new Error((typeof j.error==='string'?j.error:JSON.stringify(j.error))||('Telegram lifecycle HTTP '+r.status+' '+raw.slice(0,180)));
  return {...j,mode:'vercel'}
}
async function notifyOnce(sig,key,event){
  if(key&&sig.notified?.[key])return true;
  try{
    await notify(sig,event);
    if(key)sig.notified[key]=true;
    sig.lastDeliveryError=null;
    return true
  }catch(e){
    sig.lastDeliveryError={
      at:new Date().toISOString(),
      event:event?.type||key||'UNKNOWN',
      message:String(e?.message||e).slice(0,220)
    };
    console.error(sig.symbol,event?.type||key||'telegram','delivery failed:',e?.message||e);
    return false
  }
}
async function syncTrackerRecord(sig,statusOverride=null){
  if(!sig?.signalId)return false;
  const rawStatus=String(statusOverride||sig.status||sig.result||'WAIT_ENTRY').toUpperCase();
  const terminalMap={STOP_AFTER_TP1:'STOP',STOP_AFTER_TP2:'STOP',EXPIRED_CANCELLED:'EXPIRED-CANCELLED'};
  const status=terminalMap[rawStatus]||rawStatus;
  const allowed=new Set(['WAIT_ENTRY','ACTIVE','TP1','TP2','TP3','STOP','AMBIGUOUS','EXPIRED','CANCELLED','EXPIRED-CANCELLED']);
  if(!allowed.has(status))return false;
  const terminal=new Set(['TP3','STOP','AMBIGUOUS','EXPIRED','CANCELLED','EXPIRED-CANCELLED']);
  const body={
    mode:'github-lifecycle',
    signalId:sig.signalId,
    signal:{
      ...sig,
      signalId:sig.signalId,
      market:'futures',
      status:rawStatus,
      stage:Number(sig.maxStage??sig.finalStage??sig.stage??0)||0
    },
    status,
    stage:Number(sig.maxStage??sig.finalStage??sig.stage??0)||0,
    result:terminal.has(status)?String(sig.result||status):null,
    enteredAt:sig.enteredAt||null,
    closedAt:terminal.has(status)?(sig.closedAt||null):null,
    expiryKind:sig.expiryKind||null,
    currentPrice:finite(sig.currentPrice)?Number(sig.currentPrice):null
  };
  try{
    const res=await fetch(TELEGRAM_PUBLIC+'/api/tracker',{
      method:'POST',
      headers:{'content-type':'application/json'},
      body:JSON.stringify(body),
      signal:AbortSignal.timeout(12000)
    });
    const raw=await res.text();
    if(!res.ok){
      console.error(sig.symbol,'tracker sync failed',res.status,raw.slice(0,160));
      return false;
    }
    return true;
  }catch(e){
    console.error(sig.symbol,'tracker sync error',String(e?.message||e).slice(0,160));
    return false;
  }
}
async function reconcileTrackerFromState(state){
  const active=Object.values(state?.activeSignals||{}).filter(Boolean);
  const history=Array.isArray(state?.history)?state.history.slice(-160):[];
  let ok=0,fail=0;
  for(const sig of active){
    if(await syncTrackerRecord(sig,sig.status))ok++;else fail++;
  }
  for(const sig of history){
    if(await syncTrackerRecord(sig,sig.status||sig.result))ok++;else fail++;
  }
  console.log('TRACKER_RECONCILE ok='+ok+' fail='+fail+' active='+active.length+' historyChecked='+history.length);
}

function closeSignal(state,id,sig,result,closedAt,extra={}){
  state.history.push({
    ...sig,
    result,
    closedAt:iso(closedAt),
    finalStage:sig.stage||0,
    ...extra
  });
  if(state.history.length>MAX_HISTORY)state.history=state.history.slice(-MAX_HISTORY);
  delete state.activeSignals[id];
}
function statsForRows(historyRows,activeRows){
  const h=historyRows||[],active=activeRows||[];
  const scored=h.filter(x=>x.result==='TP3'||String(x.result).startsWith('STOP'));
  const wins=scored.filter(x=>x.result==='TP3').length;
  const losses=scored.length-wins;
  const milestoneRows=[...h,...active];
  const tp1=milestoneRows.filter(x=>(x.maxStage??x.finalStage??x.stage??0)>=1).length;
  const tp2=milestoneRows.filter(x=>(x.maxStage??x.finalStage??x.stage??0)>=2).length;
  const tp3=h.filter(x=>x.result==='TP3').length;
  const expiredRows=h.filter(x=>x.result==='EXPIRED');
  const expiredBeforeEntry=expiredRows.filter(x=>!x.enteredAt&&Number(x.maxStage??x.finalStage??x.stage??0)===0).length;
  const expiredAfterEntry=expiredRows.length-expiredBeforeEntry;
  return{
    scoredTrades:scored.length,wins,losses,
    winRate:scored.length?Number((wins/scored.length*100).toFixed(2)):null,
    tp1Reached:tp1,tp2Reached:tp2,tp3Reached:tp3,
    stopAfterTp1:h.filter(x=>x.result==='STOP_AFTER_TP1').length,
    stopAfterTp2:h.filter(x=>x.result==='STOP_AFTER_TP2').length,
    ambiguous:h.filter(x=>x.result==='AMBIGUOUS').length,
    expired:expiredRows.length,expiredBeforeEntry,expiredAfterEntry,
    active:active.length,
    waitingEntry:active.filter(x=>x.status==='WAIT_ENTRY').length,
    inTrade:active.filter(x=>['ACTIVE','TP1','TP2'].includes(String(x.status||'ACTIVE'))||x.enteredAt).length
  }
}
function performance(state){
  const h=state.history||[];
  const active=Object.values(state.activeSignals||{});
  const all=statsForRows(h,active);
  const byTimeframe={};
  for(const tf of TRACKED_TFS){
    byTimeframe[tf]=statsForRows(
      h.filter(x=>String(x.timeframe||'15m').toLowerCase()===tf),
      active.filter(x=>String(x.timeframe||'15m').toLowerCase()===tf)
    );
  }
  return {updatedAt:new Date().toISOString(),...all,byTimeframe}
}

const state=loadState();
let changed=false;

// SOURCE GATE: old/legacy setup records are retired silently.
// They must never produce ENTRY/TP/STOP/EXPIRED Telegram events after Orhan setup activation.
for(const [legacyId,legacySig] of Object.entries(state.activeSignals||{})){
  if(isOrhanSignal(legacySig)) continue;
  state.history.push({
    ...legacySig,
    status:'CANCELLED',
    result:'CANCELLED',
    closedAt:new Date().toISOString(),
    expiryKind:'LEGACY_SETUP_RETIRED',
    retiredBy:'RC5.54_ORHAN_ONLY_SOURCE_GATE'
  });
  delete state.activeSignals[legacyId];
  changed=true;
  console.log('LEGACY_SETUP_RETIRED',legacySig?.symbol,legacySig?.timeframe,legacySig?.signalId,legacySig?.analysisVersion);
}
if(state.history.length>MAX_HISTORY) state.history=state.history.slice(-MAX_HISTORY);
const entries=Object.entries(state.activeSignals||{});
console.log(`ŞAOMİ lifecycle başladı. Aktif kayıt: ${entries.length}`);

for(const [id,sig] of entries){
  try{
    if(!sig?.symbol||!finite(sig.entry)||!finite(sig.stop)||!finite(sig.tp1)||!finite(sig.tp2)||!finite(sig.tp3)){
      console.log(id,'geçersiz kayıt, atlandı');
      continue;
    }
    sig.entry=Number(sig.entry);sig.stop=Number(sig.stop);sig.tp1=Number(sig.tp1);sig.tp2=Number(sig.tp2);sig.tp3=Number(sig.tp3);if(!finite(sig.initialStop))sig.initialStop=sig.stop;
    sig.stage=Number(sig.stage||0);
    sig.status=sig.status||'WAIT_ENTRY';
    sig.notified=sig.notified||{entry:false,tp1:false,tp2:false,tp3:false,stop:false,ambiguous:false};

    const sentMs=Date.parse(sig.sentAt||0);
    if(!Number.isFinite(sentMs)){console.log(sig.symbol,'sentAt geçersiz');continue}
    const pendingDeadline=sentMs+pendingExpiryMs(sig.timeframe);

    const candles=await minuteCandles(sig.symbol,sentMs);
    if(!candles.length){console.log(sig.symbol,'1m veri yok · durum değiştirilmedi');continue}

    let startIndex=0,closed=false;
    if(sig.status==='WAIT_ENTRY'){
      let entryResolved=null,entryIndex=-1;
      for(let i=0;i<candles.length;i++){
        const cand=candles[i];
        if(cand.closeTime<sentMs||cand.openTime>pendingDeadline)continue;
        const fillPossible=sig.direction==='LONG'?cand.low<=sig.entry:cand.high>=sig.entry;
        if(!fillPossible)continue;
        const seq=await resolveSequence(sig,cand,Math.max(sentMs,cand.openTime),false,0).catch(e=>{console.error(sig.symbol,'agg entry sequence',e.message);return null});
        if(seq?.entered){entryResolved=seq;entryIndex=i;break}
      }
      if(!entryResolved){
        if(Date.now()>pendingDeadline){
          sig.status='EXPIRED';
          const ev={type:'EXPIRED',time:pendingDeadline,price:sig.entry,text:`⌛ ${sig.symbol} ${sig.timeframe||'15m'} sinyali girişe temas etmeden süresi doldu. İşlem alınmadı; doğruluk/başarı hesabına dahil edilmedi.`};
          await notifyOnce(sig,null,ev);
          closeSignal(state,id,sig,'EXPIRED',pendingDeadline,{maxStage:0,expiryKind:'NO_ENTRY_TIMEOUT',status:'EXPIRED'});
          changed=true;
        }else console.log(sig.symbol,'giriş bekliyor');
        continue;
      }

      sig.status='ACTIVE';sig.enteredAt=iso(entryResolved.entryTime);sig.entryCandleOpenTime=candles[entryIndex].openTime;changed=true;
      if(!sig.notified.entry){
        const ev={type:'ENTRY',time:entryResolved.entryTime,price:sig.entry,text:`🟢 ${sig.symbol} ${sig.timeframe||'15m'} GİRİŞ AKTİF. ${sig.direction} · ${levelsText(sig)}.`};
        await notifyOnce(sig,'entry',ev);
      }
      console.log(sig.symbol,'GİRİŞ AKTİF',sig.enteredAt);

      for(const se of entryResolved.stageEvents||[]){
        if(se.stage<=sig.stage)continue;
        sig.stage=se.stage;const label=se.stage===3?'TP3':se.stage===2?'TP2':'TP1';sig.status=label;
        const passed=se.stage===3?'TP1 ve TP2 de geçildi.':se.stage===2?'TP1 de geçildi.':'İlk hedefe ulaşıldı.';
        const key=label.toLowerCase(),ev={type:label,time:se.time,price:se.price,text:`✅ ${sig.symbol} ${label} GELDİ. ${passed} Sinyal: ${sig.direction} ${sig.timeframe||'15m'}. ${levelsText(sig)}. ${label==='TP3'?reanalysisSummaryText(sig):''}`};
        if(!sig.notified[key])await notifyOnce(sig,key,ev);
        changed=true;
      }
      if(entryResolved.terminal==='STOP'){
        const stage=sig.stage||0,result=stage>=2?'STOP_AFTER_TP2':stage>=1?'STOP_AFTER_TP1':'STOP',note=stage>=2?'TP1 ve TP2 görüldükten sonra':stage>=1?'TP1 görüldükten sonra':'hedef görülmeden';
        sig.status='STOP';
        const ev={type:'STOP',time:entryResolved.time,price:protectiveStop(sig,sig.stage||0),text:`🛑 ${sig.symbol} STOP OLDU — ${note}. Sinyal: ${sig.direction} ${sig.timeframe||'15m'}. Giriş ${fmtPrice(sig.entry)} · STOP ${fmtPrice(protectiveStop(sig,sig.stage||0))}. ${reanalysisSummaryText(sig)}`};
        if(!sig.notified.stop)await notifyOnce(sig,'stop',ev);
        closeSignal(state,id,sig,result,entryResolved.time,{maxStage:stage,exitPrice:protectiveStop(sig,sig.stage||0),status:'STOP'});changed=true;continue;
      }
      if(entryResolved.terminal==='TP3'){
        sig.status='TP3';closeSignal(state,id,sig,'TP3',entryResolved.time,{maxStage:3,exitPrice:sig.tp3,status:'TP3'});changed=true;continue;
      }
      startIndex=entryIndex+1;
    }else{
      const enteredMs0=Date.parse(sig.enteredAt||sig.sentAt);
      startIndex=candles.findIndex(c=>c.closeTime>enteredMs0);
      if(startIndex<0)startIndex=candles.length;
    }

    const enteredMs=Date.parse(sig.enteredAt||sig.sentAt);
    const activeDeadline=enteredMs+activeExpiryMs(sig.timeframe);
    for(let i=startIndex;i<candles.length;i++){
      const cand=candles[i];if(cand.closeTime>activeDeadline)break;
      const newStage=targetStage(sig,cand),hitStop=stopHit(sig,cand),advancing=newStage>sig.stage;
      if(!hitStop&&!advancing)continue;

      if(hitStop&&advancing){
        const seq=await resolveSequence(sig,cand,cand.openTime,true,sig.stage).catch(e=>{console.error(sig.symbol,'agg active sequence',e.message);return null});
        if(!seq){
          const ev={type:'AMBIGUOUS',time:cand.closeTime,price:cand.close,text:`⚠️ ${sig.symbol}: aynı 1 dakikalık mumda STOP ve yeni TP görüldü; trade sırası alınamadığı için performans hesabına dahil edilmedi.`};
          if(!sig.notified.ambiguous)await notifyOnce(sig,'ambiguous',ev);
          sig.status='AMBIGUOUS';closeSignal(state,id,sig,'AMBIGUOUS',cand.closeTime,{maxStage:Math.max(sig.stage,newStage),ambiguityKind:'TRADE_SEQUENCE_UNAVAILABLE'});changed=true;closed=true;break;
        }
        for(const se of seq.stageEvents||[]){
          if(se.stage<=sig.stage)continue;
          sig.stage=se.stage;const label=se.stage===3?'TP3':se.stage===2?'TP2':'TP1';sig.status=label;
          const passed=se.stage===3?'TP1 ve TP2 de geçildi.':se.stage===2?'TP1 de geçildi.':'İlk hedefe ulaşıldı.';
          const key=label.toLowerCase(),ev={type:label,time:se.time,price:se.price,text:`✅ ${sig.symbol} ${label} GELDİ. ${passed} Sinyal: ${sig.direction} ${sig.timeframe||'15m'}. ${levelsText(sig)}. ${label==='TP3'?reanalysisSummaryText(sig):''}`};
          if(!sig.notified[key])await notifyOnce(sig,key,ev);
          changed=true;
        }
        if(seq.terminal==='STOP'){
          const stage=sig.stage||0,result=stage>=2?'STOP_AFTER_TP2':stage>=1?'STOP_AFTER_TP1':'STOP',note=stage>=2?'TP1 ve TP2 görüldükten sonra':stage>=1?'TP1 görüldükten sonra':'hedef görülmeden';
          sig.status='STOP';const ev={type:'STOP',time:seq.time,price:protectiveStop(sig,sig.stage||0),text:`🛑 ${sig.symbol} STOP OLDU — ${note}. Sinyal: ${sig.direction} ${sig.timeframe||'15m'}. Giriş ${fmtPrice(sig.entry)} · STOP ${fmtPrice(protectiveStop(sig,sig.stage||0))}. ${reanalysisSummaryText(sig)}`};
          if(!sig.notified.stop)await notifyOnce(sig,'stop',ev);
          closeSignal(state,id,sig,result,seq.time,{maxStage:stage,exitPrice:protectiveStop(sig,sig.stage||0),status:'STOP'});changed=true;closed=true;break;
        }
        if(seq.terminal==='TP3'){sig.status='TP3';closeSignal(state,id,sig,'TP3',seq.time,{maxStage:3,exitPrice:sig.tp3,status:'TP3'});changed=true;closed=true;break}
        continue;
      }

      if(advancing){
        sig.stage=newStage;const label=newStage===3?'TP3':newStage===2?'TP2':'TP1';sig.status=label;
        const price=newStage===3?sig.tp3:newStage===2?sig.tp2:sig.tp1,passed=newStage===3?'TP1 ve TP2 de geçildi.':newStage===2?'TP1 de geçildi.':'İlk hedefe ulaşıldı.';
        const ev={type:label,time:cand.closeTime,price,text:`✅ ${sig.symbol} ${label} GELDİ. ${passed} Sinyal: ${sig.direction} ${sig.timeframe||'15m'}. ${levelsText(sig)}. ${label==='TP3'?reanalysisSummaryText(sig):''}`},key=label.toLowerCase();
        if(!sig.notified[key])await notifyOnce(sig,key,ev);
        changed=true;
        if(newStage===3){closeSignal(state,id,sig,'TP3',cand.closeTime,{maxStage:3,exitPrice:sig.tp3,status:'TP3'});closed=true;break}
      }

      if(hitStop){
        const stage=sig.stage||0,result=stage>=2?'STOP_AFTER_TP2':stage>=1?'STOP_AFTER_TP1':'STOP',note=stage>=2?'TP1 ve TP2 görüldükten sonra':stage>=1?'TP1 görüldükten sonra':'hedef görülmeden';
        sig.status='STOP';const ev={type:'STOP',time:cand.closeTime,price:protectiveStop(sig,sig.stage||0),text:`🛑 ${sig.symbol} STOP OLDU — ${note}. Sinyal: ${sig.direction} ${sig.timeframe||'15m'}. Giriş ${fmtPrice(sig.entry)} · STOP ${fmtPrice(protectiveStop(sig,sig.stage||0))}. ${reanalysisSummaryText(sig)}`};
        if(!sig.notified.stop)await notifyOnce(sig,'stop',ev);
        closeSignal(state,id,sig,result,cand.closeTime,{maxStage:stage,exitPrice:protectiveStop(sig,sig.stage||0),status:'STOP'});changed=true;closed=true;break;
      }
    }

    if(!closed){
      if(Number.isFinite(enteredMs)&&Date.now()>activeDeadline){
        const stage=sig.stage||0,hours=Math.round(activeExpiryMs(sig.timeframe)/3600000),before=sig.status;
        sig.status='EXPIRED';
        const ev={type:'EXPIRED',time:activeDeadline,price:sig.entry,text:`⌛ ${sig.symbol} ${sig.timeframe||'15m'} aktif işleminin süresi ${hours} saatte doldu — ${stageText(stage)}. TP3/STOP oluşmadığı için performans başarı/zarar hesabına dahil edilmedi.`};
        await notifyOnce(sig,null,ev);
        closeSignal(state,id,sig,'EXPIRED',activeDeadline,{maxStage:stage,expiryKind:'ACTIVE_TIMEOUT',preExpiryStatus:before,status:'EXPIRED'});
        changed=true;
      }else state.activeSignals[id]=sig;
    }
  }catch(e){
    console.error(`HATA ${sig?.symbol||id}:`,e?.message||e);
  }
}

await reconcileTrackerFromState(state);

const nextPerformance=performance(state);
const comparablePerformance=p=>{
  if(!p||typeof p!=='object')return {};
  const {updatedAt,...rest}=p;
  return rest
};
const performanceChanged=JSON.stringify(comparablePerformance(state.performance))!==JSON.stringify(comparablePerformance(nextPerformance));
if(changed||performanceChanged){
  state.performance=nextPerformance;
  saveState(state);
  console.log(performanceChanged?'Performans/timeframe özeti güncellendi':'Lifecycle state güncellendi',state.performance);
}else{
  console.log('Yeni lifecycle olayı yok',state.performance);
}
