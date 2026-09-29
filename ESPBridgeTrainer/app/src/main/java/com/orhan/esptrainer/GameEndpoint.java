package com.orhan.esptrainer;

public class GameEndpoint {
    public final String label;
    public final String packageName;
    public final String serviceName;
    public final boolean compatible;

    public GameEndpoint(String label, String packageName, String serviceName, boolean compatible) {
        this.label = label;
        this.packageName = packageName;
        this.serviceName = serviceName;
        this.compatible = compatible;
    }

    @Override public String toString() {
        return (compatible ? "✓ " : "• ") + label + " (" + packageName + ")";
    }
}
