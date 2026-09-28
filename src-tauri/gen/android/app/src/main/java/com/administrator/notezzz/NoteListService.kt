package com.administrator.notezzz

import android.content.Context
import android.content.Intent
import android.view.View
import android.widget.RemoteViews
import android.widget.RemoteViewsService

/** Supplies the list widget's rows from widget.json. */
class NoteListService : RemoteViewsService() {
  override fun onGetViewFactory(intent: Intent): RemoteViewsFactory = Factory(applicationContext)

  private class Factory(private val context: Context) : RemoteViewsFactory {
    private var notes: List<WidgetNote> = emptyList()

    override fun onCreate() {}
    // Called on notifyAppWidgetViewDataChanged: re-read the file.
    override fun onDataSetChanged() {
      notes = WidgetData.read(context)
    }
    override fun onDestroy() {}
    override fun getCount() = notes.size
    override fun getLoadingView(): RemoteViews? = null
    override fun getViewTypeCount() = 1
    override fun getItemId(position: Int) = notes.getOrNull(position)?.id?.hashCode()?.toLong() ?: position.toLong()
    override fun hasStableIds() = true

    override fun getViewAt(position: Int): RemoteViews {
      val n = notes.getOrNull(position) ?: return RemoteViews(context.packageName, R.layout.widget_list_row)
      return RemoteViews(context.packageName, R.layout.widget_list_row).apply {
        setInt(R.id.bg, "setColorFilter", n.bg)
        setTextViewText(R.id.title, n.title)
        setTextColor(R.id.title, n.fg)
        setTextViewText(R.id.text, n.text)
        setTextColor(R.id.text, n.fg)
        setViewVisibility(R.id.text, if (n.text.isBlank()) View.GONE else View.VISIBLE)
        setViewVisibility(R.id.pin, if (n.pinned) View.VISIBLE else View.GONE)
        setInt(R.id.pin, "setColorFilter", n.fg)
        setOnClickFillInIntent(
          R.id.row,
          Intent().putExtra(MainActivity.EXTRA_ACTION, "open").putExtra(MainActivity.EXTRA_NOTE, n.id)
        )
      }
    }
  }
}
