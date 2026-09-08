package com.orhan.shaomi

import android.accessibilityservice.AccessibilityService
import android.content.Intent
import android.view.accessibility.AccessibilityEvent

class ShaomiAccessibilityService : AccessibilityService() {
    override fun onServiceConnected() { active = this }
    override fun onAccessibilityEvent(event: AccessibilityEvent?) = Unit
    override fun onInterrupt() = Unit
    override fun onDestroy() { if (active === this) active = null; super.onDestroy() }
    fun goHome() = performGlobalAction(GLOBAL_ACTION_HOME)
    fun goBack() = performGlobalAction(GLOBAL_ACTION_BACK)
    fun closeCurrent() = performGlobalAction(GLOBAL_ACTION_HOME)
    fun visibleText(): String = rootInActiveWindow?.let { root ->
        val out = mutableListOf<String>()
        fun walk(node: android.view.accessibility.AccessibilityNodeInfo?) {
            if (node == null) return
            node.text?.toString()?.takeIf { it.isNotBlank() }?.let(out::add)
            for (i in 0 until node.childCount) walk(node.getChild(i))
        }
        walk(root); out.distinct().takeLast(12).joinToString(". ")
    }.orEmpty()
    fun launch(intent: Intent): Boolean = runCatching {
        startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); true
    }.getOrDefault(false)
    companion object { @Volatile var active: ShaomiAccessibilityService? = null }
}
