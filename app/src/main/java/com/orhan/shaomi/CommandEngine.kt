package com.orhan.shaomi

import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CameraManager
import android.media.AudioManager
import android.net.Uri
import android.provider.AlarmClock
import android.provider.ContactsContract
import androidx.core.content.ContextCompat
import java.util.Locale

class CommandEngine(private val context: Context) {
    data class PendingContact(val label: String, val number: String, val score: Double)
    private var pendingContacts: List<PendingContact> = emptyList()
    private var pendingAt: Long = 0L
    private var pendingConfirmation: PendingContact? = null
    data class Result(val message: String, val success: Boolean)

    fun execute(raw: String): Result {
        val text = normalizeHeard(raw.lowercase(Locale("tr", "TR")).replace('’', '\'').trim())
        if (isFinancial(text)) return Result("Banka ve para işlemlerini güvenlik nedeniyle yapmıyorum Orhan Bey.", false)
        resolveConfirmation(text)?.let { return it }
        resolvePendingContact(text)?.let { return it }
        return when {
            "oku" in text && listOf("mesaj", "bildirim", "sms", "whatsapp", "vatsap").any { it in text } -> readMessage(text)
            listOf("ekranı oku", "burayı oku", "sayfayı oku").any { it in text } -> readScreen()
            isTorchCommand(text) -> torch(!listOf("kapat", "söndür", "sondur").any { it in key(text) })
            isVolume(text) -> volume(text)
            text.startsWith("ara ") -> call(text.removePrefix("ara "))
            text.endsWith(" ara") -> call(text.removeSuffix(" ara"))
            listOf("ana ekrana dön", "ana ekrana don", "uygulamadan çık", "uygulamayı kapat").any { it in text } -> home()
            listOf("geri dön", "geri don", "geri git").any { it in text } -> back()
            isContactsCommand(text) -> openContacts()
            "alarm" in text -> alarm(text)
            isOpenAppCommand(text) -> openApp(text.removeSuffix(" aç").trim())
            else -> Result("Bu komutu henüz tanımıyorum Orhan Bey.", false)
        }
    }

    private fun normalizeHeard(input: String): String {
        var t = input.replace(Regex("\\s+"), " ").trim()
        // Vosk'un Türkçede sık yaptığı eylem-sonu karışıklıkları.
        // Yalnız komut bağlamında dönüştürülür; serbest metni gereksiz değiştirmez.
        if (t.endsWith(" ağaç") || t.endsWith(" agac")) {
            t = t.replace(Regex("\\s+(ağaç|agac)$"), " aç")
        }
        if (t.endsWith(" araç") || t.endsWith(" arac")) {
            val before = t.substringBeforeLast(' ').trim()
            if (before.isNotBlank()) t = "$before ara"
        }
        t = t.replace("vatsaba", "whatsapp'a")
            .replace("vatsap'a", "whatsapp'a")
            .replace("vatsapı", "whatsapp'ı")
        return t
    }

    private fun torch(on: Boolean): Result = runCatching {
        val manager = context.getSystemService(CameraManager::class.java)
        val id = manager.cameraIdList.first { manager.getCameraCharacteristics(it)
            .get(CameraCharacteristics.FLASH_INFO_AVAILABLE) == true }
        manager.setTorchMode(id, on)
        Result(if (on) "Feneri açtım Orhan Bey." else "Feneri kapattım Orhan Bey.", true)
    }.getOrElse { Result("Fener kullanılamadı Orhan Bey.", false) }

    private fun isTorchCommand(t: String): Boolean {
        val k = key(t)
        return listOf("fener", "feneri", "isik", "isigi", "el feneri").any { key(it) in k }
    }

    private fun isContactsCommand(t: String): Boolean {
        val k = key(t)
        return ("ac" in k) && listOf("rehber", "kisiler", "telefonrehberi").any { it in k }
    }

    private fun openContacts(): Result {
        val ok = launch(Intent(Intent.ACTION_VIEW, ContactsContract.Contacts.CONTENT_URI))
        return Result(if (ok) "Rehberi açtım Orhan Bey." else "Rehber açılamadı Orhan Bey.", ok)
    }

