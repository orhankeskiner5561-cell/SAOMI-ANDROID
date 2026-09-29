package com.orhan.battleroyale;
import android.app.*;import android.os.*;import android.view.*;import android.widget.*;
public class MainActivity extends Activity{
 GameView gameView;
 @Override protected void onCreate(Bundle b){super.onCreate(b);requestWindowFeature(Window.FEATURE_NO_TITLE);getWindow().setFlags(1024,1024);
 getWindow().getDecorView().setSystemUiVisibility(5894|View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY);
 FrameLayout root=new FrameLayout(this);gameView=new GameView(this);LobbyOverlay lobby=new LobbyOverlay(this,gameView);
 root.addView(gameView,new FrameLayout.LayoutParams(-1,-1));root.addView(lobby,new FrameLayout.LayoutParams(-1,-1));setContentView(root);}
 @Override protected void onPause(){super.onPause();gameView.onPause();}@Override protected void onResume(){super.onResume();gameView.onResume();}
}