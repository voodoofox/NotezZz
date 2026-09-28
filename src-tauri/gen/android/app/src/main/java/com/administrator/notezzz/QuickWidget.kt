package com.administrator.notezzz

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context
import android.widget.RemoteViews

/** Three buttons: new note, voice note, drawing — each opens straight into it. */
class QuickWidget : AppWidgetProvider() {
  override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
    for (id in ids) {
      val views = RemoteViews(context.packageName, R.layout.widget_quick)
      listOf(
        Triple(R.id.qnew, "new", 1),
        Triple(R.id.qvoice, "voice", 2),
        Triple(R.id.qdraw, "draw", 3),
      ).forEach { (view, action, n) ->
        views.setOnClickPendingIntent(
          view,
          PendingIntent.getActivity(
            context, 600 + id * 10 + n, MainActivity.actionIntent(context, action),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
          )
        )
      }
      manager.updateAppWidget(id, views)
    }
  }
}
