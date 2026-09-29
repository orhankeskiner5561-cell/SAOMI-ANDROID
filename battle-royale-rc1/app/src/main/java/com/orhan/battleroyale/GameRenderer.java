package com.orhan.battleroyale;

import android.opengl.GLES20;
import android.opengl.GLSurfaceView;
import android.opengl.Matrix;
import android.os.SystemClock;
import java.nio.*;
import java.util.*;
import javax.microedition.khronos.egl.EGLConfig;
import javax.microedition.khronos.opengles.GL10;

public class GameRenderer implements GLSurfaceView.Renderer {
    static class Actor { float x,z,hp=100,cool=0; boolean alive=true; Actor(float x,float z){this.x=x;this.z=z;} }

    private final ArrayList<Actor> enemies=new ArrayList<>();
    private FloatBuffer cubeVB;
    private int program,aPos,uMVP,uColor;
    private final float[] proj=new float[16],view=new float[16],model=new float[16],mvp=new float[16],tmp=new float[16];

    private float px=0,pz=9,yaw=180,pitch=-10,moveX=0,moveY=0,hp=100;
    private int ammo=30, selectedCharacter=0, wardrobeSlot=0, teamMode=0;
    private boolean running=false,fire=false,ended=false;
    private long lastMs=0,nextShot=0;
    private float previewSpin=0;

    private static final float[] CUBE={
        -.5f,-.5f,.5f,.5f,-.5f,.5f,.5f,.5f,.5f,-.5f,-.5f,.5f,.5f,.5f,.5f,-.5f,.5f,.5f,
        .5f,-.5f,-.5f,-.5f,-.5f,-.5f,-.5f,.5f,-.5f,.5f,-.5f,-.5f,-.5f,.5f,-.5f,.5f,.5f,-.5f,
        -.5f,-.5f,-.5f,-.5f,-.5f,.5f,-.5f,.5f,.5f,-.5f,-.5f,-.5f,-.5f,.5f,.5f,-.5f,.5f,-.5f,
        .5f,-.5f,.5f,.5f,-.5f,-.5f,.5f,.5f,-.5f,.5f,-.5f,.5f,.5f,.5f,-.5f,.5f,.5f,.5f,
        -.5f,.5f,.5f,.5f,.5f,.5f,.5f,.5f,-.5f,-.5f,.5f,.5f,.5f,.5f,-.5f,-.5f,.5f,-.5f,
        -.5f,-.5f,-.5f,.5f,-.5f,-.5f,.5f,-.5f,.5f,-.5f,-.5f,-.5f,.5f,-.5f,.5f,-.5f,-.5f,.5f
    };

    private static FloatBuffer buf(float[] a){
        ByteBuffer b=ByteBuffer.allocateDirect(a.length*4).order(ByteOrder.nativeOrder());
        FloatBuffer f=b.asFloatBuffer();f.put(a).position(0);return f;
    }

    @Override public void onSurfaceCreated(GL10 gl,EGLConfig cfg){
        GLES20.glClearColor(.035f,.045f,.075f,1);
        GLES20.glEnable(GLES20.GL_DEPTH_TEST);
        GLES20.glEnable(GLES20.GL_CULL_FACE);
        cubeVB=buf(CUBE);
        program=program(
            "attribute vec3 aPos;uniform mat4 uMVP;void main(){gl_Position=uMVP*vec4(aPos,1.0);}",
            "precision mediump float;uniform vec4 uColor;void main(){gl_FragColor=uColor;}"
        );
        aPos=GLES20.glGetAttribLocation(program,"aPos");
        uMVP=GLES20.glGetUniformLocation(program,"uMVP");
        uColor=GLES20.glGetUniformLocation(program,"uColor");
    }

    @Override public void onSurfaceChanged(GL10 gl,int w,int h){
        GLES20.glViewport(0,0,w,h);
        Matrix.perspectiveM(proj,0,58f,(float)w/h,.1f,120f);
    }

    @Override public void onDrawFrame(GL10 gl){
        long now=SystemClock.uptimeMillis();
        float dt=lastMs==0?.016f:Math.min(.033f,(now-lastMs)/1000f);
        lastMs=now;

        if(running) update(dt,now);
        else previewSpin += dt*18f;

        GLES20.glClear(GLES20.GL_COLOR_BUFFER_BIT|GLES20.GL_DEPTH_BUFFER_BIT);

        if(running){
            gameplayCamera();
            drawWorld();
        } else {
            selectionCamera();
            drawSelectionStage();
        }
    }

    private void selectionCamera(){
        Matrix.setLookAtM(view,0,0,2.3f,9.2f,0,1.25f,0,0,1,0);
    }

    private void drawSelectionStage(){
        drawCube(0,-.15f,0,12,.2f,7,.08f,.09f,.13f);
        drawCube(-2.25f,2.3f,-2.6f,2.7f,4.8f,.25f,.08f,.10f,.17f);
        drawCube( 2.25f,2.3f,-2.6f,2.7f,4.8f,.25f,.08f,.10f,.17f);

        drawPreviewCharacter(-2.25f,0,0,previewSpin,0);
        drawPreviewCharacter( 2.25f,0,0,-previewSpin,1);

        if(selectedCharacter==0) drawSelectionBase(-2.25f);
        else drawSelectionBase(2.25f);
    }

