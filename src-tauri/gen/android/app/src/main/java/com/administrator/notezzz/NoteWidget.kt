package com.administrator.notezzz

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.view.View
import android.widget.RemoteViews
import org.json.JSONArray
import java.io.File

/**
 * Home-screen widget: up to three notes, each on its own colour, title and
 * a line of text. Data comes from `widget.json` in the app's files dir,
 * written by the app (Rust `write_widget_snapshot`) whenever notes change;
 * the widget has no access to the webview or its storage. Re-rendered when
 * the app goes to the background (MainActivity.onPause), on the launcher's
 * 30-minute schedule, and when a widget is added.
 */
class NoteWidget : AppWidgetProvider() {
  override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
    val notes = readSnapshot(context)
    for (id in ids) manager.updateAppWidget(id, render(context, notes))
  }

  private data class Note(val id: String, val title: String, val text: String, val bg: Int, val fg: Int)

  private fun readSnapshot(context: Context): List<Note> = runCatching {
    val raw = File(context.filesDir, "widget.json").takeIf { it.exists() }?.readText() ?: return emptyList()
    val arr = JSONArray(raw)
    (0 until arr.length()).map { i ->
      val o = arr.getJSONObject(i)
      Note(
        o.optString("id"),
        o.optString("title").ifBlank { "Note" },
        o.optString("text"),
        parseColor(o.optString("bg"), 0xFFFBFAF6.toInt()),
        parseColor(o.optString("fg"), 0xFF2A2C2E.toInt()),
      )
    }
  }.getOrDefault(emptyList())

  private fun parseColor(hex: String, fallback: Int): Int =
    runCatching { Color.parseColor(hex) }.getOrDefault(fallback)

  private fun render(context: Context, notes: List<Note>): RemoteViews {
    val views = RemoteViews(context.packageName, R.layout.widget_note)
    val rows = listOf(
      Triple(R.id.row1, R.id.title1, R.id.text1),
      Triple(R.id.row2, R.id.title2, R.id.text2),
      Triple(R.id.row3, R.id.title3, R.id.text3),
    )
    rows.forEachIndexed { i, (row, title, text) ->
      val n = notes.getOrNull(i)
      if (n == null) {
        views.setViewVisibility(row, View.GONE)
        return@forEachIndexed
      }
      views.setViewVisibility(row, View.VISIBLE)
      views.setInt(row, "setBackgroundColor", n.bg)
      views.setTextViewText(title, n.title)
      views.setTextColor(title, n.fg)
      views.setTextViewText(text, n.text)
      views.setTextColor(text, n.fg)
      views.setViewVisibility(text, if (n.text.isBlank()) View.GONE else View.VISIBLE)
    }
    views.setViewVisibility(R.id.empty, if (notes.isEmpty()) View.VISIBLE else View.GONE)

    // Any tap opens the app.
    val open = Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    val pi = PendingIntent.getActivity(
      context, 0, open, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )
    views.setOnClickPendingIntent(R.id.root, pi)
    return views
  }
}
