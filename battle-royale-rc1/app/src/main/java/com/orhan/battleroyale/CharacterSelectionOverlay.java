package com.orhan.battleroyale;

import android.content.Context;
import android.graphics.*;
import android.view.MotionEvent;
import android.view.View;

public class CharacterSelectionOverlay extends View {
    private final GameView gameView;
    private final Paint p = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final RectF male = new RectF(), female = new RectF(), start = new RectF();

    public CharacterSelectionOverlay(Context c, GameView gv) {
        super(c);
        gameView = gv;
        setLayerType(View.LAYER_TYPE_SOFTWARE, null);
    }

    @Override protected void onDraw(Canvas c) {
        super.onDraw(c);
        GameRenderer r = gameView.getGameRenderer();
        int w=getWidth(), h=getHeight();

        if (!r.isRunning()) {
            p.setColor(0x50000000);
            c.drawRect(0,0,w,h,p);

            p.setTypeface(Typeface.create(Typeface.DEFAULT, Typeface.BOLD));
            p.setTextAlign(Paint.Align.CENTER);
            p.setColor(Color.WHITE);
            p.setTextSize(h*0.060f);
            p.setShadowLayer(8,0,2,Color.BLACK);
            c.drawText("ŞAOMİ BATTLE ROYALE", w/2f, h*0.11f, p);

            p.setTextSize(h*0.030f);
            c.drawText("RC2 — 3D KARAKTER SEÇİMİ", w/2f, h*0.165f, p);

            float cardW=w*0.28f, cardH=h*0.56f;
            male.set(w*0.17f,h*0.22f,w*0.17f+cardW,h*0.22f+cardH);
            female.set(w*0.55f,h*0.22f,w*0.55f+cardW,h*0.22f+cardH);

            drawCard(c,male,r.getSelectedCharacter()==0,"ERKEK","ANA OYUNCU");
            drawCard(c,female,r.getSelectedCharacter()==1,"KADIN","ALTERNATİF");

            start.set(w*0.37f,h*0.83f,w*0.63f,h*0.95f);
            p.setColor(0xE03A6FAE);
            c.drawRoundRect(start,26,26,p);
            p.setColor(Color.WHITE);
            p.setTextSize(h*0.041f);
            c.drawText("OYUNA BAŞLA",start.centerX(),start.centerY()+p.getTextSize()*0.35f,p);
        } else {
            p.clearShadowLayer();
            p.setTextAlign(Paint.Align.LEFT);
            p.setTextSize(h*0.034f);
            p.setColor(Color.WHITE);
            c.drawText("CAN "+(int)r.getHealth(),24,44,p);
            c.drawText("MERMİ "+r.getAmmo(),24,84,p);
            p.setTextAlign(Paint.Align.RIGHT);
            c.drawText("KALAN "+r.getAliveCount(),w-24,44,p);

            p.setTextAlign(Paint.Align.CENTER);
            p.setTextSize(h*0.027f);
            c.drawText(r.getSelectedCharacter()==0 ? "ERKEK" : "KADIN",w/2f,40,p);

            p.setColor(0x55999999);
            c.drawCircle(w*0.11f,h*0.80f,h*0.12f,p);
            p.setColor(0xAA8E1D2D);
            c.drawCircle(w*0.89f,h*0.80f,h*0.10f,p);
            p.setColor(Color.WHITE);
            p.setTextSize(h*0.025f);
            c.drawText("ATEŞ",w*0.89f,h*0.81f,p);
        }
        postInvalidateOnAnimation();
    }

    private void drawCard(Canvas c, RectF r, boolean selected, String title, String sub) {
        p.setStyle(Paint.Style.FILL);
        p.setColor(selected?0x883A6FAE:0x66303030);
        c.drawRoundRect(r,28,28,p);

        p.setStyle(Paint.Style.STROKE);
        p.setStrokeWidth(selected?6:2);
        p.setColor(selected?0xFFE9C56A:0x88FFFFFF);
        c.drawRoundRect(r,28,28,p);
        p.setStyle(Paint.Style.FILL);

        p.setColor(Color.WHITE);
        p.setTextSize(getHeight()*0.040f);
        c.drawText(title,r.centerX(),r.bottom-getHeight()*0.085f,p);

        p.setTextSize(getHeight()*0.022f);
        p.setColor(0xFFDDDDDD);
        c.drawText(sub,r.centerX(),r.bottom-getHeight()*0.045f,p);
    }

    @Override public boolean onTouchEvent(MotionEvent e) {
        if (e.getAction()!=MotionEvent.ACTION_DOWN) return true;

        GameRenderer r=gameView.getGameRenderer();
        float x=e.getX(), y=e.getY();

        if (!r.isRunning()) {
            if (male.contains(x,y)) gameView.selectCharacter(0);
            else if (female.contains(x,y)) gameView.selectCharacter(1);
            else if (start.contains(x,y)) gameView.startSelectedCharacter();
            return true;
        }

        // Oyun sırasında dokunmayı alttaki GameView'e geçir.
        return false;
    }
}
