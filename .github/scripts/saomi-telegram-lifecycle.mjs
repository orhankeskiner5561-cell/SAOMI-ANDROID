import fs from 'node:fs';

const BASE='https://saomi-trade-ai.vercel.app';
const FUTURES='https://www.binance.com';
const STATE_PATH='.github/state/saomi-telegram-state.json';
const PENDING_EXPIRY_MS=12*60*60*1000;
const ACTIVE_EXPIRY_MS=72*60*60*1000;
const MAX_HISTORY=500;

function finite(v){return Number.isFinite(Number(v))}
function iso(ms){return new Date(ms).toISOString()}
function loadState(){
  let state;
  try{state=JSON.parse(fs.readFileSync(STATE_PATH,'utf8'))}catch{state={}}
  state.version=2;
  state.signals=state.signals||{};
  state.activeSignals=state.activeSignals||{};
  state.history=Array.isArray(state.history)?state.history:[];
  return state
}
function saveState(state){
  state.version=2;
  fs.mkdirSync('.github/state',{recursive:true});
  fs.writeFileSync(STATE_PATH,JSON.stringify(state,null,2)+'\n');
}
function migrateLatestSignals(state){
  let changed=false;
  const closedIds=new Set((state.history||[]).map(x=>x.signalId));
  for(const v of Object.values(state.signals||{})){
    if(!v?.signalId||closedIds.has(v.signalId)||state.activeSignals[v.signalId])continue;
    if(!finite(v.entry)||!finite(v.stop)||!finite(v.tp1)||!finite(v.tp2)||!finite(v.tp3))continue;
    state.activeSignals[v.signalId]={
      ...v,
      symbol:v.symbol||String(v.signalId).split('|')[0],
      market:v.market||'futures',
      timeframe:v.timeframe||'15m',
      confidence:v.confidence??null,
      riskReward:v.riskReward??3,
      status:'WAIT_ENTRY',
      stage:0,
      enteredAt:null,
      notified:{entry:true,tp1:false,tp2:false,tp3:false,stop:false,ambiguous:false},
      migrated:true
    };
    changed=true;
  }
  return changed
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
  return sig.direction==='LONG'?c.low<=sig.stop:c.high>=sig.stop
}
function eventSetup(sig,event){
  return {
    symbol:sig.symbol,market:'futures',timeframe:sig.timeframe||'15m',
    direction:sig.direction,confidence:sig.confidence??0,quality:'TAKİP',
    price:event.price??sig.entry,entry:sig.entry,stop:sig.stop,
    tp1:sig.tp1,tp2:sig.tp2,tp3:sig.tp3,riskReward:sig.riskReward??3,
    signalId:`${sig.signalId}|${event.type}|${event.time}`
  }
}
async function notify(sig,event){
  const setup=eventSetup(sig,event);
  const r=await fetch(`${BASE}/api/telegram`,{
    method:'POST',
    headers:{'content-type':'application/json'},
    body:JSON.stringify({
      setup,
      commentary:event.text,
      provider:'ŞAOMİ TAKİP',
      riskReward:sig.riskReward??3,
      mode:'github-lifecycle',
      signalId:setup.signalId
    })
  });
  const j=await r.json().catch(()=>({}));
  if(!r.ok||!j.ok)throw new Error(j.error||`Telegram lifecycle HTTP ${r.status}`);
  return j
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
function performance(state){
  const h=state.history||[];
  const scored=h.filter(x=>x.result==='TP3'||String(x.result).startsWith('STOP'));
  const wins=scored.filter(x=>x.result==='TP3').length;
  const losses=scored.length-wins;
  const tp1=h.filter(x=>(x.maxStage??x.finalStage??0)>=1).length;
  const tp2=h.filter(x=>(x.maxStage??x.finalStage??0)>=2).length;
  const tp3=h.filter(x=>x.result==='TP3').length;
  const stopAfterTp1=h.filter(x=>x.result==='STOP_AFTER_TP1').length;
  const stopAfterTp2=h.filter(x=>x.result==='STOP_AFTER_TP2').length;
  const ambiguous=h.filter(x=>x.result==='AMBIGUOUS').length;
  const expired=h.filter(x=>x.result==='EXPIRED').length;
  return {
    updatedAt:new Date().toISOString(),
    scoredTrades:scored.length,wins,losses,
    winRate:scored.length?Number((wins/scored.length*100).toFixed(2)):null,
    tp1Reached:tp1,tp2Reached:tp2,tp3Reached:tp3,
    stopAfterTp1,stopAfterTp2,ambiguous,expired,
    active:Object.keys(state.activeSignals||{}).length
  }
}

const state=loadState();
let changed=migrateLatestSignals(state);
const entries=Object.entries(state.activeSignals||{});
console.log(`ŞAOMİ lifecycle başladı. Aktif kayıt: ${entries.length}`);

for(const [id,sig] of entries){
  try{
    if(!sig?.symbol||!finite(sig.entry)||!finite(sig.stop)||!finite(sig.tp1)||!finite(sig.tp2)||!finite(sig.tp3)){
      console.log(id,'geçersiz kayıt, atlandı');
      continue;
    }
    sig.entry=Number(sig.entry);sig.stop=Number(sig.stop);sig.tp1=Number(sig.tp1);sig.tp2=Number(sig.tp2);sig.tp3=Number(sig.tp3);
    sig.stage=Number(sig.stage||0);
    sig.status=sig.status||'WAIT_ENTRY';
    sig.notified=sig.notified||{entry:true,tp1:false,tp2:false,tp3:false,stop:false,ambiguous:false};

    const sentMs=Date.parse(sig.sentAt||0);
    if(!Number.isFinite(sentMs)){console.log(sig.symbol,'sentAt geçersiz');continue}

    if(sig.status==='WAIT_ENTRY'&&Date.now()-sentMs>PENDING_EXPIRY_MS){
      const ev={type:'EXPIRED',time:Date.now(),price:sig.entry,text:`⌛ ${sig.symbol} sinyali girişe temas etmeden süresi doldu. Doğruluk/başarı hesabına dahil edilmedi.`};
      await notify(sig,ev).catch(e=>console.error(sig.symbol,'expiry telegram',e.message));
      closeSignal(state,id,sig,'EXPIRED',Date.now(),{maxStage:0});
      changed=true;continue;
    }

    const candles=await minuteCandles(sig.symbol,sentMs);
    if(!candles.length){console.log(sig.symbol,'1m veri yok');continue}

    let startIndex=0;
    if(sig.status==='WAIT_ENTRY'){
      const idx=candles.findIndex(c=>c.closeTime>=sentMs&&touched(c,sig.entry));
      if(idx<0){console.log(sig.symbol,'giriş bekliyor');continue}
      sig.status='ACTIVE';
      sig.enteredAt=iso(candles[idx].closeTime);
      sig.entryCandleOpenTime=candles[idx].openTime;
      changed=true;
      startIndex=idx+1;
      console.log(sig.symbol,'GİRİŞ AKTİF',sig.enteredAt);
    }else{
      const enteredMs=Date.parse(sig.enteredAt||sig.sentAt);
      startIndex=Math.max(0,candles.findIndex(c=>c.closeTime>enteredMs));
      if(startIndex<0)startIndex=candles.length;
    }

    const enteredMs=Date.parse(sig.enteredAt||sig.sentAt);
    if(Number.isFinite(enteredMs)&&Date.now()-enteredMs>ACTIVE_EXPIRY_MS){
      const ev={type:'EXPIRED',time:Date.now(),price:sig.entry,text:`⌛ ${sig.symbol} aktif sinyali 72 saat içinde TP3/STOP ile sonuçlanmadı. Performans hesabına dahil edilmedi.`};
      await notify(sig,ev).catch(e=>console.error(sig.symbol,'active expiry telegram',e.message));
      closeSignal(state,id,sig,'EXPIRED',Date.now(),{maxStage:sig.stage});
      changed=true;continue;
    }

    let closed=false;
    for(let i=startIndex;i<candles.length;i++){
      const c=candles[i];
      const newStage=targetStage(sig,c);
      const hitStop=stopHit(sig,c);
      const advancing=newStage>sig.stage;

      if(hitStop&&advancing){
        const ev={type:'AMBIGUOUS',time:c.closeTime,price:c.close,text:`⚠️ ${sig.symbol}: aynı 1 dakikalık mum içinde hem STOP hem yeni TP seviyesi görüldü. Hangisinin önce olduğu kesin olmadığı için bu işlem doğruluk oranına dahil edilmedi.`};
        if(!sig.notified.ambiguous)await notify(sig,ev);
        sig.notified.ambiguous=true;
        closeSignal(state,id,sig,'AMBIGUOUS',c.closeTime,{maxStage:Math.max(sig.stage,newStage),ambiguousCandle:{openTime:c.openTime,high:c.high,low:c.low}});
        changed=true;closed=true;break;
      }

      if(advancing){
        sig.stage=newStage;
        const label=newStage===3?'TP3':newStage===2?'TP2':'TP1';
        const price=newStage===3?sig.tp3:newStage===2?sig.tp2:sig.tp1;
        const passed=newStage===3?'TP1 ve TP2 de geçildi.':newStage===2?'TP1 de geçildi.':'İlk hedefe ulaşıldı.';
        const ev={type:label,time:c.closeTime,price,text:`✅ ${sig.symbol} ${label} GELDİ. ${passed} Sinyal: ${sig.direction} ${sig.timeframe||'15m'}. Giriş ${sig.entry} · STOP ${sig.stop} · TP1 ${sig.tp1} · TP2 ${sig.tp2} · TP3 ${sig.tp3}.`};
        const key=label.toLowerCase();
        if(!sig.notified[key])await notify(sig,ev);
        sig.notified[key]=true;
        changed=true;
        console.log(sig.symbol,label,'geldi');
        if(newStage===3){
          closeSignal(state,id,sig,'TP3',c.closeTime,{maxStage:3,exitPrice:sig.tp3});
          closed=true;break;
        }
      }

      if(hitStop){
        const stage=sig.stage||0;
        const result=stage>=2?'STOP_AFTER_TP2':stage>=1?'STOP_AFTER_TP1':'STOP';
        const note=stage>=2?'TP1 ve TP2 görüldükten sonra':stage>=1?'TP1 görüldükten sonra':'hedef görülmeden';
        const ev={type:'STOP',time:c.closeTime,price:sig.stop,text:`🛑 ${sig.symbol} STOP OLDU — ${note}. Sinyal: ${sig.direction} ${sig.timeframe||'15m'}. Giriş ${sig.entry} · STOP ${sig.stop}.`};
        if(!sig.notified.stop)await notify(sig,ev);
        sig.notified.stop=true;
        closeSignal(state,id,sig,result,c.closeTime,{maxStage:stage,exitPrice:sig.stop});
        changed=true;closed=true;break;
      }
    }
    if(!closed)state.activeSignals[id]=sig;
  }catch(e){
    console.error(`HATA ${sig?.symbol||id}:`,e?.message||e);
  }
}

state.performance=performance(state);
if(changed){
  saveState(state);
  console.log('Lifecycle state güncellendi',state.performance);
}else{
  console.log('Yeni lifecycle olayı yok',state.performance);
}
