'use client';

import {useEffect,useMemo,useState} from 'react';

type Row=Record<string,any>;

function num(v:any){
  const n=Number(v);
  if(!Number.isFinite(n)) return '—';
  const a=Math.abs(n),d=a>=1000?1:a>=100?2:a>=1?4:a>=.1?5:7;
  return n.toFixed(d).replace(/0+$/,'').replace(/\.$/,'');
}
function yes(v:any){return v?'EVET':'HAYIR'}

export default function Page(){
  const [row,setRow]=useState<Row|null>(null);
  const [error,setError]=useState('');
  const [updated,setUpdated]=useState<Date|null>(null);

  async function refresh(){
    try{
      const res=await fetch('/api/tracker?limit=80',{cache:'no-store'});
      const j=await res.json();
      if(!res.ok||!j?.ok) throw new Error(j?.error||'Tracker okunamadı');
      const active=Object.values(j.activeSignals||{}) as Row[];
      const latest=(j.latest&&typeof j.latest==='object')?j.latest:(active[0]||null);
      setRow(latest); setError(''); setUpdated(new Date());
    }catch(e:any){setError(e?.message||'Bağlantı hatası')}
  }
  useEffect(()=>{refresh();const id=setInterval(refresh,15000);return()=>clearInterval(id)},[]);

  const trigger=row?.entryTrigger||{};
  const zone=trigger.zone||row?.orhanSetup?.zone||{};
  const compression=trigger.compression||row?.orhanSetup?.compression||{};
  const reclaim=trigger.reclaim||row?.orhanSetup?.reclaim||{};
  const trendline=trigger.trendline||{};
  const confluence=trigger.confluence||{};
  const breakout=trigger.breakout||row?.orhanSetup?.sequence?.breakout||{};
  const confirmation=trigger.confirmation||row?.orhanSetup?.sequence?.confirmation||null;
  const direction=String(row?.direction||'').toUpperCase();
  const status=String(row?.status||'BEKLE').toUpperCase();
  const hasSignal=direction==='LONG'||direction==='SHORT';
  const decision=hasSignal?direction:'BEKLE';
  const conf=Number.isFinite(Number(row?.confidence))?Math.round(Number(row?.confidence)):null;
  const zoneReady=Number(zone?.touches||0)>=3;
  const firstBreakReady=Boolean(reclaim?.firstBreak);
  const roleFlipReady=Boolean(reclaim?.roleRetest);
  const liquidityReady=Boolean(reclaim?.liquiditySweep?.tookLiquidity);
  const reentryReady=Boolean(reclaim?.reclaim);
  const trendReady=Boolean(trendline?.p1&&trendline?.p2);
  const dualBreakReady=Boolean(breakout?.dualBreak);
  const confirmReady=Boolean(confirmation?.holdsHorizontal&&confirmation?.holdsTrend);
  const riskReady=Number.isFinite(Number(row?.stop))&&Boolean(row?.orhanSetup?.stopAnchor||reclaim?.liquiditySweep);
  const htf=String(row?.topDownContext?.decision?.summary||row?.orhanSetup?.htfContext||'Bilgi amaçlı; veto değil');

  const cards=useMemo(()=>[
    {
      n:1,title:'YATAY DESTEK / DİRENÇ BÖLGESİ',ok:zoneReady,
      strong:zoneReady?('HAZIR · '+(zone.touches??'—')+' temas'):'Bölge aranıyor',
      text:zoneReady
        ? `Bölge ${num(zone.low)}–${num(zone.high)} · fitil/gövde reaksiyonu ${zone.reactionTouches??'—'} · rol değişimi: ${yes(zone.roleReversal)}.`
        :'Aynı fiyat çevresinde tekrarlanan fitil/gövde tepkileri ve güçlü yatay S/R aranıyor.'
    },
    {
      n:2,title:'İLK KIRILIM + ROL DEĞİŞİMİ',ok:firstBreakReady&&roleFlipReady,
      strong:firstBreakReady&&roleFlipReady?'KIRILDI · KARŞI ROLDE TEST EDİLDİ':'İlk kırılım / rol testi bekleniyor',
      text:firstBreakReady&&roleFlipReady
        ? `İlk kırılım ${reclaim.firstBreak?.time?'tespit edildi':'—'} · eski seviye karşı taraftan retest edildi.`
        :'LONG için destek önce aşağı kırılıp dirence; SHORT için direnç önce yukarı kırılıp desteğe dönmeli.'
    },
    {
      n:3,title:'LİKİDİTE ALIMI',ok:liquidityReady,
      strong:liquidityReady?'SON DİP/TEPE LİKİDİTESİ ALINDI':'Likidite süpürmesi bekleniyor',
      text:liquidityReady
        ? `Önceki likidite ${num(reclaim.priorLiquidity?.price)} · süpürme ekstremi ${num(reclaim.liquiditySweep?.extreme)}.`
        :'Fiyat yeniden içeri dönmeden önce son yapısal dip/tepe likiditesini almalı.'
    },
    {
      n:4,title:'YENİDEN İÇERİ GİRİŞ',ok:reentryReady,
      strong:reentryReady?'SEVİYE GERİ ALINDI':'Reclaim bekleniyor',
      text:reentryReady
        ? 'Fiyat eski destek/direnç bölgesini yeniden geri aldı ve alan içine kapandı.'
        :'Süpürmeden sonra fiyat eski seviyenin öbür tarafına kapanarak bölgeyi reclaim etmeli.'
    },
    {
      n:5,title:'TREND ÇİZGİSİ + ÇİFT KIRILIM',ok:trendReady&&dualBreakReady,
      strong:trendReady&&dualBreakReady?'YATAY + TREND AYNI ANDA KIRILDI':'Trend / yatay kesişim bekleniyor',
      text:trendReady&&dualBreakReady
        ? `Trend temasları ${trendline.touches??'—'} · kesişim uzaklığı ${breakout.confluenceDistanceAtr??confluence.zoneTrendlineGapAtr??'—'} ATR.`
        :'Fitil uçlarından çizilen trend çizgisi ile yatay S/R aynı bölgede kırılmalı.'
    },
    {
      n:6,title:'ONAY MUMU',ok:confirmReady,
      strong:confirmReady?'İKİ SEVİYE DE KORUNDU':'Onay bekleniyor',
      text:confirmReady
        ? 'Sonraki mum hem yatay bölgenin hem trend çizgisinin doğru tarafında kapandı.'
        :'Tek kırılım yetmez; sonraki mum iki seviyeyi de korumalı.'
    },
    {
      n:7,title:'YAPISAL STOP / KÂR KORUMA',ok:riskReady,
      strong:riskReady?('STOP '+num(row?.stop)):'Stop hesaplanmadı',
      text:riskReady
        ? `Stop likiditeyi alan son yapısal ${direction==='LONG'?'dibin':'tepenin'} hemen dışında. TP1 ${num(row?.tp1)} sonrası BE, TP2 ${num(row?.tp2)} sonrası stop TP1'e taşınır.`
        :'Stop ATR’ye göre rastgele değil; likiditeyi alan son yapısal dip/tepenin dışına konur.'
    },
    {
      n:8,title:'HTF / EMA200',ok:true,
      strong:'BİLGİ AMAÇLI · VETO DEĞİL',
      text:htf
    }
  ],[row,zoneReady,firstBreakReady,roleFlipReady,liquidityReady,reentryReady,trendReady,dualBreakReady,confirmReady,riskReady,direction,zone,reclaim,trendline,breakout,confluence,htf]);

  return <main style={S.page}>
    <header style={S.header}>
      <div>
        <div style={S.brand}>₿ <b>ŞAOMİ TRADE AI</b></div>
        <div style={S.sub}>RC5.58 · ORHAN S/R + LİKİDİTE RECLAIM</div>
      </div>
      <div style={S.live}><span style={S.dot}/> Binance FUTURES · Tracker canlı</div>
    </header>

    <section style={S.topGrid}>
      <div style={S.box}>
        <span style={S.muted}>İNCELENEN / TAKİP</span>
        <div style={S.symbol}>{row?.symbol||'—'} · {row?.timeframe||'—'}</div>
        <small style={S.muted}>{updated?'Son yenileme '+updated.toLocaleTimeString('tr-TR'):'Bağlanıyor...'}</small>
      </div>
      <div style={S.box}>
        <span style={S.muted}>KARAR</span>
        <div style={{...S.decision,color:decision==='LONG'?'#46d19a':decision==='SHORT'?'#ff6b7f':'#f4c84a'}}>{decision}</div>
        <div style={S.muted}>{status}{conf!=null?' · %'+conf:''}</div>
      </div>
    </section>

    <div style={S.banner}>
      {error?'⚠ '+error:
       !row?'⏳ WAIT · Aktif takip kaydı bekleniyor':
       hasSignal?'✓ ORHAN SETUP · S/R → rol değişimi → likidite → reclaim → çift kırılım → onay':'⏳ WAIT · ORHAN SETUP oluşmadı'}
    </div>

    <h3 style={S.pathTitle}>ORHAN SETUP RC5.58 KARAR YOLU</h3>
    <section style={S.cards}>
      {cards.map(c=><article key={c.n} style={{...S.card,borderColor:c.ok?'#225d4d':'#672837'}}>
        <div style={S.cardHead}><b>{c.ok?'✓':'×'} {c.title}</b><b style={{fontSize:30,color:c.ok?'#2e9c77':'#b53d58'}}>{c.n}</b></div>
        <div style={S.strong}>{c.strong}</div>
        <div style={S.text}>{c.text}</div>
      </article>)}
    </section>

    <h3 style={S.pathTitle}>KULLANDIĞI APARATLAR</h3>
    <section style={S.tools}>
      {['Yatay S/R','Fitil Dip/Tepe','Rol Değişimi','Likidite Sweep','Reclaim','Trend Çizgisi','Çift Kırılım','Onay Mumu','Yapısal Stop','TP1→BE','TP2→TP1','Tracker','Telegram Senkron'].map(x=><span key={x} style={S.tool}>{x}</span>)}
    </section>

    <footer style={S.footer}>
      <span style={{color:'#65d7a8'}}>Terminal</span><span>Radar</span><span>Paper</span><span>Backtest</span><span>Performans</span>
    </footer>
  </main>
}

