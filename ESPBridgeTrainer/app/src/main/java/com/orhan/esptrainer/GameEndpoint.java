package com.orhan.esptrainer;

public class GameEndpoint {
    public final String label;
    public final String packageName;
    public final String serviceName;
    public GameEndpoint(String label, String packageName, String serviceName) {
        this.label = label;
        this.packageName = packageName;
        this.serviceName = serviceName;
    }
    @Override public String toString() { return label + " (" + packageName + ")"; }
}
