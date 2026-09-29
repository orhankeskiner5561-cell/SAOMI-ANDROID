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
    private int ammo=30;
    private boolean running=false,fire=false;
    private long lastMs=0,nextShot=0;

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
        GLES20.glClearColor(.55f,.72f,.84f,1);
        GLES20.glEnable(GLES20.GL_DEPTH_TEST);
        cubeVB=buf(CUBE);
        program=program("attribute vec3 aPos;uniform mat4 uMVP;void main(){gl_Position=uMVP*vec4(aPos,1.0);}",
                "precision mediump float;uniform vec4 uColor;void main(){gl_FragColor=uColor;}");
        aPos=GLES20.glGetAttribLocation(program,"aPos");
        uMVP=GLES20.glGetUniformLocation(program,"uMVP");
        uColor=GLES20.glGetUniformLocation(program,"uColor");
    }

    @Override public void onSurfaceChanged(GL10 gl,int w,int h){
        GLES20.glViewport(0,0,w,h);
        Matrix.perspectiveM(proj,0,62f,(float)w/h,.1f,120f);
    }

    @Override public void onDrawFrame(GL10 gl){
        long now=SystemClock.uptimeMillis();
        float dt=lastMs==0?.016f:Math.min(.033f,(now-lastMs)/1000f); lastMs=now;
        if(running)update(dt,now);
        GLES20.glClear(GLES20.GL_COLOR_BUFFER_BIT|GLES20.GL_DEPTH_BUFFER_BIT);
        camera();
        drawCube(0,-.35f,0,52,.5f,52,.23f,.34f,.20f);
        drawCube(-8,1.5f,-4,4,3.5f,7,.42f,.40f,.36f);
        drawCube(7,1.2f,4,5,2.8f,5,.50f,.46f,.39f);
        drawCube(-2,1.0f,10,7,2.2f,3,.40f,.43f,.45f);
        drawCube(10,1.7f,-10,4,4,8,.34f,.37f,.40f);
        human(px,pz,.15f,.22f,.32f);
        for(Actor e:enemies)if(e.alive)human(e.x,e.z,.48f,.10f,.08f);
    }

    private void update(float dt,long now){
        float yr=(float)Math.toRadians(yaw),sp=4.4f;
        float fx=(float)Math.sin(yr),fz=(float)Math.cos(yr),rx=(float)Math.cos(yr),rz=-(float)Math.sin(yr);
        px+=(fx*moveY+rx*moveX)*sp*dt;pz+=(fz*moveY+rz*moveX)*sp*dt;
        px=clamp(px,-24,24);pz=clamp(pz,-24,24);
        if(fire&&now>=nextShot){nextShot=now+120;if(ammo>0){ammo--;shoot();}else ammo=30;}
        for(Actor e:enemies){
            if(!e.alive)continue;
            float dx=px-e.x,dz=pz-e.z,d=(float)Math.sqrt(dx*dx+dz*dz);
            if(d<18&&d>4){e.x+=dx/d*1.3f*dt;e.z+=dz/d*1.3f*dt;}
            e.cool-=dt;if(d<12&&e.cool<=0){e.cool=.8f;hp-=5;if(hp<=0){running=false;hp=0;}}
        }
    }

    private void shoot(){
        Actor best=null;float score=.14f,yr=(float)Math.toRadians(yaw),fx=(float)Math.sin(yr),fz=(float)Math.cos(yr);
        for(Actor e:enemies){if(!e.alive)continue;float dx=e.x-px,dz=e.z-pz,d=(float)Math.sqrt(dx*dx+dz*dz);
            if(d>45||d<.1f)continue;float s=1f-((dx/d)*fx+(dz/d)*fz);if(s<score){score=s;best=e;}}
        if(best!=null){best.hp-=34;if(best.hp<=0)best.alive=false;}
    }

    private void camera(){
        float yr=(float)Math.toRadians(yaw),pr=(float)Math.toRadians(pitch);
        float fx=(float)(Math.sin(yr)*Math.cos(pr)),fy=(float)Math.sin(pr),fz=(float)(Math.cos(yr)*Math.cos(pr));
        Matrix.setLookAtM(view,0,px-fx*5.2f,3.0f-fy*2f,pz-fz*5.2f,px,1.3f,pz,0,1,0);
    }

    private void human(float x,float z,float r,float g,float b){
        drawCube(x,1,z,.75f,1.4f,.45f,r,g,b);drawCube(x,2,z,.55f,.55f,.55f,r*.95f,g*.95f,b*.95f);
        drawCube(x-.22f,.15f,z,.24f,.8f,.28f,.08f,.09f,.11f);drawCube(x+.22f,.15f,z,.24f,.8f,.28f,.08f,.09f,.11f);
    }

    private void drawCube(float x,float y,float z,float sx,float sy,float sz,float r,float g,float b){
        GLES20.glUseProgram(program);Matrix.setIdentityM(model,0);Matrix.translateM(model,0,x,y,z);Matrix.scaleM(model,0,sx,sy,sz);
        Matrix.multiplyMM(tmp,0,view,0,model,0);Matrix.multiplyMM(mvp,0,proj,0,tmp,0);
        GLES20.glUniformMatrix4fv(uMVP,1,false,mvp,0);GLES20.glUniform4f(uColor,r,g,b,1);
        GLES20.glEnableVertexAttribArray(aPos);cubeVB.position(0);GLES20.glVertexAttribPointer(aPos,3,GLES20.GL_FLOAT,false,0,cubeVB);
        GLES20.glDrawArrays(GLES20.GL_TRIANGLES,0,36);GLES20.glDisableVertexAttribArray(aPos);
    }

    private int program(String vs,String fs){
        int v=GLES20.glCreateShader(GLES20.GL_VERTEX_SHADER);GLES20.glShaderSource(v,vs);GLES20.glCompileShader(v);
        int f=GLES20.glCreateShader(GLES20.GL_FRAGMENT_SHADER);GLES20.glShaderSource(f,fs);GLES20.glCompileShader(f);
        int p=GLES20.glCreateProgram();GLES20.glAttachShader(p,v);GLES20.glAttachShader(p,f);GLES20.glLinkProgram(p);return p;
    }

    public void startMatch(){enemies.clear();float[][] ps={{-14,-12},{14,-13},{-17,8},{15,12},{2,-15},{-12,15},{18,0},{4,16},{-4,-9},{9,-2},{-18,-1}};
        for(float[] p:ps)enemies.add(new Actor(p[0],p[1]));px=0;pz=9;hp=100;ammo=30;yaw=180;pitch=-10;running=true;lastMs=SystemClock.uptimeMillis();}
    public boolean isRunning(){return running;}
    public void move(float x,float y){moveX=x;moveY=y;}
    public void look(float dx,float dy){yaw+=dx;pitch=clamp(pitch-dy,-42,28);}
    public void setFire(boolean v){fire=v;}
    private static float clamp(float v,float a,float b){return Math.max(a,Math.min(b,v));}
}