    private void drawSelectionBase(float x){
        drawCube(x,.05f,.35f,2.1f,.10f,1.8f,.72f,.48f,.12f);
        drawCube(x,.12f,.35f,1.65f,.07f,1.45f,.95f,.76f,.28f);
    }

    private void drawPreviewCharacter(float x,float y,float z,float spin,int type){
        float darkR=.055f,darkG=.065f,darkB=.09f;
        float blueR=.04f,blueG=.12f,blueB=.24f;
        float skinR=.62f,skinG=.44f,skinB=.34f;

        // coat / torso
        drawCubeRot(x,1.65f,z,.88f,1.65f,.52f,darkR,darkG,darkB,spin);
        drawCubeRot(x,1.68f,z-.06f,.72f,1.3f,.18f,blueR,blueG,blueB,spin);

        // head
        drawCubeRot(x,2.75f,z,.52f,.60f,.48f,skinR,skinG,skinB,spin);

        if(type==0){
            // wide hat and male coat tail
            drawCubeRot(x,3.08f,z,1.35f,.10f,.85f,.025f,.03f,.045f,spin);
            drawCubeRot(x,3.17f,z,.62f,.30f,.58f,.025f,.03f,.045f,spin);
            drawCubeRot(x,0.68f,z+.05f,1.15f,1.35f,.12f,.04f,.045f,.06f,spin);
        } else {
            // hair / slimmer silhouette
            drawCubeRot(x,2.92f,z-.05f,.66f,.82f,.56f,.035f,.025f,.025f,spin);
            drawCubeRot(x,0.72f,z+.03f,.92f,1.30f,.11f,.035f,.04f,.055f,spin);
        }

        // arms
        drawCubeRot(x-.62f,1.62f,z,.27f,1.55f,.30f,darkR,darkG,darkB,spin);
        drawCubeRot(x+.62f,1.62f,z,.27f,1.55f,.30f,darkR,darkG,darkB,spin);

        // legs
        float legGap=type==0?.26f:.22f;
        drawCubeRot(x-legGap,.48f,z,.28f,1.1f,.34f,.045f,.05f,.065f,spin);
        drawCubeRot(x+legGap,.48f,z,.28f,1.1f,.34f,.045f,.05f,.065f,spin);

        // rifle on back
        drawCubeRot(x+.52f,1.72f,z+.18f,.16f,2.25f,.18f,.055f,.055f,.06f,spin-18f);
        drawCubeRot(x+.58f,2.55f,z+.18f,.28f,.48f,.18f,.055f,.055f,.06f,spin-18f);
    }

    private void update(float dt,long now){
        float yr=(float)Math.toRadians(yaw),sp=4.4f;
        float fx=(float)Math.sin(yr),fz=(float)Math.cos(yr),rx=(float)Math.cos(yr),rz=-(float)Math.sin(yr);
        px+=(fx*moveY+rx*moveX)*sp*dt;pz+=(fz*moveY+rz*moveX)*sp*dt;
        px=clamp(px,-24,24);pz=clamp(pz,-24,24);

        if(fire&&now>=nextShot){
            nextShot=now+120;
            if(ammo>0){ammo--;shoot();}else ammo=30;
        }

        for(Actor e:enemies){
            if(!e.alive)continue;
            float dx=px-e.x,dz=pz-e.z,d=(float)Math.sqrt(dx*dx+dz*dz);
            if(d<18&&d>4){e.x+=dx/d*1.3f*dt;e.z+=dz/d*1.3f*dt;}
            e.cool-=dt;
            if(d<12&&e.cool<=0){
                e.cool=.8f;hp-=5;
                if(hp<=0){running=false;ended=true;hp=0;}
            }
        }
        if(getAliveEnemyCount()==0 && running){ running=false; ended=true; }
    }

    private void shoot(){
        Actor best=null;float score=.14f,yr=(float)Math.toRadians(yaw),fx=(float)Math.sin(yr),fz=(float)Math.cos(yr);
        for(Actor e:enemies){
            if(!e.alive)continue;
            float dx=e.x-px,dz=e.z-pz,d=(float)Math.sqrt(dx*dx+dz*dz);
            if(d>45||d<.1f)continue;
            float s=1f-((dx/d)*fx+(dz/d)*fz);
            if(s<score){score=s;best=e;}
        }
        if(best!=null){best.hp-=34;if(best.hp<=0)best.alive=false;}
    }

    private void gameplayCamera(){
        float yr=(float)Math.toRadians(yaw),pr=(float)Math.toRadians(pitch);
        float fx=(float)(Math.sin(yr)*Math.cos(pr)),fy=(float)Math.sin(pr),fz=(float)(Math.cos(yr)*Math.cos(pr));
        Matrix.setLookAtM(view,0,px-fx*5.2f,3.0f-fy*2f,pz-fz*5.2f,px,1.3f,pz,0,1,0);
    }

