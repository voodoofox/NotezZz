package com.administrator.notezzz

import android.content.Context
import android.graphics.Color
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/**
 * One note as the widgets show it: plain text, colours already resolved.
 * `remindAt` is epoch ms (0 = none) and drives the reminder notifications.
 */
data class WidgetNote(
  val id: String,
  val title: String,
  val text: String,
  val bg: Int,
  val fg: Int,
  val pinned: Boolean,
  val remindAt: Long = 0,
)

/**
 * widget.json, written by the page (src/lib/widget.ts) and by the background
 * refresh (NotesRefreshWorker). Version 2 is an object: the notes, where they
 * live in Drive, and each colour id's colours. Version 1 (0.20.x) was a bare
 * array of notes and is still read.
 */
data class WidgetSnapshot(
  val notes: List<WidgetNote>,
  /** Drive ids the page last saw, or null when not syncing through Drive. */
  val notesFolderId: String?,
  val settingsId: String?,
  /** Raw "palettes" object, kept as-is when the worker rewrites the file. */
  val palettes: JSONObject,
)

object WidgetData {
  /**
   * The folder Rust reads and writes: Tauri's app_local_data_dir, which on
   * Android is Context.getDataDir() (/data/user/0/<pkg>), NOT filesDir (its
   * files/ subfolder). Every hand-off file lives here: widget.json,
   * pending-share.txt, pending-action.json.
   */
  fun dir(context: Context): File = context.dataDir

  private fun file(context: Context) = File(dir(context), "widget.json")

  fun read(context: Context): List<WidgetNote> = readSnapshot(context)?.notes ?: emptyList()

  fun readSnapshot(context: Context): WidgetSnapshot? = runCatching {
    val f = file(context)
    if (!f.exists()) return null
    val raw = f.readText().trim()
    if (raw.startsWith("[")) return WidgetSnapshot(notesFrom(JSONArray(raw)), null, null, JSONObject())
    val o = JSONObject(raw)
    val drive = o.optJSONObject("drive")
    WidgetSnapshot(
      notesFrom(o.optJSONArray("notes") ?: JSONArray()),
      drive?.optString("notesFolderId")?.ifEmpty { null }?.takeIf { it != "null" },
      drive?.optString("settingsId")?.ifEmpty { null }?.takeIf { it != "null" },
      o.optJSONObject("palettes") ?: JSONObject(),
    )
  }.getOrNull()

  private fun notesFrom(arr: JSONArray): List<WidgetNote> = (0 until arr.length()).map { i ->
    val o = arr.getJSONObject(i)
    WidgetNote(
      o.optString("id"),
      o.optString("title").ifBlank { firstLine(o.optString("text")) },
      o.optString("text"),
      parse(o.optString("bg"), 0xFFFBFAF6.toInt()),
      parse(o.optString("fg"), 0xFF2A2C2E.toInt()),
      o.optBoolean("pinned"),
      o.optLong("remindAt", 0),
    )
  }

  /** Rewrite widget.json from the background refresh, keeping the page's metadata. */
  fun write(context: Context, snap: WidgetSnapshot, notes: List<JSONObject>) {
    val o = JSONObject()
      .put("v", 2)
      .put(
        "drive",
        JSONObject().put("notesFolderId", snap.notesFolderId ?: JSONObject.NULL).put("settingsId", snap.settingsId ?: JSONObject.NULL)
      )
      .put("palettes", snap.palettes)
      .put("notes", JSONArray(notes))
    val f = file(context)
    val tmp = File(f.parentFile, "widget.json.tmp")
    tmp.writeText(o.toString())
    if (!tmp.renameTo(f)) {
      f.writeText(o.toString())
      tmp.delete()
    }
  }

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
