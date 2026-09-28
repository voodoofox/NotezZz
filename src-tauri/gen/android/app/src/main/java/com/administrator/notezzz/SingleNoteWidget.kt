package com.administrator.notezzz

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context
import android.content.Intent
import android.widget.RemoteViews

/**
 * One chosen note, as large as the widget is: title and as much text as fits,
 * on the note's colour. Which note is picked in NotePickerActivity when the
 * widget is placed (and again from the widget's reconfigure option).
 */
class SingleNoteWidget : AppWidgetProvider() {
  override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
    val notes = WidgetData.read(context)
    for (id in ids) manager.updateAppWidget(id, render(context, id, notes))
  }

  override fun onDeleted(context: Context, ids: IntArray) {
    for (id in ids) WidgetData.forget(context, id)
  }

  companion object {
    fun render(context: Context, widgetId: Int, notes: List<WidgetNote>): RemoteViews {
      val views = RemoteViews(context.packageName, R.layout.widget_single)
      val chosen = WidgetData.chosenNote(context, widgetId)
      val n = notes.firstOrNull { it.id == chosen }
      if (n == null) {
        // Deleted since it was chosen, or not chosen yet: a tap picks again.
        views.setInt(R.id.bg, "setColorFilter", 0xFFFBFAF6.toInt())
        views.setTextViewText(R.id.title, "NotezZz")
        views.setTextColor(R.id.title, 0xFF2A2C2E.toInt())
        views.setTextViewText(R.id.text, "Tap to choose a note")
        views.setTextColor(R.id.text, 0xFF2A2C2E.toInt())
        val pick = Intent(context, NotePickerActivity::class.java)
          .putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId)
          .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        views.setOnClickPendingIntent(
          R.id.card,
          PendingIntent.getActivity(context, 400 + widgetId, pick, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        )
        return views
      }
      views.setInt(R.id.bg, "setColorFilter", n.bg)
      views.setTextViewText(R.id.title, n.title)
      views.setTextColor(R.id.title, n.fg)
      views.setTextViewText(R.id.text, n.text)
      views.setTextColor(R.id.text, n.fg)
      views.setOnClickPendingIntent(
        R.id.card,
        PendingIntent.getActivity(
          context, 500 + widgetId, MainActivity.actionIntent(context, "open", n.id),
          PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
      )
      return views
    }
  }
}
