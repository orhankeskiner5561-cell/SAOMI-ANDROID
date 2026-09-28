import {NextRequest,NextResponse} from 'next/server';
import {createHash} from 'node:crypto';
import {get,put} from '@vercel/blob';

export const dynamic='force-dynamic';
export const runtime='nodejs';

const HEADERS={
  'cache-control':'no-store',
  'access-control-allow-origin':'*',
  'access-control-allow-methods':'GET,POST,OPTIONS',
  'access-control-allow-headers':'content-type'
};
const PREFIX='saomi/backtest-report/';
const MAX_BYTES=450_000;
const LOG_CHUNK=6000;

function token(){return String(process.env.BLOB_READ_WRITE_TOKEN||'').trim()}
function cleanDevice(v:unknown){
  const s=String(v||'').trim();
  if(!/^[A-Za-z0-9_-]{12,96}$/.test(s)) throw new Error('Geçersiz report device');
  return s;
}
function pathFor(device:string){return PREFIX+encodeURIComponent(device)+'/latest.json'}
async function writeBlob(device:string,payload:any){
  const t=token(); if(!t) return false;
  await put(pathFor(device),JSON.stringify(payload),{
    access:'private',allowOverwrite:true,addRandomSuffix:false,cacheControlMaxAge:0,
    contentType:'application/json',token:t
  });
  return true;
}
async function readBlob(device:string){
  const t=token(); if(!t) return null;
  const r=await get(pathFor(device),{access:'private',useCache:false,token:t});
  if(!r||r.statusCode!==200) return null;
  try{return JSON.parse(await new Response(r.stream).text())}catch{return null}
}
function summaryOf(snapshot:any){
  const s=snapshot?.summary||{};
  return {
    total:Number(s.total||0),done:Number(s.done||0),tp3:Number(s.tp3||0),stops:Number(s.stops||0),
    tp1:Number(s.tp1||0),tp2:Number(s.tp2||0),rate:s.rate??null,
    rules:Number(snapshot?.learning?.ruleCount||0),conversations:Number(snapshot?.conversations?.length||0),
    appVersion:String(snapshot?.appVersion||'')
  };
}
function logSnapshot(device:string,reportId:string,snapshot:any){
  const raw=JSON.stringify(snapshot);
  const chunks=Math.max(1,Math.ceil(raw.length/LOG_CHUNK));
  console.info('SAOMI_BT_REPORT_SUMMARY',JSON.stringify({device,reportId,at:new Date().toISOString(),summary:summaryOf(snapshot),chunks,bytes:raw.length}));
  for(let i=0;i<chunks;i++) console.info('SAOMI_BT_REPORT_CHUNK',JSON.stringify({device,reportId,index:i,total:chunks,data:raw.slice(i*LOG_CHUNK,(i+1)*LOG_CHUNK)}));
  return chunks;
}

export async function OPTIONS(){
  return new NextResponse(null,{status:204,headers:HEADERS});
}

export async function POST(req:NextRequest){
  try{
    const body=await req.json();
    const device=cleanDevice(body?.device);
    const snapshot=body?.snapshot;
    if(!snapshot||typeof snapshot!=='object') throw new Error('snapshot gerekli');
    const raw=JSON.stringify(snapshot);
    if(raw.length>MAX_BYTES) throw new Error('snapshot çok büyük');
    const reportId=createHash('sha256').update(device+'|'+Date.now()+'|'+raw.length).digest('hex').slice(0,16);
    const envelope={ok:true,device,reportId,receivedAt:new Date().toISOString(),snapshot};
    const chunks=logSnapshot(device,reportId,snapshot);
    let persisted='runtime-log';
    try{if(await writeBlob(device,envelope))persisted='vercel-blob+runtime-log'}catch(e){console.error('SAOMI_BT_BLOB_WRITE_FAIL',e instanceof Error?e.message:e)}
    return NextResponse.json({ok:true,device,reportId,persisted,chunks,summary:summaryOf(snapshot)},{headers:HEADERS});
  }catch(e){
    return NextResponse.json({ok:false,error:e instanceof Error?e.message:'Backtest raporu alınamadı'},{status:422,headers:HEADERS});
  }
}

export async function GET(req:NextRequest){
  try{
    const device=cleanDevice(req.nextUrl.searchParams.get('device'));
    let row:any=null;
    try{row=await readBlob(device)}catch(e){console.warn('SAOMI_BT_BLOB_READ_FAIL',e instanceof Error?e.message:e)}
    if(row) return NextResponse.json(row,{headers:HEADERS});
    return NextResponse.json({ok:false,error:'Kalıcı Blob raporu yok; runtime log kaydı kullanılmalı',device},{status:404,headers:HEADERS});
  }catch(e){
    return NextResponse.json({ok:false,error:e instanceof Error?e.message:'Backtest raporu okunamadı'},{status:422,headers:HEADERS});
  }
}
