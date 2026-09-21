import {NextRequest,NextResponse} from 'next/server';

export const dynamic='force-dynamic';
export const runtime='nodejs';

function esc(v:unknown){return String(v??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}
function creds(){const token=String(process.env.TELEGRAM_BOT_TOKEN||'').trim();const chatId=String(process.env.TELEGRAM_CHANNEL_ID||process.env.TELEGRAM_CHAT_ID||'').trim();if(!token||!chatId)throw new Error('Telegram ayarları eksik');return{token,chatId}}

export async function POST(req:NextRequest){
 try{
  const body=await req.json();
  const text=String(body?.text||'').trim();
  if(!text)return NextResponse.json({ok:false,error:'Sistem mesajı boş olamaz'},{status:422});
  const{token,chatId}=creds();
  const r=await fetch(`https://api.telegram.org/bot${token}/sendMessage`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({chat_id:chatId,text:`<b>ŞAOMİ SİSTEM</b>\n${esc(text).slice(0,3000)}`,parse_mode:'HTML',disable_web_page_preview:true}),signal:AbortSignal.timeout(15000)});
  const j=await r.json().catch(()=>({}));
  if(!r.ok||!j.ok)throw new Error(j?.description||`Telegram HTTP ${r.status}`);
  return NextResponse.json({ok:true,messageId:j?.result?.message_id,type:'system'});
 }catch(e){return NextResponse.json({ok:false,error:e instanceof Error?e.message:String(e)},{status:502})}
}
