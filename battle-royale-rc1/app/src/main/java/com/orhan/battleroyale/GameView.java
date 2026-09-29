package com.orhan.battleroyale;

import android.content.Context;
import android.opengl.GLSurfaceView;
import android.view.MotionEvent;

public class GameView extends GLSurfaceView {
    private final GameRenderer renderer;
    private float moveOriginX, moveOriginY, lastLookX, lastLookY;
    private int movePointer=-1, lookPointer=-1;

    public GameView(Context context) {
        super(context);
        setEGLContextClientVersion(2);
        renderer = new GameRenderer();
        setRenderer(renderer);
        setRenderMode(GLSurfaceView.RENDERMODE_CONTINUOUSLY);
        setPreserveEGLContextOnPause(true);
    }

    public GameRenderer getGameRenderer(){ return renderer; }

    public void selectCharacter(int index){ queueEvent(() -> renderer.selectCharacter(index)); }
    public void startSelectedCharacter(){ queueEvent(renderer::startMatch); }

    @Override public boolean onTouchEvent(MotionEvent e) {
        if (!renderer.isRunning()) return false;

        int a=e.getActionMasked(), idx=e.getActionIndex(), id=e.getPointerId(idx);

        if (a==MotionEvent.ACTION_DOWN || a==MotionEvent.ACTION_POINTER_DOWN) {
            float x=e.getX(idx), y=e.getY(idx);
            if (x < getWidth()*0.42f && movePointer<0) {
                movePointer=id; moveOriginX=x; moveOriginY=y;
            } else if (x > getWidth()*0.78f && y > getHeight()*0.58f) {
                renderer.setFire(true);
            } else if (lookPointer<0) {
                lookPointer=id; lastLookX=x; lastLookY=y;
            }
        } else if (a==MotionEvent.ACTION_MOVE) {
            for(int i=0;i<e.getPointerCount();i++){
                int pid=e.getPointerId(i);
                float x=e.getX(i), y=e.getY(i);
                if(pid==movePointer){
                    float r=Math.min(getWidth(),getHeight())*0.14f;
                    float dx=(x-moveOriginX)/r, dy=(y-moveOriginY)/r;
                    float len=(float)Math.sqrt(dx*dx+dy*dy);
                    if(len>1){dx/=len;dy/=len;}
                    renderer.move(dx,-dy);
                } else if(pid==lookPointer){
                    renderer.look((x-lastLookX)*0.16f,(y-lastLookY)*0.12f);
                    lastLookX=x;lastLookY=y;
                }
            }
        } else if (a==MotionEvent.ACTION_POINTER_UP || a==MotionEvent.ACTION_UP || a==MotionEvent.ACTION_CANCEL) {
            if(id==movePointer){movePointer=-1;renderer.move(0,0);}
            if(id==lookPointer)lookPointer=-1;
            renderer.setFire(false);
        }
        return true;
    }
}
