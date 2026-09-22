import {get,list,put} from '@vercel/blob';
import {randomUUID} from 'node:crypto';

const PREFIX='saomi/tracker/signals/';
const LATEST='saomi/tracker/latest.json';
const INDEX='saomi/tracker/index.json';
const MAX_INDEX=500;
const GITHUB_STATE_URL='https://raw.githubusercontent.com/orhankeskiner5561-cell/SAOMI-ANDROID/main/.github/state/saomi-telegram-state.json';
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
  const current=await readOne(INDEX),rows=Array.isArray(current)?current.filter((x:any)=>x?.signalId!==record.signalId):[];
  const nextIndex=[record,...rows].slice(0,MAX_INDEX);
  await Promise.all([
    write(PREFIX+encodeURIComponent(record.signalId)+'.json',record),
    write(LATEST,record),
    write(INDEX,nextIndex)
  ]);
  return record;
}

async function readGithubTrackerState(max=80){
  const n=Math.max(1,Math.min(MAX_INDEX,Number(max)||80));
  const r=await fetch(GITHUB_STATE_URL,{cache:'no-store',signal:AbortSignal.timeout(15000)});
  if(!r.ok) throw new Error('GitHub tracker state HTTP '+r.status);
  const state:any=await r.json();
  const activeAll=Object.values(state?.activeSignals||{}) as any[];
  const historyAll=Array.isArray(state?.history)?state.history:[];
  const rows=[...activeAll,...historyAll]
    .filter((x:any)=>x?.signalId)
    .sort((a:any,b:any)=>(Date.parse(b.sentAt||b.createdAt||b.closedAt||0)||0)-(Date.parse(a.sentAt||a.createdAt||a.closedAt||0)||0))
    .slice(0,n);
  const active=rows.filter((x:any)=>!TERMINAL.has(String(x.status||x.result||'').toUpperCase()));
  const history=rows.filter((x:any)=>TERMINAL.has(String(x.status||x.result||'').toUpperCase()));
  const latest=active[0]||rows[0]||null;
  return {activeSignals:Object.fromEntries(active.map((x:any)=>[x.signalId,x])),history,latest,count:rows.length,source:'github-state'};
}

export async function readTrackerState(max=80){
  const n=Math.max(1,Math.min(MAX_INDEX,Number(max)||80));
  try{
    const [page,indexRows,pointer]=await Promise.all([
      list({prefix:PREFIX,limit:Math.min(1000,Math.max(100,n)),token:blobToken()}),
      readOne(INDEX),
      readOne(LATEST)
    ]);
    const blobs=[...(page.blobs||[])]
      .sort((a:any,b:any)=>Date.parse(String(b.uploadedAt||0))-Date.parse(String(a.uploadedAt||0)))
      .slice(0,n);
    const listed=(await Promise.all(blobs.map((b:any)=>readOne(b.pathname)))).filter(Boolean);
    const merged=new Map<string,any>();
    for(const row of [...(Array.isArray(indexRows)?indexRows:[]),...listed]) if(row?.signalId&&!merged.has(row.signalId)) merged.set(row.signalId,row);
    if(pointer?.signalId&&!merged.has(pointer.signalId)) merged.set(pointer.signalId,pointer);
    const rows=[...merged.values()].sort((a:any,b:any)=>(Date.parse(b.sentAt||b.createdAt||0)||0)-(Date.parse(a.sentAt||a.createdAt||0)||0)).slice(0,n);
    const active=rows.filter((x:any)=>!TERMINAL.has(String(x.status||x.result||'').toUpperCase()));
    const history=rows.filter((x:any)=>TERMINAL.has(String(x.status||x.result||'').toUpperCase()));
    const latest=pointer&&!TERMINAL.has(String(pointer.status||pointer.result||'').toUpperCase())?pointer:(active[0]||rows[0]||null);
    return {activeSignals:Object.fromEntries(active.map((x:any)=>[x.signalId,x])),history,latest,count:rows.length,source:'vercel-blob'};
  }catch(e){
    console.error('TRACKER_BLOB_READ_FAIL_FALLBACK_GITHUB',e instanceof Error?e.message:e);
    return readGithubTrackerState(n);
  }
}

export async function upsertSignal(signalId:string,seed:any,patch:any={}){
  const id=String(signalId||'').trim();
  if(!id) throw new Error('Tracker signalId gerekli');
  const path=PREFIX+encodeURIComponent(id)+'.json';
  const [direct,latest,current]=await Promise.all([readOne(path),readOne(LATEST),readOne(INDEX)]);
  const rows=Array.isArray(current)?current:[];
  const indexed=rows.find((x:any)=>x?.signalId===id)||null;
  const pointed=latest?.signalId===id?latest:null;
  const base=direct||indexed||pointed||(seed&&typeof seed==='object'?seed:null);
  if(!base) throw new Error('Tracker signalId bulunamadı');
  const now=new Date().toISOString();
  const next={...base,...patch,signalId:id,createdAt:base.createdAt||base.sentAt||now,sentAt:base.sentAt||base.createdAt||now,updatedAt:now};
  await write(path,next);
  const nextIndex=[next,...rows.filter((x:any)=>x?.signalId!==id)]
    .sort((a:any,b:any)=>(Date.parse(b.sentAt||b.createdAt||0)||0)-(Date.parse(a.sentAt||a.createdAt||0)||0))
    .slice(0,MAX_INDEX);
  const writes=[write(INDEX,nextIndex)];
  if(!latest||latest?.signalId===id) writes.push(write(LATEST,next));
  await Promise.all(writes);
  return next;
}

export async function updateSignal(signalId:string,patch:any){
  return upsertSignal(signalId,null,patch);
}
