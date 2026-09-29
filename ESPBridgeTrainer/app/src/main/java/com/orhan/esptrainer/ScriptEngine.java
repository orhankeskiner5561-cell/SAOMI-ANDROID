package com.orhan.esptrainer;

public class ScriptEngine {
    public interface Target {
        void setRadar(boolean enabled);
        void setDistanceLabels(boolean enabled);
        void setEnemyColor(String color);
        void setMaxDistance(float meters);
    }
    public static String run(String script, Target target) {
        StringBuilder out = new StringBuilder();
        String[] lines = script.split("\\r?\\n");
        for (int i = 0; i < lines.length; i++) {
            String line = lines[i].trim();
            if (line.isEmpty() || line.startsWith("#")) continue;
            String[] p = line.split("\\s+");
            try {
                switch (p[0].toLowerCase()) {
                    case "radar": target.setRadar(requireOnOff(p)); break;
                    case "distance": target.setDistanceLabels(requireOnOff(p)); break;
                    case "enemy_color": if (p.length != 2) throw new IllegalArgumentException("renk gerekli"); target.setEnemyColor(p[1]); break;
                    case "max_distance": if (p.length != 2) throw new IllegalArgumentException("metre gerekli"); target.setMaxDistance(Float.parseFloat(p[1])); break;
                    default: throw new IllegalArgumentException("bilinmeyen komut");
                }
                out.append("✓ ").append(line).append('\n');
            } catch (Exception e) {
                out.append("✗ Satır ").append(i+1).append(": ").append(line).append(" — ").append(e.getMessage()).append('\n');
            }
        }
        return out.toString();
    }
    private static boolean requireOnOff(String[] p) {
        if (p.length != 2) throw new IllegalArgumentException("on/off gerekli");
        if ("on".equalsIgnoreCase(p[1])) return true;
        if ("off".equalsIgnoreCase(p[1])) return false;
        throw new IllegalArgumentException("on/off olmalı");
    }
}
