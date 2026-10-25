import assert from 'node:assert/strict';
import { test } from 'node:test';
import { evaluate, verify } from './saomi-free-btc15m.mjs';
const t=Date.UTC(2026,9,25);
const base=()=>Array.from({length:300},(_,i)=>({
 openTime:t+i*900000,closeTime:t+i*900000+899999,
 open:100,high:100.9,low:99.1,close:100,volume:100,closed:true
}));
const technical={atr14:1.2,rsi14:58,macd:{histogram:2},
 supertrend10_3:{direction:'UP'},ema:{'9':101,'21':100},volume20Average:100};
test('flat market is BEKLE',()=>assert.equal(evaluate(base(),technical).decision,'BEKLE'));
test('closed breakout+retest+volume+momentum produces candidate LONG',()=>{
 const c=base();
 c[298]={...c[298],open:100,close:102,high:102.3,low:99.8,volume:180};
 c[299]={...c[299],open:102,close:101.4,high:102.2,low:100.85,volume:100};
 const d=evaluate(c,technical);
 assert.equal(d.decision,'LONG');
 assert.ok(d.tp1-d.entry >= (d.entry-d.stop)*2-.02);
 assert.equal(evaluate(c,{...technical,rsi14:43}).decision,'BEKLE');
});
test('dual API must agree on last closed candle and continuity',()=>{
 const c=base(),last=c.at(-1),fetchedAt=new Date(last.closeTime).toISOString();
 const a={fetchedAt,closedCandleCount:300,lastClosedCandle:{close:last.close,closeTime:last.closeTime},indicators:technical};
 assert.equal(verify(a,{fetchedAt,candles:c},last.closeTime+60000).length,300);
 const bad=structuredClone(c);bad.at(-1).close=99;
 assert.throws(()=>verify(a,{fetchedAt,candles:bad},last.closeTime+60000),/disagree/);
});
