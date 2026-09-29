package com.administrator.notezzz

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.FileProvider
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import kotlin.concurrent.thread

/**
 * Updates from GitHub Releases: download the APK the page found, then hand it
 * to Android's installer. Android itself refuses an APK signed with any key
 * but ours, so a bad download can't replace the app; the URL is still pinned
 * to this repo's release downloads.
 */
class ApkUpdater(
  private val activity: Activity,
  private val reply: (id: Int, ok: Boolean, value: String) -> Unit,
  private val progress: (id: Int, percent: Int) -> Unit,
) {
  fun install(id: Int, url: String) {
    if (!url.startsWith(ALLOWED)) return reply(id, false, "Refusing an update from outside the NotezZz releases")
    // Android 8+: the user allows "install unknown apps" once per app. Open
    // that switch and let them tap Install again after.
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !activity.packageManager.canRequestPackageInstalls()) {
      activity.runOnUiThread {
        activity.startActivity(
          Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${activity.packageName}"))
        )
      }
      return reply(id, false, "permission")
    }
    thread {
      try {
        val dir = File(activity.cacheDir, "updates").apply { mkdirs() }
        val file = File(dir, "NotezZz-update.apk")
        download(url, file) { progress(id, it) }
        val uri = FileProvider.getUriForFile(activity, "${activity.packageName}.fileprovider", file)
        val intent = Intent(Intent.ACTION_VIEW)
          .setDataAndType(uri, "application/vnd.android.package-archive")
          .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
        activity.runOnUiThread { activity.startActivity(intent) }
        reply(id, true, "")
      } catch (e: Exception) {
        reply(id, false, e.message ?: "Download failed")
      }
    }
  }

  private fun download(url: String, to: File, onPercent: (Int) -> Unit) {
    // GitHub answers with a redirect to its file host; both are https.
    val conn = URL(url).openConnection() as HttpURLConnection
    conn.instanceFollowRedirects = true
    conn.connectTimeout = 15_000
    conn.readTimeout = 30_000
    if (conn.responseCode !in 200..299) throw Exception("Download failed (HTTP ${conn.responseCode})")
    val total = conn.contentLengthLong
    var done = 0L
    var last = -1
    conn.inputStream.use { input ->
      to.outputStream().use { out ->
        val buf = ByteArray(64 * 1024)
        while (true) {
          val n = input.read(buf)
          if (n < 0) break
          out.write(buf, 0, n)
          done += n
          if (total > 0) {
            val pct = ((done * 100) / total).toInt().coerceAtMost(99)
            if (pct != last) { last = pct; onPercent(pct) }
          }
        }
      }
    }
    if (total > 0 && done != total) throw Exception("Download was cut short")
  }

  companion object {
    private const val ALLOWED = "https://github.com/voodoofox/NotezZz/releases/download/"
  }
}
