package com.administrator.notezzz

import android.content.Context
import android.graphics.Color
import org.json.JSONArray
import java.io.File

/**
 * What the app hands the widgets: every note in list order, plain text, and
 * colours already resolved (the widget process has no palette table and no
 * access to the webview). Written by Rust `write_widget_snapshot`.
 */
data class WidgetNote(
  val id: String,
  val title: String,
  val text: String,
  val bg: Int,
  val fg: Int,
  val pinned: Boolean,
)

object WidgetData {
  fun read(context: Context): List<WidgetNote> = runCatching {
    val f = File(context.filesDir, "widget.json")
    if (!f.exists()) return emptyList()
    val arr = JSONArray(f.readText())
    (0 until arr.length()).map { i ->
      val o = arr.getJSONObject(i)
      WidgetNote(
        o.optString("id"),
        o.optString("title").ifBlank { firstLine(o.optString("text")) },
        o.optString("text"),
        parse(o.optString("bg"), 0xFFFBFAF6.toInt()),
        parse(o.optString("fg"), 0xFF2A2C2E.toInt()),
        o.optBoolean("pinned"),
      )
    }
  }.getOrDefault(emptyList())

  private fun firstLine(s: String) = s.lineSequence().firstOrNull()?.take(60)?.ifBlank { null } ?: "Note"

  private fun parse(hex: String, fallback: Int): Int =
    runCatching { Color.parseColor(hex) }.getOrDefault(fallback)

  // Which note each "one note" widget shows, keyed by widget id.
  private const val PREFS = "notezzz_widgets"

  fun chosenNote(context: Context, widgetId: Int): String? =
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString("note_$widgetId", null)

  fun choose(context: Context, widgetId: Int, noteId: String) {
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString("note_$widgetId", noteId).apply()
  }

  fun forget(context: Context, widgetId: Int) {
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().remove("note_$widgetId").apply()
  }
}