    private fun isVolume(t: String): Boolean {
        val x = t.trim()
        val exact = listOf(
            "sesi aç", "sesi yükselt", "sesi artır", "sesi arttır", "sesi kıs", "sesi azalt",
            "sesi kapat", "sesi sessize al", "medya sesini aç", "medya sesini yükselt",
            "medya sesini kıs", "medya sesini azalt", "medya sesini kapat"
        )
        if (exact.any { x == it }) return true
        return Regex("^(medya )?sesi? (yüzde )?\\d{1,3}%?$").matches(x)
    }
    private fun volume(t: String): Result {
        val audio = context.getSystemService(AudioManager::class.java); val max = audio.getStreamMaxVolume(AudioManager.STREAM_MUSIC)
        val current = audio.getStreamVolume(AudioManager.STREAM_MUSIC)
        val number = Regex("(?:yüzde|%)\\s*(\\d{1,3})|(\\d{1,3})\\s*%").find(t)?.groupValues?.drop(1)?.firstOrNull { it.isNotBlank() }?.toIntOrNull()
        val target = when {
            number != null -> max * number.coerceIn(0, 100) / 100
            "sessiz" in t || "kapat" in t -> 0
            "kıs" in t || "azalt" in t -> (current - max / 5).coerceAtLeast(0)
            else -> (current + max / 5).coerceAtMost(max)
        }
        audio.setStreamVolume(AudioManager.STREAM_MUSIC, target, AudioManager.FLAG_SHOW_UI)
        return Result("Medya sesini ayarladım Orhan Bey.", true)
    }


    private fun isOpenAppCommand(t: String): Boolean {
        if (!t.endsWith(" aç")) return false
        val appPart = t.removeSuffix(" aç").trim()
        // Yanlış tanımadan gelen uzun cümleleri uygulama komutu sanma.
        if (appPart.isBlank() || appPart.split(Regex("\\s+")).size > 3) return false
        val forbidden = listOf("ses", "yükselt", "azalt", "fener", "ışık", "ara", "oku", "alarm")
        if (forbidden.any { it in appPart }) return false
        return true
    }

