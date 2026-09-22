import {NextRequest,NextResponse} from 'next/server';
import {makeSignalId,makeTrackerRecord,storeSignal,upsertSignal} from '../../lib/tracker';

export const dynamic='force-dynamic';
export const runtime='nodejs';

const BINANCE_EXCHANGE_INFO='https://www.binance.com/fapi/v1/exchangeInfo';
const SYMBOL_POLICY='binance-usdm-trading-perpetual';
const PAYLOAD_VERSION='RC5.54_ORHAN_ONLY_V1';
const ORHAN_ANALYSIS_VERSION='RC5.48_ORHAN_SR_BREAKOUT_CONFIRM';
const ORHAN_SIGNAL_TAG='ORHAN_SR_BREAKOUT_CONFIRM';
const ALLOWED_MODES=new Set(['github-pa-v1','github-lifecycle','approved','auto','server-auto']);
const ALLOWED_TFS=new Set(['1m','5m','15m','30m','1h','4h']);
const EXCHANGE_INFO_TTL_MS=5*60*1000;

type ExchangeSymbol={symbol?:string,status?:string,contractType?:string};
type ExchangeInfo={symbols?:ExchangeSymbol[]};
let exchangeCache:{at:number,symbols:Set<string>}|null=null;

function esc(v:unknown){return String(v??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}
function finite(v:unknown){return v!==null&&v!==undefined&&v!==''&&Number.isFinite(Number(v))}
function positive(v:unknown){return finite(v)&&Number(v)>0}
function digits(n:number){const a=Math.abs(n);if(a>=1000)return 1;if(a>=100)return 2;if(a>=1)return 4;if(a>=0.01)return 5;return 7}
function num(v:unknown){if(!finite(v))return'—';const n=Number(v);return n.toLocaleString('en-US',{minimumFractionDigits:digits(n),maximumFractionDigits:digits(n)})}
function confidence(v:unknown){return finite(v)?`%${Math.round(Number(v))}`:'—'}
function creds(){const token=String(process.env.TELEGRAM_BOT_TOKEN||'').trim();const chatId=String(process.env.TELEGRAM_CHANNEL_ID||process.env.TELEGRAM_CHAT_ID||'').trim();if(!token||!chatId)throw new Error('Telegram ayarları eksik');return{token,chatId}}
function cleanReason(v:unknown){return String(v||'').replace(/\*\*/g,'').replace(/^#{1,6}\s*/gm,'').replace(/`{1,3}/g,'').split(/\r?\n/).map(x=>x.trim()).filter(x=>x&&!/^(giriş|entry|stop|tp\s*1|tp\s*2|tp\s*3|hedef\s*1|hedef\s*2|hedef\s*3)\s*[:：-]/i.test(x)).join(' ').replace(/\s{2,}/g,' ').trim()}

async function validSymbols(){
 const now=Date.now();if(exchangeCache&&now-exchangeCache.at<EXCHANGE_INFO_TTL_MS)return exchangeCache.symbols;
 const r=await fetch(BINANCE_EXCHANGE_INFO,{cache:'no-store',signal:AbortSignal.timeout(10000)});
 if(!r.ok)throw new Error(`Binance exchangeInfo HTTP ${r.status}`);
 const j=await r.json() as ExchangeInfo;
 const symbols=new Set((j.symbols||[]).filter(x=>x?.status==='TRADING'&&x?.contractType==='PERPETUAL'&&typeof x.symbol==='string').map(x=>String(x.symbol).toUpperCase()));
 if(!symbols.size)throw new Error('Binance USD-M sembol evreni boş');
 exchangeCache={at:now,symbols};return symbols;
}

function validateSetup(body:any){
 const s=body?.setup||{};
 const symbol=String(s.symbol||'').trim().toUpperCase();
 const direction=String(s.direction||'').trim().toUpperCase();
 const timeframe=String(s.timeframe||'').trim().toLowerCase();
 const market=String(s.market||'futures').trim().toLowerCase();
 if(!/^[A-Z0-9]{5,30}$/.test(symbol))throw new Error('Geçersiz veya sahte sembol');
 if(!['LONG','SHORT'].includes(direction))throw new Error('Yön yalnız LONG/SHORT olabilir');
 if(!ALLOWED_TFS.has(timeframe))throw new Error('Geçersiz timeframe');
 if(market!=='futures')throw new Error('Yalnız Binance USD-M Futures kabul edilir');
 if(!finite(s.confidence)||Number(s.confidence)<=0||Number(s.confidence)>100)throw new Error('Geçersiz confidence');
 for(const k of ['entry','stop','tp1','tp2','tp3'] as const)if(!positive(s[k]))throw new Error(`${k} gerçek ve pozitif olmalı`);
 const entry=Number(s.entry),stop=Number(s.stop),tp1=Number(s.tp1),tp2=Number(s.tp2),tp3=Number(s.tp3);
 if(direction==='LONG'&&!(stop<entry&&entry<tp1&&tp1<=tp2&&tp2<=tp3))throw new Error('LONG seviye sıralaması geçersiz');
 if(direction==='SHORT'&&!(stop>entry&&entry>tp1&&tp1>=tp2&&tp2>=tp3))throw new Error('SHORT seviye sıralaması geçersiz');
 const mode=String(body?.mode||'').trim();
 if(!ALLOWED_MODES.has(mode))throw new Error('Geçersiz Telegram modu');
 return{...s,symbol,direction,timeframe,market:'futures',confidence:Number(s.confidence),entry,stop,tp1,tp2,tp3};
}

function tradeText(body:any,s:any){
 const rawRR=finite(body?.riskReward)?Number(body.riskReward):Math.abs(s.tp3-s.entry)/Math.abs(s.entry-s.stop);
 const reason=cleanReason(body?.commentary);
 return `<b>${esc(s.symbol)} — ${esc(s.direction)}</b>\n`
  +`Zaman: <b>${esc(s.timeframe)}</b> · Piyasa: FUTURES\n`
  +`Güven: <b>${confidence(s.confidence)}</b>${Number.isFinite(rawRR)?` · R/R: <b>${rawRR.toFixed(2)}</b>`:''}\n\n`
  +`Giriş: <b>${num(s.entry)}</b>\nStop: <b>${num(s.stop)}</b>\n`
  +`TP1: ${num(s.tp1)}\nTP2: ${num(s.tp2)}\nTP3: ${num(s.tp3)}\n\n`
  +`${reason?esc(reason).slice(0,900):'ŞAOMİ TRADE AI teknik analiz sinyali.'}\n\n`
  +`<i>Olasılık analizidir; yatırım tavsiyesi değildir.</i>`;
}

export async function GET(req:NextRequest){
 const configured=Boolean(String(process.env.TELEGRAM_BOT_TOKEN||'').trim()&&String(process.env.TELEGRAM_CHANNEL_ID||process.env.TELEGRAM_CHAT_ID||'').trim());
 const probe=String(req.nextUrl.searchParams.get('symbol')||'').trim().toUpperCase();
 let symbolAccepted:boolean|undefined;
 if(probe){try{symbolAccepted=(await validSymbols()).has(probe)}catch{symbolAccepted=false}}
 return NextResponse.json({configured,allowedModes:[...ALLOWED_MODES],symbolPolicy:SYMBOL_POLICY,payloadVersion:PAYLOAD_VERSION,...(probe?{probeSymbol:probe,symbolAccepted}: {})},{headers:{'cache-control':'no-store'}});
}

export async function POST(req:NextRequest){
 try{
  const body=await req.json();
  if(String(body?.mode||'').toLowerCase().includes('system')||String(body?.setup?.symbol||'').toUpperCase().includes('SAOMI_SYSTEM'))throw new Error('Sistem mesajları trade endpointine gönderilemez');
  const setup=validateSetup(body);
  const signalId=makeSignalId(body,setup);
  const analysisVersion=String(setup?.analysisVersion||body?.analysisVersion||'');
  if(analysisVersion!==ORHAN_ANALYSIS_VERSION || !String(signalId).includes('|'+ORHAN_SIGNAL_TAG+':')){
    throw new Error('Yalnız ORHAN SETUP sinyalleri kabul edilir');
  }
  const symbols=await validSymbols();
  if(!symbols.has(setup.symbol))throw new Error(`${setup.symbol} Binance USD-M TRADING/PERPETUAL değil`);
  const{token,chatId}=creds();const caption=tradeText(body,setup);let r:Response;
  if(typeof body.imageDataUrl==='string'&&body.imageDataUrl.startsWith('data:image/')){
   const [meta,b64]=body.imageDataUrl.split(',',2);const mime=meta.match(/data:(.*?);base64/)?.[1]||'image/png';const bytes=Buffer.from(b64||'','base64');const form=new FormData();form.append('chat_id',chatId);form.append('caption',caption);form.append('parse_mode','HTML');form.append('photo',new Blob([bytes],{type:mime}),'saomi-trade-chart.png');r=await fetch(`https://api.telegram.org/bot${token}/sendPhoto`,{method:'POST',body:form,signal:AbortSignal.timeout(20000)});
  }else{
   r=await fetch(`https://api.telegram.org/bot${token}/sendMessage`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({chat_id:chatId,text:caption,parse_mode:'HTML',disable_web_page_preview:true}),signal:AbortSignal.timeout(15000)});
  }
  const raw=await r.text();if(!r.ok){console.error('Telegram HTTP error',r.status,raw);return NextResponse.json({ok:false,error:`Telegram HTTP ${r.status}`,detail:raw.slice(0,500)},{status:502})}
  let j:any={};try{j=JSON.parse(raw)}catch{}
  if(String(body?.mode||'')==='github-lifecycle'){
    const lc=body?.lifecycle||{};
    const allowed=new Set(['ACTIVE','TP1','TP2','TP3','STOP','AMBIGUOUS','EXPIRED','CANCELLED']);
    const status=String(lc.status||'').toUpperCase();
    if(!allowed.has(status))throw new Error('Geçersiz lifecycle status');
    const patch:any={status,lastTelegramMessageId:j?.result?.message_id??null};
    if(Number.isFinite(Number(lc.stage)))patch.stage=Math.max(0,Math.min(3,Number(lc.stage)));
    if(lc.result)patch.result=String(lc.result).toUpperCase();
    if(lc.enteredAt)patch.enteredAt=lc.enteredAt;
    if(lc.closedAt)patch.closedAt=lc.closedAt;
    if(Number.isFinite(Number(lc.currentPrice)))patch.currentPrice=Number(lc.currentPrice);
    const seed=makeTrackerRecord(body,setup,j?.result?.message_id,signalId);
    await upsertSignal(signalId,seed,patch);
    console.info('Telegram lifecycle sent + canonical tracker updated',{signalId,status,stage:patch.stage,messageId:j?.result?.message_id});
    return NextResponse.json({ok:true,trackerUpdated:true,messageId:j?.result?.message_id,mode:'text',symbol:setup.symbol,direction:setup.direction,timeframe:setup.timeframe,signalId,status,payloadVersion:PAYLOAD_VERSION});
  }
  const record=makeTrackerRecord(body,setup,j?.result?.message_id,signalId);
  await storeSignal(record);
  console.info('Telegram trade sent + tracker stored',{signalId,symbol:setup.symbol,direction:setup.direction,timeframe:setup.timeframe,mode:body.mode,messageId:j?.result?.message_id});
  return NextResponse.json({ok:true,trackerStored:true,messageId:j?.result?.message_id,mode:body.imageDataUrl?'photo':'text',symbol:setup.symbol,direction:setup.direction,timeframe:setup.timeframe,signalId,payloadVersion:PAYLOAD_VERSION});
 }catch(e){const m=e instanceof Error?e.message:'Telegram gönderimi başarısız';console.error('Telegram trade rejected',m);const status=m.includes('ayarları eksik')?400:/Geçersiz|sahte|yalnız|olmalı|sıralaması|değil|Sistem mesajları/i.test(m)?422:502;return NextResponse.json({ok:false,error:m,payloadVersion:PAYLOAD_VERSION},{status})}
}