    private void drawWorld(){
        drawCube(0,-.35f,0,52,.5f,52,.23f,.34f,.20f);
        drawCube(-8,1.5f,-4,4,3.5f,7,.42f,.40f,.36f);
        drawCube(7,1.2f,4,5,2.8f,5,.50f,.46f,.39f);
        drawCube(-2,1.0f,10,7,2.2f,3,.40f,.43f,.45f);
        drawCube(10,1.7f,-10,4,4,8,.34f,.37f,.40f);

        drawGameplayCharacter(px,pz,selectedCharacter);
        for(Actor e:enemies) if(e.alive) drawEnemy(e.x,e.z);
    }

    private void drawGameplayCharacter(float x,float z,int type){
        if(type==0){
            drawCube(x,1,z,.78f,1.45f,.48f,.055f,.065f,.09f);
            drawCube(x,2,z,.54f,.58f,.50f,.62f,.44f,.34f);
            drawCube(x,2.37f,z,1.0f,.10f,.68f,.025f,.03f,.045f);
        } else {
            drawCube(x,1,z,.70f,1.42f,.44f,.055f,.065f,.09f);
            drawCube(x,2,z,.50f,.56f,.48f,.66f,.46f,.36f);
            drawCube(x,2.25f,z,.62f,.42f,.52f,.035f,.025f,.025f);
        }
        drawCube(x-.23f,.16f,z,.24f,.80f,.28f,.06f,.07f,.09f);
        drawCube(x+.23f,.16f,z,.24f,.80f,.28f,.06f,.07f,.09f);
    }

    private void drawEnemy(float x,float z){
        drawCube(x,1,z,.75f,1.4f,.45f,.50f,.10f,.08f);
        drawCube(x,2,z,.55f,.55f,.55f,.58f,.30f,.25f);
    }

    private void drawCubeRot(float x,float y,float z,float sx,float sy,float sz,float r,float g,float b,float rotY){
        GLES20.glUseProgram(program);
        Matrix.setIdentityM(model,0);
        Matrix.translateM(model,0,x,y,z);
        Matrix.rotateM(model,0,rotY,0,1,0);
        Matrix.scaleM(model,0,sx,sy,sz);
        Matrix.multiplyMM(tmp,0,view,0,model,0);
        Matrix.multiplyMM(mvp,0,proj,0,tmp,0);
        GLES20.glUniformMatrix4fv(uMVP,1,false,mvp,0);
        GLES20.glUniform4f(uColor,r,g,b,1);
        GLES20.glEnableVertexAttribArray(aPos);
        cubeVB.position(0);
        GLES20.glVertexAttribPointer(aPos,3,GLES20.GL_FLOAT,false,0,cubeVB);
        GLES20.glDrawArrays(GLES20.GL_TRIANGLES,0,36);
        GLES20.glDisableVertexAttribArray(aPos);
    }

    private void drawCube(float x,float y,float z,float sx,float sy,float sz,float r,float g,float b){
        drawCubeRot(x,y,z,sx,sy,sz,r,g,b,0);
    }

    private int program(String vs,String fs){
        int v=GLES20.glCreateShader(GLES20.GL_VERTEX_SHADER);GLES20.glShaderSource(v,vs);GLES20.glCompileShader(v);
        int f=GLES20.glCreateShader(GLES20.GL_FRAGMENT_SHADER);GLES20.glShaderSource(f,fs);GLES20.glCompileShader(f);
        int p=GLES20.glCreateProgram();GLES20.glAttachShader(p,v);GLES20.glAttachShader(p,f);GLES20.glLinkProgram(p);return p;
    }

    public void selectCharacter(int i){ if(!running) selectedCharacter=(i==1?1:0); }
    public void setWardrobe(int slot){ if(!running) wardrobeSlot=Math.max(0,Math.min(8,slot)); }
    public int getWardrobe(){ return wardrobeSlot; }
    public void setTeamMode(int mode){ if(!running) teamMode=(mode==1?1:0); }
    public int getTeamMode(){ return teamMode; }

    public void startMatch(){
        enemies.clear();
        float[][] ps={{-14,-12},{14,-13},{-17,8},{15,12},{2,-15},{-12,15},{18,0},{4,16},{-4,-9},{9,-2},{-18,-1}};
        for(float[] p:ps)enemies.add(new Actor(p[0],p[1]));
        px=0;pz=9;hp=100;ammo=30;yaw=180;pitch=-10;ended=false;running=true;lastMs=SystemClock.uptimeMillis();
    }

    public boolean isRunning(){return running;}
    public boolean isEnded(){return ended;}
    public int getSelectedCharacter(){return selectedCharacter;}
    public float getHealth(){return hp;}
    public int getAmmo(){return ammo;}
    public int getAliveCount(){return (hp>0?1:0)+getAliveEnemyCount();}
    private int getAliveEnemyCount(){int n=0;for(Actor e:enemies)if(e.alive)n++;return n;}
    public void move(float x,float y){moveX=x;moveY=y;}
    public void look(float dx,float dy){yaw+=dx;pitch=clamp(pitch-dy,-42,28);}
    public void setFire(boolean v){fire=v;}
    private static float clamp(float v,float a,float b){return Math.max(a,Math.min(b,v));}
}
