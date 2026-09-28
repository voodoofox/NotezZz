package com.administrator.notezzz

import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.Intent
import android.os.Bundle
import androidx.activity.enableEdgeToEdge
import java.io.File

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    stashShare(intent)
  }

  // launchMode is singleTask, so a share into a running app arrives here,
  // not in onCreate.
  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    setIntent(intent)
    stashShare(intent)
  }

  /**
   * The Android share sheet hands text to this activity as an intent. The
   * webview can't see intents, so the text goes into a file in the app's
   * files dir; the Rust command `take_pending_share` reads and deletes it,
   * and the frontend checks it on launch and on every return to the
   * foreground. Same file, same folder Tauri's app-data dir resolves to.
   */
  private fun stashShare(intent: Intent?) {
    if (intent?.action != Intent.ACTION_SEND) return
    val subject = intent.getStringExtra(Intent.EXTRA_SUBJECT)?.trim().orEmpty()
    val text = intent.getStringExtra(Intent.EXTRA_TEXT)?.trim().orEmpty()
    val joined = listOf(subject, text).filter { it.isNotEmpty() }.joinToString("\n")
    if (joined.isEmpty()) return
    runCatching { File(filesDir, "pending-share.txt").writeText(joined) }
    // Consume it: a rotation or relaunch must not share the same text twice.
    intent.action = null
  }

  // The widget renders from widget.json, which the app rewrites as notes
  // change. Leaving the app is the moment to tell the launcher to re-read it.
  override fun onPause() {
    super.onPause()
    val mgr = AppWidgetManager.getInstance(this)
    val ids = mgr.getAppWidgetIds(ComponentName(this, NoteWidget::class.java))
    if (ids.isNotEmpty()) {
      sendBroadcast(
        Intent(this, NoteWidget::class.java)
          .setAction(AppWidgetManager.ACTION_APPWIDGET_UPDATE)
          .putExtra(AppWidgetManager.EXTRA_APPWIDGET_IDS, ids)
      )
    }
  }
}
