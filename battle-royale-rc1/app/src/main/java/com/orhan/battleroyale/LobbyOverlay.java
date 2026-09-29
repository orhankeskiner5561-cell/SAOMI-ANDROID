package com.orhan.battleroyale;
import android.content.*;import android.graphics.*;import android.view.*;
public class LobbyOverlay extends View{
 final GameView game; final Paint p=new Paint(1); int tab=0,sex=0,mode=0; RectF start=new RectF();
 String[] tabs={"KARAKTER","YÜZ","SAÇ","MONT","PANTOLON","BOT","ŞAPKA","ÇANTA","SİLAH"};
 public LobbyOverlay(Context c,GameView g){super(c);game=g;}
 protected void onDraw(Canvas c){int w=getWidth(),h=getHeight();if(game.getGameRenderer().isRunning()){setVisibility(INVISIBLE);return;}
 p.setTypeface(Typeface.create("sans",1));p.setColor(0x88000000);c.drawRect(0,0,w,h,p);
 p.setColor(Color.WHITE);p.setTextSize(h*.05f);p.setTextAlign(Paint.Align.LEFT);c.drawText("ŞAOMİ BATTLE ROYALE",w*.035f,h*.075f,p);
 p.setTextSize(h*.022f);p.setColor(0xffc9c9c9);c.drawText("RC3  •  KARAKTER LOBİSİ",w*.038f,h*.115f,p);
 float x=w*.035f,y=h*.18f,bh=h*.065f;
 for(int i=0;i<tabs.length;i++){p.setColor(i==tab?0xff386aa5:0x99303030);RectF r=new RectF(x,y+i*bh,w*.18f,y+i*bh+bh*.78f);c.drawRoundRect(r,12,12,p);p.setColor(Color.WHITE);p.setTextSize(h*.022f);c.drawText(tabs[i],r.left+18,r.centerY()+8,p);}
 p.setTextAlign(Paint.Align.CENTER);p.setColor(Color.WHITE);p.setTextSize(h*.027f);c.drawText(sex==0?"ERKEK • ANA KARAKTER":"KADIN • ALTERNATİF",w*.52f,h*.12f,p);
 p.setTextSize(h*.019f);p.setColor(0xffdddddd);c.drawText("Karakteri sürükle: 360° döndür  •  iki parmak: yakınlaştır",w*.52f,h*.16f,p);
 RectF male=new RectF(w*.73f,h*.19f,w*.83f,h*.27f),female=new RectF(w*.84f,h*.19f,w*.94f,h*.27f);
 button(c,male,"ERKEK",sex==0);button(c,female,"KADIN",sex==1);
 RectF solo=new RectF(w*.73f,h*.70f,w*.83f,h*.78f),team=new RectF(w*.84f,h*.70f,w*.96f,h*.78f);
 button(c,solo,"TEKLİ",mode==0);button(c,team,"4 KİŞİ",mode==1);
 start.set(w*.73f,h*.82f,w*.96f,h*.94f);p.setColor(0xff3b72b5);c.drawRoundRect(start,22,22,p);p.setColor(Color.WHITE);p.setTextSize(h*.032f);c.drawText("OYUNA BAŞLA",start.centerX(),start.centerY()+10,p);
 p.setTextAlign(Paint.Align.LEFT);p.setTextSize(h*.018f);p.setColor(0xffbbbbbb);c.drawText("Kıyafet parçaları RC3 gardırop slotlarına bağlandı.",w*.73f,h*.66f,p);
 postInvalidateOnAnimation();}
 void button(Canvas c,RectF r,String s,boolean on){p.setColor(on?0xff9b6a25:0x99333333);c.drawRoundRect(r,14,14,p);p.setColor(Color.WHITE);p.setTextSize(getHeight()*.021f);p.setTextAlign(Paint.Align.CENTER);c.drawText(s,r.centerX(),r.centerY()+7,p);}
 public boolean onTouchEvent(android.view.MotionEvent e){if(e.getAction()!=0)return true;float x=e.getX(),y=e.getY(),w=getWidth(),h=getHeight();float yy=h*.18f,bh=h*.065f;if(x<w*.2f&&y>=yy){int i=(int)((y-yy)/bh);if(i>=0&&i<tabs.length){tab=i;game.getGameRenderer().setWardrobe(tab);return true;}}
 if(y>h*.19f&&y<h*.28f){if(x>w*.73f&&x<w*.83f){sex=0;game.selectCharacter(0);}else if(x>w*.84f){sex=1;game.selectCharacter(1);}}
 if(y>h*.70f&&y<h*.79f){if(x>w*.73f&&x<w*.83f)mode=0;else if(x>w*.84f)mode=1;}
 if(start.contains(x,y)){game.getGameRenderer().setTeamMode(mode);game.startSelectedCharacter();}return true;}
}