package com.administrator.notezzz

import android.Manifest
import android.appwidget.AppWidgetManager
import android.content.pm.PackageManager
import android.os.Build
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.view.View
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

class MainActivity : TauriActivity() {
  /** Status bar height in CSS px, read by the page (see bridge below). */
  @Volatile private var safeTopCss = 0f
  /** Navigation bar height in CSS px (0 while the keyboard is up). */
  @Volatile private var safeBottomCss = 0f

  private var webView: WebView? = null

  /**
   * Answer an async bridge call. The page registered the promise under `id`
   * (src/lib/android.ts) and window.__nzReply settles it.
   */
  private fun reply(id: Int, ok: Boolean, value: String) {
    val js = "window.__nzReply && window.__nzReply($id, $ok, ${JSONObject.quote(value)})"
    webView?.post { webView?.evaluateJavascript(js, null) }
  }

  private fun progress(id: Int, percent: Int) {
    val js = "window.__nzProgress && window.__nzProgress($id, $percent)"
    webView?.post { webView?.evaluateJavascript(js, null) }
  }

  private val google = GoogleSignIn(this, ::reply)
  private val updater = ApkUpdater(this, ::reply, ::progress)

  // Registered at construction, as the Activity Result API requires.
  private val consentLauncher =
    registerForActivityResult(ActivityResultContracts.StartIntentSenderForResult()) { google.onConsentResult(it) }

  init {
    google.launcher = consentLauncher
  }

  // Reminders need notifications; asked once, the first time one is set.
  private val notifyPermission =
    registerForActivityResult(ActivityResultContracts.RequestPermission()) { }

  private fun askForNotificationsIfNeeded(notes: List<WidgetNote>) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return
    if (checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) return
    if (!Reminders.anyUpcoming(notes)) return
    val prefs = getSharedPreferences("notezzz_reminders", MODE_PRIVATE)
    if (prefs.getBoolean("askedNotify", false)) return
    prefs.edit().putBoolean("askedNotify", true).apply()
    runOnUiThread { notifyPermission.launch(Manifest.permission.POST_NOTIFICATIONS) }
  }

  /** The app's own light/dark choice, remembered for the next launch. */
  private val uiPrefs by lazy { getSharedPreferences("notezzz_ui", MODE_PRIVATE) }

  /** What the page's header is painted in: the first frame, before the page
   *  has loaded, is this instead of a white flash (in the dark theme). */
  private fun startColor(): Int =
    if (uiPrefs.getBoolean("dark", false)) 0xFF1E2127.toInt() else 0xFFFFFFFF.toInt()

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    val dark = uiPrefs.getBoolean("dark", false)
    window.decorView.setBackgroundColor(startColor())
    WindowCompat.getInsetsController(window, window.decorView).apply {
      isAppearanceLightStatusBars = !dark
      isAppearanceLightNavigationBars = !dark
    }
    stashShare(intent)
    stashAction(intent)
    // Widgets and reminder alarms stay current with the app closed.
    NotesRefreshWorker.ensureScheduled(this)

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
    // A web view is white until its page paints: the app's colour instead.
    webView.setBackgroundColor(startColor())
    this.webView = webView
    webView.addJavascriptInterface(Bridge(), "NotezzzAndroid")
  }

  /** What the page needs from Android: system bars and widgets. Local page only. */
  inner class Bridge {
    /** Called after the page rewrites widget.json: widgets and reminder alarms follow at once. */
    @JavascriptInterface
    fun refreshWidgets() {
      val ctx = this@MainActivity
      MainActivity.refreshWidgets(ctx)
      val notes = WidgetData.read(ctx)
      Reminders.schedule(ctx, notes)
      askForNotificationsIfNeeded(notes)
    }

    @JavascriptInterface
    fun safeTop(): Float = safeTopCss

    @JavascriptInterface
    fun safeBottom(): Float = safeBottomCss

    // Google sign-in (GoogleSignIn.kt). Async ones answer via reply(id, ...).
    @JavascriptInterface
    fun googleAccount(): String = google.accountJson()

    @JavascriptInterface
    fun googleToken(id: Int, interactive: Boolean, invalidate: String) = google.token(id, interactive, invalidate)

    @JavascriptInterface
    fun googleSignOut(id: Int, token: String) = google.signOut(id, token)

    /** Download a release APK and open Android's installer (ApkUpdater.kt). */
    @JavascriptInterface
    fun installApk(id: Int, url: String) = updater.install(id, url)

    /** The app theme itself (not a note's), kept for the next launch's
     *  first frame (see startColor). */
    @JavascriptInterface
    fun setAppTheme(dark: Boolean) {
      uiPrefs.edit().putBoolean("dark", dark).apply()
    }

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
    val action = intent?.action
    if (action != Intent.ACTION_SEND && action != Intent.ACTION_SEND_MULTIPLE) return
    val type = intent.type.orEmpty()
    val subject = intent.getStringExtra(Intent.EXTRA_SUBJECT)?.trim().orEmpty()
    val streamText = if (type.startsWith("text/")) readSharedStream(intent) else null
    val text = (intent.getCharSequenceExtra(Intent.EXTRA_TEXT)?.toString() ?: streamText)?.trim().orEmpty()
    val joined = listOf(subject, text).filter { it.isNotEmpty() }.joinToString("\n")

    // Photos and screenshots: one (SEND) or several (SEND_MULTIPLE).
    val images = if (type.startsWith("image/")) {
      sharedUris(intent).take(SharedImages.MAX_IMAGES).mapNotNull { SharedImages.dataUrl(this, it) }
    } else emptyList()

    if (joined.isEmpty() && images.isEmpty()) return
    // Plain text stays plain (what older builds wrote); with images the page
    // gets JSON it recognises by its first key (parseShare in ShareIntake).
    val payload = if (images.isEmpty()) joined else JSONObject()
      .put("nzShare", 1)
      .put("text", joined)
      .put("images", JSONArray(images))
      .toString()
    runCatching { File(WidgetData.dir(this), "pending-share.txt").writeText(payload) }
    // Consume it: a rotation or relaunch must not share the same thing twice.
    intent.action = null
  }

  @Suppress("DEPRECATION")
  private fun sharedUris(intent: Intent): List<Uri> =
    if (intent.action == Intent.ACTION_SEND_MULTIPLE) {
      intent.getParcelableArrayListExtra<Uri>(Intent.EXTRA_STREAM).orEmpty()
    } else {
      listOfNotNull(intent.getParcelableExtra(Intent.EXTRA_STREAM))
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
  override fun onResume() {
    super.onResume()
    inForeground = true
  }

  override fun onPause() {
    super.onPause()
    inForeground = false
    refreshWidgets(this)
  }

  companion object {
    /** The app is on screen; the background refresh stays out of its way. */
    @Volatile var inForeground = false

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
