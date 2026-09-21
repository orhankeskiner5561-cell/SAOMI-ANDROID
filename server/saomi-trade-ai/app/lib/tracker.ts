import {get,list,put} from '@vercel/blob';
import {randomUUID} from 'node:crypto';

const PREFIX='saomi/tracker/signals/';
const LATEST='saomi/tracker/latest.json';
const TERMINAL=new Set(['TP3','STOP','AMBIGUOUS','EXPIRED','CANCELLED','EXPIRED-CANCELLED']);

function blobToken(){
  const v=String(process.env.BLOB_READ_WRITE_TOKEN||'').trim();
  if(!v) throw new Error('Tracker Blob ayarı eksik');
  return v;
}

export function makeSignalId(body:any,setup:any){
  const supplied=String(body?.signalId||setup?.signalId||'').trim();
  return supplied||`sg_${Date.now()}_${setup.symbol}_${setup.timeframe}_${randomUUID().slice(0,8)}`;
}

export function makeTrackerRecord(body:any,setup:any,messageId:any,signalId:string){
  const now=new Date().toISOString();
  return {
    signalId,status:'WAIT_ENTRY',stage:0,result:null,
    symbol:setup.symbol,market:'futures',timeframe:setup.timeframe,direction:setup.direction,
    confidence:setup.confidence,
    riskReward:Number.isFinite(Number(body?.riskReward))?Number(body.riskReward):null,
    entry:setup.entry,stop:setup.stop,tp1:setup.tp1,tp2:setup.tp2,tp3:setup.tp3,
    sentAt:now,createdAt:now,updatedAt:now,enteredAt:null,closedAt:null,
    telegramMessageId:messageId??null,sourceMode:String(body?.mode||''),
    analysisVersion:body?.analysisVersion||'RC5.40_TRACKER_BLOB',
    topDownContext:body?.topDownContext||body?.contextSnapshot?.topDownContext||null,
    lowerFrameContext:body?.lowerFrameContext||null,
    indicatorContext:body?.indicatorContext||body?.lowerFrameContext?.indicatorContext||null,
    entryTrigger:body?.entryTrigger||null,
    commentary:String(body?.commentary||''),
    commentaryProvider:String(body?.commentaryProvider||''),
    payloadVersion:'RC5.40_TRACKER_BLOB_V1'
  };
}

async function write(pathname:string,value:any){
  return put(pathname,JSON.stringify(value),{
    access:'private',allowOverwrite:true,addRandomSuffix:false,cacheControlMaxAge:0,
    contentType:'application/json',token:blobToken()
  });
}

async function readOne(pathname:string){
  const r=await get(pathname,{access:'private',useCache:false,token:blobToken()});
  if(!r||r.statusCode!==200) return null;
  try{return JSON.parse(await new Response(r.stream).text())}catch{return null}
}

export async function storeSignal(record:any){
  await Promise.all([
    write(PREFIX+encodeURIComponent(record.signalId)+'.json',record),
    write(LATEST,record)
  ]);
  return record;
}

export async function readTrackerState(max=80){
  const n=Math.max(1,Math.min(100,Number(max)||80));
  const page=await list({prefix:PREFIX,limit:100,token:blobToken()});
  const blobs=[...(page.blobs||[])]
    .sort((a:any,b:any)=>Date.parse(String(b.uploadedAt||0))-Date.parse(String(a.uploadedAt||0)))
    .slice(0,n);
  const rows=(await Promise.all(blobs.map((b:any)=>readOne(b.pathname)))).filter(Boolean);
  const active=rows.filter((x:any)=>!TERMINAL.has(String(x.status||x.result||'').toUpperCase()));
  const history=rows.filter((x:any)=>TERMINAL.has(String(x.status||x.result||'').toUpperCase()));
  const latest=(await readOne(LATEST))||active[0]||rows[0]||null;
  return {activeSignals:Object.fromEntries(active.map((x:any)=>[x.signalId,x])),history,latest,count:rows.length};
}

export async function updateSignal(signalId:string,patch:any){
  const path=PREFIX+encodeURIComponent(signalId)+'.json';
  const old=await readOne(path);
  if(!old) throw new Error('Tracker signalId bulunamadı');
  const next={...old,...patch,signalId:old.signalId,updatedAt:new Date().toISOString()};
  await write(path,next);
  const latest=await readOne(LATEST);
  if(latest?.signalId===signalId) await write(LATEST,next);
  return next;
}
