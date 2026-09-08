package com.orhan.shaomi

import android.app.Notification
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import java.util.ArrayDeque

class NotificationReaderService : NotificationListenerService() {
    override fun onNotificationPosted(sbn: StatusBarNotification?) {
        val n = sbn?.notification ?: return
        val app = sbn.packageName ?: return
        val title = n.extras.getCharSequence(Notification.EXTRA_TITLE)?.toString().orEmpty()
        val text = n.extras.getCharSequence(Notification.EXTRA_TEXT)?.toString().orEmpty()
        if (text.isBlank()) return
        synchronized(messages) {
            messages.addFirst(Message(app, title, text))
            while (messages.size > 20) messages.removeLast()
        }
    }
    data class Message(val app: String, val sender: String, val text: String)
    companion object {
        private val messages = ArrayDeque<Message>()
        fun latest(filter: String? = null): Message? = synchronized(messages) {
            messages.firstOrNull { filter == null || it.app.contains(filter, true) }
        }
    }
}
