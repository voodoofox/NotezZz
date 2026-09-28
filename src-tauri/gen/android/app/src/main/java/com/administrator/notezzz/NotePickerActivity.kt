package com.administrator.notezzz

import android.app.Activity
import android.appwidget.AppWidgetManager
import android.content.Intent
import android.os.Bundle
import android.view.View
import android.view.ViewGroup
import android.widget.ArrayAdapter
import android.widget.ListView
import android.widget.TextView

/**
 * "Which note should this widget show?" Opens when a one-note widget is
 * placed, from its reconfigure option, and when its note has gone. Lists the
 * notes the app last wrote for widgets, each on its own colour.
 */
class NotePickerActivity : Activity() {
  private var widgetId = AppWidgetManager.INVALID_APPWIDGET_ID

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    // Backing out must not leave a half-placed widget behind.
    setResult(RESULT_CANCELED)
    widgetId = intent?.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID)
      ?: AppWidgetManager.INVALID_APPWIDGET_ID
    if (widgetId == AppWidgetManager.INVALID_APPWIDGET_ID) return finish()
    title = "Choose a note"

    val notes = WidgetData.read(this)
    val list = ListView(this)
    if (notes.isEmpty()) {
      setContentView(TextView(this).apply {
        text = "Open NotezZz once so its notes are available here."
        setPadding(48, 48, 48, 48)
      })
      return
    }
    list.adapter = object : ArrayAdapter<WidgetNote>(this, android.R.layout.simple_list_item_2, android.R.id.text1, notes) {
      override fun getView(position: Int, convertView: View?, parent: ViewGroup): View {
        val v = super.getView(position, convertView, parent)
        val n = notes[position]
        v.setBackgroundColor(n.bg)
        v.findViewById<TextView>(android.R.id.text1).apply { text = n.title; setTextColor(n.fg) }
        v.findViewById<TextView>(android.R.id.text2).apply {
          text = n.text.lineSequence().firstOrNull().orEmpty()
          setTextColor(n.fg)
        }
        return v
      }
    }
    list.setOnItemClickListener { _, _, position, _ ->
      val n = notes[position]
      WidgetData.choose(this, widgetId, n.id)
      val mgr = AppWidgetManager.getInstance(this)
      mgr.updateAppWidget(widgetId, SingleNoteWidget.render(this, widgetId, notes))
      setResult(RESULT_OK, Intent().putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId))
      finish()
    }
    setContentView(list)
  }
}
