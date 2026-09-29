package com.administrator.notezzz

import android.content.Context
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.Worker
import androidx.work.WorkerParameters
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.util.concurrent.TimeUnit

/**
 * Keeps the widgets (and reminder alarms) current while NotezZz is closed:
 * about every 30 minutes, with a network, it asks Drive which note files
 * changed, downloads only those, and rebuilds widget.json the way the page
 * would (src/lib/widget.ts): list order from settings.json, archived and
 * deleted notes left out, colours from the table the page wrote.
 *
 * It never writes to Drive and never runs while the app is on screen (the
 * page is the fresher source then). Anything that goes wrong just waits for
 * the next run.
 */
class NotesRefreshWorker(context: Context, params: WorkerParameters) : Worker(context, params) {

  override fun doWork(): Result {
    runCatching { refresh(applicationContext) }
    return Result.success()
  }

  private fun refresh(context: Context) {
    if (MainActivity.inForeground) return
    val snap = WidgetData.readSnapshot(context) ?: return
    val folder = snap.notesFolderId ?: return
    val token = GoogleSignIn.silentToken(context) ?: return

    // fileId -> { mt: modifiedTime, note: summary }
    val cacheFile = File(WidgetData.dir(context), "widget-drive-cache.json")
    val cache = runCatching { JSONObject(cacheFile.readText()) }.getOrDefault(JSONObject())
    val fresh = JSONObject()
    var changed = false

    for (f in listFiles(token, folder)) {
      val id = f.getString("id")
      val mt = f.optString("modifiedTime")
      val hit = cache.optJSONObject(id)
      if (hit != null && hit.optString("mt") == mt) {
        fresh.put(id, hit)
        continue
      }
      val note = runCatching { JSONObject(download(token, id)) }.getOrNull() ?: continue
      fresh.put(id, JSONObject().put("mt", mt).put("note", summary(note)))
      changed = true
    }
    if (fresh.length() != cache.length()) changed = true // a file went away
    if (!changed && cacheFile.exists()) return
    cacheFile.writeText(fresh.toString())

    val order = snap.settingsId?.let { sid ->
      runCatching { JSONObject(download(token, sid)).optJSONArray("noteOrder") }.getOrNull()
    }
    val notes = ordered(fresh, order)
      .filter { !it.optBoolean("deleted") && !it.optBoolean("archived") }
      .map { widgetJson(it, snap.palettes) }

    WidgetData.write(context, snap, notes)
    MainActivity.refreshWidgets(context)
    Reminders.schedule(context, WidgetData.read(context))
  }

  /** The note fields widgets need; the full HTML (with its images) isn't kept. */
  private fun summary(n: JSONObject) = JSONObject()
    .put("id", n.optString("id"))
    .put("title", n.optString("title"))
    .put("text", NoteText.fromHtml(n.optString("contentHtml")).take(600))
    .put("paletteId", n.optString("paletteId", "paper"))
    .put("pinned", n.optBoolean("pinned"))
    .put("archived", n.optBoolean("archived"))
    .put("deleted", n.optBoolean("deleted"))
    .put("updatedAt", n.optLong("updatedAt"))
    .put("remindAt", n.optLong("remindAt", 0))

  /** Same rule as the page: notes missing from the saved order lead, newest first. */
  private fun ordered(cache: JSONObject, order: JSONArray?): List<JSONObject> {
    val byId = LinkedHashMap<String, JSONObject>()
    cache.keys().forEach { k ->
      val n = cache.getJSONObject(k).getJSONObject("note")
      val prev = byId[n.optString("id")]
      if (prev == null || n.optLong("updatedAt") > prev.optLong("updatedAt")) byId[n.optString("id")] = n
    }
    val listed = mutableListOf<String>()
    if (order != null) for (i in 0 until order.length()) listed += order.optString(i)
    val inOrder = listed.mapNotNull { byId[it] }
    val listedSet = listed.toSet()
    val lead = byId.values.filter { it.optString("id") !in listedSet }.sortedByDescending { it.optLong("updatedAt") }
    return lead + inOrder
  }

