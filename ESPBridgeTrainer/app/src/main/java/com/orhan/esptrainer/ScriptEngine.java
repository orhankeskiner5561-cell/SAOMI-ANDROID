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
            String raw = lines[i].trim();
            if (raw.isEmpty() || raw.startsWith("#") || raw.startsWith("//")) continue;

            try {
                if (raw.startsWith("radar(")) {
                    target.setRadar(parseBoolCall(raw, "radar"));
                } else if (raw.startsWith("distance(")) {
                    target.setDistanceLabels(parseBoolCall(raw, "distance"));
                } else if (raw.startsWith("enemy_color(")) {
                    target.setEnemyColor(parseStringCall(raw, "enemy_color"));
                } else if (raw.startsWith("max_distance(")) {
                    target.setMaxDistance(parseFloatCall(raw, "max_distance"));
                } else {
                    // Eski komut biçimini de koru.
                    String[] p = raw.split("\\s+");
                    switch (p[0].toLowerCase()) {
                        case "radar":
                            target.setRadar(requireOnOff(p));
                            break;
                        case "distance":
                            target.setDistanceLabels(requireOnOff(p));
                            break;
                        case "enemy_color":
                            if (p.length != 2) throw new IllegalArgumentException("renk gerekli");
                            target.setEnemyColor(p[1]);
                            break;
                        case "max_distance":
                            if (p.length != 2) throw new IllegalArgumentException("metre gerekli");
                            target.setMaxDistance(Float.parseFloat(p[1]));
                            break;
                        default:
                            throw new IllegalArgumentException("bilinmeyen komut");
                    }
                }

                out.append("✓ ").append(raw).append('\n');
            } catch (Exception e) {
                out.append("✗ Satır ").append(i + 1).append(": ")
                        .append(raw).append(" — ").append(e.getMessage()).append('\n');
            }
        }
        return out.toString();
    }

    private static boolean parseBoolCall(String raw, String name) {
        String inside = callArg(raw, name).trim();
        if ("true".equalsIgnoreCase(inside)) return true;
        if ("false".equalsIgnoreCase(inside)) return false;
        throw new IllegalArgumentException("true/false gerekli");
    }

    private static float parseFloatCall(String raw, String name) {
        return Float.parseFloat(callArg(raw, name).trim());
    }

    private static String parseStringCall(String raw, String name) {
        String s = callArg(raw, name).trim();
        if ((s.startsWith("\"") && s.endsWith("\"")) ||
            (s.startsWith("'") && s.endsWith("'"))) {
            return s.substring(1, s.length() - 1);
        }
        return s;
    }

    private static String callArg(String raw, String name) {
        String prefix = name + "(";
        if (!raw.startsWith(prefix) || !raw.endsWith(")"))
            throw new IllegalArgumentException("parantez hatası");
        return raw.substring(prefix.length(), raw.length() - 1);
    }

    private static boolean requireOnOff(String[] p) {
        if (p.length != 2) throw new IllegalArgumentException("on/off gerekli");
        if ("on".equalsIgnoreCase(p[1])) return true;
        if ("off".equalsIgnoreCase(p[1])) return false;
        throw new IllegalArgumentException("on/off olmalı");
    }
}