    private fun openApp(spoken: String): Result {
        val wanted = key(spoken.replace(Regex("['’]?(yi|yı|yu|yü|i|ı|u|ü)$"), ""))
        val blocked = listOf("banka", "bank", "ziraat", "garanti", "akbank").any { it in wanted }
        if (blocked) return Result("Banka uygulamalarını açmıyorum Orhan Bey.", false)
        val pm = context.packageManager
        val aliases = mapOf(
            "chatgpt" to "com.openai.chatgpt", "chatcipiti" to "com.openai.chatgpt",
            "cetcipiti" to "com.openai.chatgpt", "chatgipiti" to "com.openai.chatgpt",
            "tradingview" to "com.tradingview.tradingviewapp", "tradingviyu" to "com.tradingview.tradingviewapp",
            "treydingviyu" to "com.tradingview.tradingviewapp", "whatsapp" to "com.whatsapp",
            "vatsap" to "com.whatsapp", "youtube" to "com.google.android.youtube"
        )
        val directAlias = aliases.entries.firstOrNull { wanted == it.key || similarity(wanted, it.key) >= 0.86 }?.value
        @Suppress("DEPRECATION")
        val apps = pm.getInstalledApplications(0)
        val labelMatch = apps.map { it to key(pm.getApplicationLabel(it).toString()) }
            .filter { (_, label) -> label.contains(wanted) || wanted.contains(label) || similarity(wanted, label) >= 0.78 }
            .maxByOrNull { (_, label) -> similarity(wanted, label) }?.first?.packageName
        val packageName = directAlias?.takeIf { pm.getLaunchIntentForPackage(it) != null } ?: labelMatch
            ?: return Result("$spoken uygulamasını bulamadım Orhan Bey.", false)
        val intent = pm.getLaunchIntentForPackage(packageName) ?: return Result("Uygulama doğrudan açılamıyor Orhan Bey.", false)
        val started = ShaomiAccessibilityService.active?.launch(intent) ?: runCatching { context.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); true }.getOrDefault(false)
        return Result(if (started) "$spoken uygulamasını açtım Orhan Bey." else "Uygulama açılamadı Orhan Bey.", started)
    }

    private fun call(name: String): Result {
        if (ContextCompat.checkSelfPermission(context, android.Manifest.permission.READ_CONTACTS) != PackageManager.PERMISSION_GRANTED) return Result("Kişiler izni gerekiyor Orhan Bey.", false)
        val cleanedName = name.trim().replace(Regex("['’]?(yi|yı|yu|yü|i|ı|u|ü)$"), "").trim()
        val wantedTokens = contactTokens(cleanedName)
        if (wantedTokens.isEmpty()) return Result("Kişinin adını anlayamadım Orhan Bey.", false)

        val matches = mutableListOf<PendingContact>()
        context.contentResolver.query(
            ContactsContract.CommonDataKinds.Phone.CONTENT_URI,
            arrayOf(ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME, ContactsContract.CommonDataKinds.Phone.NUMBER),
            null, null, null
        )?.use { c ->
            while (c.moveToNext()) {
                val label = c.getString(0) ?: continue
                val number = c.getString(1) ?: continue
                val score = contactMatchScore(wantedTokens, contactTokens(label), cleanedName, label)
                if (score >= 0.48) matches += PendingContact(label, number, score)
            }
        }

        val sorted = matches.distinctBy { it.number }.sortedByDescending { it.score }
        val best = sorted.firstOrNull() ?: return Result("$name adına yakın kişi bulamadım Orhan Bey.", false)
        val second = sorted.getOrNull(1)

        // Tam isim/ayırt edici kelimeler yeterince uyuşuyorsa tek kişiyi seç.
        // "abi/abim" gibi genel hitaplar tek başına eşleşme sebebi değildir.
        val confident = best.score >= 0.72 && (second == null || best.score - second.score >= 0.10 || best.score >= 0.90)
        if (confident) {
            pendingContacts = emptyList()
            pendingConfirmation = best
            pendingAt = System.currentTimeMillis()
            return Result("${best.label} kişisini buldum. Arayayım mı Orhan Bey?", true)
        }

        pendingContacts = sorted.take(5)
        pendingAt = System.currentTimeMillis()
        val choices = pendingContacts.take(3).joinToString(", ") { it.label }
        return Result("Birden fazla yakın kayıt buldum: $choices. Kişinin adını biraz daha ayrıntılı söyleyin Orhan Bey.", false)
    }

    private fun resolveConfirmation(text: String): Result? {
        val c = pendingConfirmation ?: return null
        if (System.currentTimeMillis() - pendingAt > 60_000) { pendingConfirmation = null; return null }
        val k = key(text)
        val yes = listOf("evet", "ara", "arayabilirsin", "arayin", "tamam", "olur", "ara onu").any { key(it) == k }
        val no = listOf("hayir", "iptal", "arama", "vazgec", "istemiyorum").any { key(it) == k }
        if (yes) { pendingConfirmation = null; return dialContact(c) }
        if (no) { pendingConfirmation = null; return Result("Aramayı iptal ettim Orhan Bey.", true) }
        // Yeni bir kişi arama komutu gelirse eski onayı düşür ve yeni aramayı işle.
        if (text.startsWith("ara ") || text.endsWith(" ara")) { pendingConfirmation = null; return null }
        return Result("${c.label} kişisini aramamı istiyorsanız evet deyin Orhan Bey.", false)
    }

    private fun contactTokens(text: String): List<String> = text
        .lowercase(Locale("tr", "TR"))
        .replace(Regex("[^a-zA-ZçğıöşüÇĞİÖŞÜ0-9]+"), " ")
        .trim()
        .split(Regex("\\s+"))
        .map { key(it) }
        .filter { it.isNotBlank() && it !in setOf("ara", "kisiyi", "kisini", "telefon", "numara") }

    private fun contactMatchScore(wanted: List<String>, candidate: List<String>, wantedRaw: String, candidateRaw: String): Double {
        if (wanted.isEmpty() || candidate.isEmpty()) return 0.0
        val generic = setOf("abi", "abim", "abla", "ablam", "amca", "dayi", "teyze")
        val weak = setOf("sofor", "usta", "hocam", "kardes")
        fun weight(t: String) = when (t) { in generic -> 0.15; in weak -> 0.55; else -> 1.0 }

        var total = 0.0
        var hit = 0.0
        for (w in wanted) {
            val wt = weight(w)
            total += wt
            val best = candidate.maxOfOrNull { c ->
                when {
                    w == c -> 1.0
                    w.length >= 4 && c.length >= 4 -> similarity(w, c)
                    else -> 0.0
                }
            } ?: 0.0
            if (best >= 0.72) hit += wt * best
        }
        val recall = if (total > 0) hit / total else 0.0

        val discriminative = wanted.filter { it !in generic }
        val exactDisc = discriminative.count { w -> candidate.any { it == w } }
        val discRatio = if (discriminative.isNotEmpty()) exactDisc.toDouble() / discriminative.size else 0.0

        val full = similarity(key(wantedRaw), key(candidateRaw))
        val candidateExtraPenalty = ((candidate.size - wanted.size).coerceAtLeast(0) * 0.025).coerceAtMost(0.12)
        return (0.58 * recall + 0.30 * discRatio + 0.12 * full - candidateExtraPenalty).coerceIn(0.0, 1.0)
    }

    private fun resolvePendingContact(text: String): Result? {
        if (pendingContacts.isEmpty()) return null
        if (System.currentTimeMillis() - pendingAt > 60_000) { pendingContacts = emptyList(); return null }

        val spoken = text.removeSuffix(" ara").removePrefix("ara ").trim()
        val wantedTokens = contactTokens(spoken)
        if (wantedTokens.isEmpty()) return null

        val ranked = pendingContacts.map { c ->
            c to contactMatchScore(wantedTokens, contactTokens(c.label), spoken, c.label)
        }.sortedByDescending { it.second }
        val best = ranked.firstOrNull() ?: return null
        val second = ranked.getOrNull(1)?.second ?: 0.0

        if (best.second >= 0.72 && (best.second - second >= 0.10 || best.second >= 0.90)) {
            pendingContacts = emptyList()
            pendingConfirmation = best.first
            pendingAt = System.currentTimeMillis()
            return Result("${best.first.label} kişisini buldum. Arayayım mı Orhan Bey?", true)
        }

        return Result("Kişiyi net seçemedim Orhan Bey. Adını rehberde kayıtlı olduğu şekilde biraz daha ayrıntılı söyleyin.", false)
    }

    private fun tokenScore(a: String, b: String): Double {
        if (a.isBlank() || b.isBlank()) return 0.0
        if (b.contains(a) || a.contains(b)) return 0.95
        return similarity(a,b)
    }

    private fun dialContact(contact: PendingContact): Result {
        val direct=ContextCompat.checkSelfPermission(context, android.Manifest.permission.CALL_PHONE)==PackageManager.PERMISSION_GRANTED
        val ok=launch(Intent(if(direct) Intent.ACTION_CALL else Intent.ACTION_DIAL, Uri.parse("tel:${contact.number}")))
        return Result(if(ok) "${contact.label} kişisini arıyorum Orhan Bey." else "Arama başlatılamadı Orhan Bey.", ok)
    }

    private fun alarm(t: String): Result {
        val m=Regex("(\\d{1,2})(?:[.:](\\d{1,2}))?").find(t) ?: return Result("Alarm saatini anlayamadım Orhan Bey.", false)
        val h=m.groupValues[1].toIntOrNull() ?: return Result("Alarm saatini anlayamadım Orhan Bey.", false); val min=m.groupValues[2].toIntOrNull() ?: 0
        val ok=launch(Intent(AlarmClock.ACTION_SET_ALARM).putExtra(AlarmClock.EXTRA_HOUR,h).putExtra(AlarmClock.EXTRA_MINUTES,min).putExtra(AlarmClock.EXTRA_SKIP_UI,true))
        return Result(if(ok) "Alarmı kurdum Orhan Bey." else "Alarm kurulamadı Orhan Bey.",ok)
    }
    private fun home(): Result { val ok=ShaomiAccessibilityService.active?.goHome()==true; return Result(if(ok) "Ana ekrana döndüm Orhan Bey." else "Telefon kontrol izni gerekiyor Orhan Bey.",ok) }
    private fun back(): Result { val ok=ShaomiAccessibilityService.active?.goBack()==true; return Result(if(ok) "Geri döndüm Orhan Bey." else "Telefon kontrol izni gerekiyor Orhan Bey.",ok) }
    private fun readScreen(): Result {
        val value = ShaomiAccessibilityService.active?.visibleText().orEmpty()
        return if (value.isBlank()) Result("Ekranda okunabilir metin bulamadım Orhan Bey.", false) else Result(value, true)
    }
    private fun readMessage(t: String): Result {
        val filter = when { "whatsapp" in key(t) || "vatsap" in key(t) -> "whatsapp"; "sms" in t -> "messaging"; else -> null }
        val m = NotificationReaderService.latest(filter) ?: return Result("Okunabilecek yeni mesaj bulamadım Orhan Bey. Mesaj okuma iznini kontrol edin.", false)
        val sender = m.sender.ifBlank { "Gönderen belirtilmemiş" }
        return Result("$sender diyor ki: ${m.text}", true)
    }
    private fun launch(i:Intent)=ShaomiAccessibilityService.active?.launch(i) ?: runCatching { context.startActivity(i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); true }.getOrDefault(false)
    private fun isFinancial(t:String)=listOf("banka","havale","eft","para gönder","şifre","pin","doğrulama kodu").any{it in t}
    private fun key(s:String)=s.lowercase(Locale("tr","TR")).replace("ç","c").replace("ğ","g").replace("ı","i").replace("ö","o").replace("ş","s").replace("ü","u").replace(Regex("[^a-z0-9]"),"")
    private fun similarity(a: String, b: String): Double {
        if (a.isEmpty() || b.isEmpty()) return 0.0
        val previous = IntArray(b.length + 1) { it }
        for (i in a.indices) {
            var diagonal = previous[0]
            previous[0] = i + 1
            for (j in b.indices) {
                val old = previous[j + 1]
                previous[j + 1] = minOf(previous[j + 1] + 1, previous[j] + 1, diagonal + if (a[i] == b[j]) 0 else 1)
                diagonal = old
            }
        }
        return 1.0 - previous[b.length].toDouble() / maxOf(a.length, b.length)
    }
}