const S:Record<string,React.CSSProperties>={
  page:{minHeight:'100vh',background:'#07101d',color:'#e8edf5',fontFamily:'Arial,sans-serif',padding:'18px 14px 84px',boxSizing:'border-box'},
  header:{display:'flex',justifyContent:'space-between',gap:12,alignItems:'center',maxWidth:820,margin:'0 auto 18px'},
  brand:{fontSize:23,display:'flex',gap:10,alignItems:'center'},sub:{fontSize:12,color:'#7f8da2',marginTop:5},
  live:{fontSize:12,color:'#8c99aa',whiteSpace:'nowrap'},dot:{display:'inline-block',width:9,height:9,borderRadius:99,background:'#5ba6ff',marginRight:6},
  topGrid:{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,maxWidth:820,margin:'0 auto'},
  box:{border:'1px solid #24324a',background:'#0b1525',borderRadius:18,padding:18,minHeight:95},
  muted:{color:'#7f899b',fontSize:13},symbol:{fontSize:26,fontWeight:700,margin:'7px 0'},decision:{fontSize:28,fontWeight:800,margin:'7px 0'},
  banner:{maxWidth:820,margin:'14px auto',border:'1px solid #2a3951',background:'#0a1423',borderRadius:14,padding:'12px 16px',color:'#9faabd'},
  pathTitle:{maxWidth:820,margin:'24px auto 10px',fontSize:15,fontWeight:500,color:'#7d8798',letterSpacing:1},
  cards:{display:'grid',gap:12,maxWidth:820,margin:'0 auto'},card:{border:'1px solid',background:'#0b1525',borderRadius:18,padding:'15px 17px'},
  tools:{display:'grid',gridTemplateColumns:'repeat(3,minmax(0,1fr))',gap:10,maxWidth:820,margin:'0 auto 12px'},
  tool:{border:'1px solid #23324a',background:'#0b1525',borderRadius:12,padding:'10px 8px',textAlign:'center',fontSize:12,color:'#9da9bc'},
  cardHead:{display:'flex',alignItems:'center',justifyContent:'space-between',fontSize:17},strong:{fontSize:17,fontWeight:700,margin:'4px 0 8px'},text:{color:'#8e99aa',lineHeight:1.45,fontSize:14},
  footer:{position:'fixed',left:0,right:0,bottom:0,height:68,background:'#091220',borderTop:'1px solid #172236',display:'flex',alignItems:'center',justifyContent:'space-around',color:'#707b8f',fontSize:13}
};