  private fun widgetJson(n: JSONObject, palettes: JSONObject): JSONObject {
    val (bg, fg) = colours(n.optString("paletteId"), palettes)
    return JSONObject()
      .put("id", n.optString("id"))
      .put("title", n.optString("title"))
      .put("text", n.optString("text"))
      .put("bg", bg)
      .put("fg", fg)
      .put("pinned", n.optBoolean("pinned"))
      .apply { if (n.optLong("remindAt") > 0) put("remindAt", n.optLong("remindAt")) }
  }

  /** The page's table first; custom:#hex computed like palettes.ts does; else Paper. */
  private fun colours(id: String, palettes: JSONObject): Pair<String, String> {
    palettes.optJSONObject(id)?.let { return it.optString("bg") to it.optString("fg") }
    if (id.startsWith("custom:#") && id.length == 14) {
      val hex = id.substring(7)
      val n = runCatching { hex.substring(1).toInt(16) }.getOrNull()
      if (n != null) {
        val lum = (0.299 * ((n shr 16) and 255) + 0.587 * ((n shr 8) and 255) + 0.114 * (n and 255)) / 255
        return hex to if (lum < 0.55) "#ECEDEF" else "#26282B"
      }
    }
    return palettes.optJSONObject("paper")?.let { it.optString("bg") to it.optString("fg") } ?: ("#FBFAF6" to "#2A2C2E")
  }

  private fun listFiles(token: String, folder: String): List<JSONObject> {
    val out = mutableListOf<JSONObject>()
    var page: String? = null
    val q = URLEncoder.encode("'$folder' in parents and trashed=false", "UTF-8")
    do {
      var url = "$API/files?q=$q&fields=nextPageToken,files(id,name,modifiedTime)&pageSize=1000"
      if (page != null) url += "&pageToken=" + URLEncoder.encode(page, "UTF-8")
      val body = JSONObject(get(token, url))
      val files = body.optJSONArray("files") ?: JSONArray()
      for (i in 0 until files.length()) {
        val f = files.getJSONObject(i)
        if (f.optString("name").endsWith(".json")) out += f
      }
      page = body.optString("nextPageToken").ifEmpty { null }
    } while (page != null)
    return out
  }

  private fun download(token: String, fileId: String) = get(token, "$API/files/$fileId?alt=media")

  private fun get(token: String, url: String): String {
    val conn = URL(url).openConnection() as HttpURLConnection
    conn.setRequestProperty("Authorization", "Bearer $token")
    conn.connectTimeout = 15_000
    conn.readTimeout = 30_000
    if (conn.responseCode !in 200..299) throw Exception("Drive ${conn.responseCode}")
    return conn.inputStream.use { it.reader().readText() }
  }

  companion object {
    private const val API = "https://www.googleapis.com/drive/v3"
    private const val NAME = "notes-refresh"

    /** Idempotent: keeps an existing schedule rather than restarting its clock. */
    fun ensureScheduled(context: Context) {
      val req = PeriodicWorkRequestBuilder<NotesRefreshWorker>(30, TimeUnit.MINUTES)
        .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
        .build()
      WorkManager.getInstance(context).enqueueUniquePeriodicWork(NAME, ExistingPeriodicWorkPolicy.KEEP, req)
    }
  }
}

/** Note HTML to widget text; mirrors widgetText() in src/lib/widget.ts. */
object NoteText {
  private val TASK = Regex("<li[^>]*data-checked=\"(true|false)\"[^>]*>")
  private val LI = Regex("<li[^>]*>")
  private val BREAK = Regex("<(br|/p|/h\\d|/li|/div|/blockquote)[^>]*>")
  private val TAG = Regex("<[^>]+>")
  private val SPACE = Regex("\\s+")

  fun fromHtml(html: String): String {
    var s = TASK.replace(html) { if (it.groupValues[1] == "true") "\n☑ " else "\n☐ " }
    s = LI.replace(s, "\n• ")
    s = BREAK.replace(s, "\n")
    s = TAG.replace(s, "")
    s = s.replace("&lt;", "<").replace("&gt;", ">").replace("&quot;", "\"")
      .replace("&#39;", "'").replace("&nbsp;", " ").replace("&amp;", "&")
    return s.split("\n")
      .map { SPACE.replace(it, " ").trim() }
      .filter { it.isNotEmpty() && it != "•" && it != "☐" && it != "☑" }
      .joinToString("\n")
  }
}
