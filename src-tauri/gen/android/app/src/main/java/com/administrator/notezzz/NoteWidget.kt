package com.administrator.notezzz

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.widget.RemoteViews

/**
 * The list widget: every note, scrollable, each row on its own colour. A tap
 * opens that note; the + in the header starts a new one. (Kept the class name
 * from the first three-row version so widgets already on a home screen stay.)
 */
class NoteWidget : AppWidgetProvider() {
  override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
    for (id in ids) {
      val views = RemoteViews(context.packageName, R.layout.widget_list)

      // Rows come from NoteListService; the data URI keeps one adapter per widget.
      val svc = Intent(context, NoteListService::class.java)
        .putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id)
      svc.data = Uri.parse(svc.toUri(Intent.URI_INTENT_SCHEME))
      views.setRemoteAdapter(R.id.list, svc)
      views.setEmptyView(R.id.list, R.id.empty)

      // Row taps: one mutable template, each row fills in its note id.
      val template = PendingIntent.getActivity(
        context, 100 + id, MainActivity.actionIntent(context, "open"),
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE
      )
      views.setPendingIntentTemplate(R.id.list, template)

      views.setOnClickPendingIntent(
        R.id.add,
        PendingIntent.getActivity(
          context, 200 + id, MainActivity.actionIntent(context, "new"),
          PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
      )
      views.setOnClickPendingIntent(
        R.id.header,
        PendingIntent.getActivity(
          context, 300 + id, MainActivity.actionIntent(context, "show"),
          PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
      )
      manager.updateAppWidget(id, views)
    }
    // The factory caches rows; tell it the file changed.
    manager.notifyAppWidgetViewDataChanged(ids, R.id.list)
  }
}
