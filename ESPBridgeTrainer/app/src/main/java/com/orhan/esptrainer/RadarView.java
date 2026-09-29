package com.orhan.esptrainer;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.util.AttributeSet;
import android.view.View;
import java.util.ArrayList;
import java.util.List;

public class RadarView extends View {
    private final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private List<EnemyPoint> points = new ArrayList<>();
    private float maxDistance = 250f;
    private boolean enabled = true;
    public RadarView(Context c, AttributeSet a) { super(c, a); }
    public void setPoints(List<EnemyPoint> p) { points = p; invalidate(); }
    public void setMaxDistance(float d) { maxDistance = Math.max(10f, d); invalidate(); }
    public void setRadarEnabled(boolean e) { enabled = e; invalidate(); }
    @Override protected void onDraw(Canvas canvas) {
        super.onDraw(canvas);
        float cx = getWidth()/2f, cy = getHeight()/2f;
        float r = Math.min(cx, cy) - 16f;
        paint.setStyle(Paint.Style.STROKE);
        paint.setStrokeWidth(3f);
        paint.setColor(0xFF444444);
        canvas.drawCircle(cx, cy, r, paint);
        canvas.drawCircle(cx, cy, r*0.5f, paint);
        canvas.drawLine(cx-r, cy, cx+r, cy, paint);
        canvas.drawLine(cx, cy-r, cx, cy+r, paint);
        paint.setStyle(Paint.Style.FILL);
        paint.setColor(0xFF1E88E5);
        canvas.drawCircle(cx, cy, 8f, paint);
        if (!enabled) return;
        paint.setColor(0xFF00C853);
        for (EnemyPoint p : points) {
            float scale = r / maxDistance;
            float px = cx + p.x * scale;
            float py = cy - p.z * scale;
            if (Math.hypot(px-cx, py-cy) <= r) canvas.drawCircle(px, py, 9f, paint);
        }
    }
}
