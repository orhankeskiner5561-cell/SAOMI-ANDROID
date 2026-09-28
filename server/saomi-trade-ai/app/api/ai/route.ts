import {NextRequest,NextResponse} from 'next/server';
export const dynamic='force-dynamic';
export const runtime='nodejs';

function plain(s:string){return String(s||'').replace(/\*\*/g,'').replace(/^#{1,6}\s*/gm,'').replace(/`{1,3}/g,'').trim()}
function n(v:any){return Number.isFinite(Number(v))?Number(v):null}
function feature(a:any){
  const f=a?.featureSnapshot||{};
  const structure=String(f?.structure||f?.structureTrend||'RANGE');
  const sweep=String(f?.lastSweep?.side||f?.smartMoney?.lastSweep?.side||'yok');
  return{structure,sweep}
}
function reasons(a:any){return Array.isArray(a?.reasons)?a.reasons.map((x:any)=>String(x)).filter(Boolean):[]}
function fallback(a:any){
  const out=String(a?.outcome||'').toUpperCase();
  const {structure,sweep}=feature(a);
  const rs=reasons(a);
  const incomplete=rs.find((x:string)=>/tamamlanmadı|tamamlanmadi|bekleniyor|işlem yok|islem yok/i.test(x));
  const dir=String(a?.direction||'BEKLE');
  const sym=String(a?.symbol||'');
  const tf=String(a?.timeframe||'');
  const conf=n(a?.confidence);
  if(out==='TP3') return `${sym} ${tf} ${dir} işlem TP3'e ulaştı. Doğru: yapı ${structure}, son sweep ${sweep} ve yön planla uyumlu kaldı. Öğrenme: aynı setup imzası tekrar oluştuğunda teyitler korunursa güven artırılabilir.`;
  if(out==='BE_AFTER_TP1') return `${sym} ${tf} ${dir} işlem TP1 gördükten sonra stop girişe taşındı ve başa baş korundu. Doğru: kâr/sermaye koruma kuralı çalıştı. Öğrenme: TP1 sonrası eski stopta beklemek yerine giriş seviyesi korunmalı.`;
  if(out==='PROTECTED_TP1_AFTER_TP2') return `${sym} ${tf} ${dir} işlem TP2 gördükten sonra stop TP1'e taşındı ve kârlı koruma ile kapandı. Doğru: hedef sonrası dinamik stop çalıştı. Öğrenme: benzer setup'ta TP2 sonrası TP1 koruması sürdürülmeli.`;
  if(out.startsWith('STOP')){
    if(incomplete) return `${sym} ${tf} ${dir} işlem stop oldu. Hata: karar kaydında teyit tamamlanmadığı halde işlem açılmış: ${incomplete}. Doğru: yapı ${structure}, sweep ${sweep} kayda alınmış. Öğrenme: bu eksik teyit tekrarında işlem WAIT kalmalı; zorla işlem açılmamalı.`;
    return `${sym} ${tf} ${dir} işlem hedefe ulaşmadan stop oldu. Hata: giriş/stop geometrisi veya karşı likidite hareketi planı bozdu. Doğru: sonuç ve setup imzası hafızaya kaydedildi. Öğrenme: aynı ${structure}/${sweep} bağlamında retest ve karşı likidite teyidi güçlenmeden güven artırılmamalı.`;
  }
  const request=String(a?.request||'').toLowerCase();
  if(/neden|niye|öğren|ogren|hata|doğru|dogru/.test(request)&&a?.memoryLesson) return `${sym} ${tf}: ${plain(String(a.memoryLesson)).slice(0,700)}`;
  const d=dir==='LONG'?'yukarı yön':dir==='SHORT'?'aşağı yön':'bekle';
  return `${sym} ${tf} için mevcut hesaplamada ${d} öne çıkıyor${conf!=null?'. Güven '+conf+'%':''}. Giriş ${a.entry}, stop ${a.stop}, hedefler ${a.tp1} / ${a.tp2} / ${a.tp3}. Bu değerlendirme olasılıksaldır; yapı bozulursa işlem bekletilmelidir.`;
}
export async function POST(req:NextRequest){
 const a=await req.json();const key=process.env.GEMINI_API_KEY;
 if(!key)return NextResponse.json({provider:'kural motoru (Gemini anahtarı bekliyor)',commentary:fallback(a)});
 const model=process.env.GEMINI_MODEL||'gemini-3.6-flash';
 const prompt=`Sen ŞAOMİ TRADE AI yorumcususun. Yalnızca verilen JSON verilerini kullan. Yeni fiyat, indikatör, giriş, stop veya hedef uydurma. Matematik motorunun yönünü değiştirme. Kesin kazanç dili kullanma. Kullanıcının request alanındaki görevi doğrudan yerine getir. Eğer outcome varsa sonucu, Hata, Doğru ve Öğrenme açısından değerlendir. reasons içinde tamamlanmadı/bekleniyor gibi eksik teyit varken işlem açılmışsa bunu açıkça hata olarak belirt. Türkçe, kısa, profesyonel ve anlaşılır yorum yap. Markdown kullanma; yıldız, başlık işareti veya kod bloğu kullanma. Veride çelişki varsa BEKLE uyarısı yap.\n\n${JSON.stringify(a)}`;
 try{
  const r=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,{method:'POST',headers:{'content-type':'application/json','x-goog-api-key':key},body:JSON.stringify({contents:[{parts:[{text:prompt}]}],generationConfig:{maxOutputTokens:520}}),signal:AbortSignal.timeout(18000)});
  if(!r.ok){const body=await r.text();console.error('Gemini HTTP error',r.status,body);throw new Error(`Gemini HTTP ${r.status}: ${body}`)}
  const j=await r.json();const commentary=plain(j?.candidates?.[0]?.content?.parts?.map((p:any)=>p.text).filter(Boolean).join('\n')||fallback(a));
  console.info('Gemini success',{model,symbol:a.symbol,timeframe:a.timeframe,outcome:a.outcome||null});
  return NextResponse.json({provider:`Gemini · ${model}`,commentary});
 }catch(e){console.error('Gemini fallback',e);return NextResponse.json({provider:'kural motoru (Gemini fallback)',commentary:fallback(a),warning:e instanceof Error?e.message:'Gemini hatası'})}
}
