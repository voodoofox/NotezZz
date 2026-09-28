package com.administrator.notezzz

import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.view.View
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import org.json.JSONObject
import java.io.File

class MainActivity : TauriActivity() {
  /** Status bar height in CSS px, read by the page (see bridge below). */
  @Volatile private var safeTopCss = 0f
  /** Navigation bar height in CSS px (0 while the keyboard is up). */
  @Volatile private var safeBottomCss = 0f

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    stashShare(intent)
    stashAction(intent)

    // Android 15 draws every app edge to edge: the webview sits under the
    // status bar, the navigation bar and the keyboard. The page paints its own
    // colours under both bars and pads its header and bottom toolbars by their
    // heights (read through the bridge). Only the keyboard is handled here:
    // while it is up the view is lifted above it, so the note's toolbar rides
    // on the keyboard like it does in Chrome; the keyboard covers the
    // navigation bar then, so the page's bottom inset drops to zero.
    val content = findViewById<View>(android.R.id.content)
    ViewCompat.setOnApplyWindowInsetsListener(content) { v, insets ->
      val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars())
      val imeVisible = insets.isVisible(WindowInsetsCompat.Type.ime())
      val ime = insets.getInsets(WindowInsetsCompat.Type.ime())
      val density = resources.displayMetrics.density
      safeTopCss = bars.top / density
      safeBottomCss = if (imeVisible) 0f else bars.bottom / density
      v.setPadding(bars.left, 0, bars.right, if (imeVisible) ime.bottom else 0)
      insets
    }
  }

  override fun onWebViewCreate(webView: WebView) {
    super.onWebViewCreate(webView)
    webView.addJavascriptInterface(Bridge(), "NotezzzAndroid")
  }

  /** What the page needs from Android: system bars and widgets. Local page only. */
  inner class Bridge {
    /** Called after the page rewrites widget.json, so widgets follow at once. */
    @JavascriptInterface
    fun refreshWidgets() = MainActivity.refreshWidgets(this@MainActivity)

    @JavascriptInterface
    fun safeTop(): Float = safeTopCss

    @JavascriptInterface
    fun safeBottom(): Float = safeBottomCss

    /** Status-bar icons: light on a dark app theme, dark on a light one. */
    @JavascriptInterface
    fun setDarkTheme(dark: Boolean) {
      runOnUiThread {
        WindowCompat.getInsetsController(window, window.decorView).apply {
          isAppearanceLightStatusBars = !dark
          isAppearanceLightNavigationBars = !dark
        }
      }
    }
  }

  // launchMode is singleTask, so a share or a widget tap into a running app
  // arrives here, not in onCreate.
  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    setIntent(intent)
    stashShare(intent)
    stashAction(intent)
  }

  /**
   * The Android share sheet hands text to this activity as an intent. The
   * webview can't see intents, so the text goes into a file in the app's
   * data dir (WidgetData.dir); the Rust command `take_pending_share` reads and deletes it,
   * and the frontend checks it on launch and on every return to the
   * foreground.
   */
  private fun stashShare(intent: Intent?) {
    if (intent?.action != Intent.ACTION_SEND) return
    val subject = intent.getStringExtra(Intent.EXTRA_SUBJECT)?.trim().orEmpty()
    val text = (intent.getCharSequenceExtra(Intent.EXTRA_TEXT)?.toString() ?: readSharedStream(intent))
      ?.trim().orEmpty()
    val joined = listOf(subject, text).filter { it.isNotEmpty() }.joinToString("\n")
    if (joined.isEmpty()) return
    runCatching { File(WidgetData.dir(this), "pending-share.txt").writeText(joined) }
    // Consume it: a rotation or relaunch must not share the same text twice.
    intent.action = null
  }

  /** A shared text FILE (EXTRA_STREAM), read up to 256 KB; null if none. */
  private fun readSharedStream(intent: Intent): String? {
    @Suppress("DEPRECATION")
    val uri = intent.getParcelableExtra<Uri>(Intent.EXTRA_STREAM) ?: return null
    return runCatching {
      contentResolver.openInputStream(uri)?.use { input ->
        val buf = ByteArray(256 * 1024)
        var n = 0
        while (n < buf.size) {
          val r = input.read(buf, n, buf.size - n)
          if (r < 0) break
          n += r
        }
        String(buf, 0, n, Charsets.UTF_8)
      }
    }.getOrNull()
  }

  /**
   * A widget tap: open a note, or start a new / voice / draw note. Same hand-
   * off as a share — a file the frontend takes through `take_pending_action`.
   */
  private fun stashAction(intent: Intent?) {
    val action = intent?.getStringExtra(EXTRA_ACTION) ?: return
    val json = JSONObject().put("action", action)
    intent.getStringExtra(EXTRA_NOTE)?.let { json.put("id", it) }
    runCatching { File(WidgetData.dir(this), "pending-action.json").writeText(json.toString()) }
    intent.removeExtra(EXTRA_ACTION)
    intent.removeExtra(EXTRA_NOTE)
  }

  // Widgets render from widget.json, which the app rewrites as notes change.
  // Leaving the app is the moment to tell the launcher to re-read it.
  override fun onPause() {
    super.onPause()
    refreshWidgets(this)
  }

  companion object {
    const val EXTRA_ACTION = "notezzz_action"
    const val EXTRA_NOTE = "notezzz_note"

    /** Re-render every NotezZz widget on the home screen. */
    fun refreshWidgets(context: Context) {
      val mgr = AppWidgetManager.getInstance(context)
      for (cls in listOf(NoteWidget::class.java, SingleNoteWidget::class.java, QuickWidget::class.java)) {
        val ids = mgr.getAppWidgetIds(ComponentName(context, cls))
        if (ids.isEmpty()) continue
        context.sendBroadcast(
          Intent(context, cls)
            .setAction(AppWidgetManager.ACTION_APPWIDGET_UPDATE)
            .putExtra(AppWidgetManager.EXTRA_APPWIDGET_IDS, ids)
        )
      }
    }

    /** An intent that opens the app and hands it a widget action. */
    fun actionIntent(context: Context, action: String, noteId: String? = null): Intent =
      Intent(context, MainActivity::class.java)
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        .putExtra(EXTRA_ACTION, action)
        .apply { noteId?.let { putExtra(EXTRA_NOTE, it) } }
  }
}
