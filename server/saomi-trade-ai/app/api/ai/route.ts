import {NextRequest,NextResponse} from 'next/server';
export const dynamic='force-dynamic';
export const runtime='nodejs';
function fallback(a:any){const d=a.direction==='LONG'?'yukarı yön':'aşağı yön';return `${a.symbol} ${a.timeframe} için mevcut hesaplamada ${d} daha güçlü. Güven ${a.confidence}%. Giriş ${a.entry}, stop ${a.stop}, hedefler ${a.tp1} / ${a.tp2} / ${a.tp3}. Bu değerlendirme olasılıksaldır; yapı bozulursa işlem bekletilmelidir.`}
function plain(s:string){return String(s||'').replace(/\*\*/g,'').replace(/^#{1,6}\s*/gm,'').replace(/`{1,3}/g,'').trim()}
export async function POST(req:NextRequest){
 const a=await req.json();const key=process.env.GEMINI_API_KEY;
 if(!key)return NextResponse.json({provider:'kural motoru (Gemini anahtarı bekliyor)',commentary:fallback(a)});
 const model=process.env.GEMINI_MODEL||'gemini-3.6-flash';
 const prompt=`Sen ŞAOMİ TRADE AI yorumcususun. Yalnızca verilen JSON verilerini kullan. Yeni fiyat, indikatör, giriş, stop veya hedef uydurma. Matematik motorunun yönünü değiştirme. Kesin kazanç dili kullanma. Türkçe, kısa, profesyonel ve anlaşılır yorum yap. Markdown kullanma; yıldız, başlık işareti veya kod bloğu kullanma. Veride çelişki varsa BEKLE uyarısı yap.\n\n${JSON.stringify(a)}`;
 try{
  const r=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,{method:'POST',headers:{'content-type':'application/json','x-goog-api-key':key},body:JSON.stringify({contents:[{parts:[{text:prompt}]}],generationConfig:{maxOutputTokens:520}}),signal:AbortSignal.timeout(18000)});
  if(!r.ok){const body=await r.text();console.error('Gemini HTTP error',r.status,body);throw new Error(`Gemini HTTP ${r.status}: ${body}`)}
  const j=await r.json();const commentary=plain(j?.candidates?.[0]?.content?.parts?.map((p:any)=>p.text).filter(Boolean).join('\n')||fallback(a));
  console.info('Gemini success',{model,symbol:a.symbol,timeframe:a.timeframe});
  return NextResponse.json({provider:`Gemini · ${model}`,commentary});
 }catch(e){console.error('Gemini fallback',e);return NextResponse.json({provider:'kural motoru (Gemini fallback)',commentary:fallback(a),warning:e instanceof Error?e.message:'Gemini hatası'})}
}
