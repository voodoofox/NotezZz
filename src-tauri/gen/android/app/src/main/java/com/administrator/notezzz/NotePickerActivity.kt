package com.administrator.notezzz

import android.app.Activity
import android.appwidget.AppWidgetManager
import android.content.Intent
import android.graphics.Typeface
import android.os.Bundle
import android.util.TypedValue
import android.view.View
import android.view.ViewGroup
import android.widget.ArrayAdapter
import android.widget.LinearLayout
import android.widget.ListView
import android.widget.TextView
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat

/**
 * "Which note should this widget show?" Opens when a one-note widget is
 * placed, from its reconfigure option, and when its note has gone. Lists the
 * notes the app last wrote for widgets, each on its own colour.
 *
 * Android 15 draws apps edge to edge, under the status and navigation bars,
 * and the framework action bar no longer pushes the content down, so the
 * first note sat hidden behind the title. The title is part of the layout
 * here instead, and the whole screen is padded by the system bars.
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
    actionBar?.hide()

    val dp = resources.displayMetrics.density
    val root = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
    root.addView(TextView(this).apply {
      text = "Choose a note"
      setTextSize(TypedValue.COMPLEX_UNIT_SP, 22f)
      typeface = Typeface.DEFAULT_BOLD
      setPadding((20 * dp).toInt(), (18 * dp).toInt(), (20 * dp).toInt(), (14 * dp).toInt())
    })

    val notes = WidgetData.read(this)
    if (notes.isEmpty()) {
      root.addView(TextView(this).apply {
        text = "Open NotezZz once so its notes are available here."
        setTextSize(TypedValue.COMPLEX_UNIT_SP, 16f)
        setPadding((20 * dp).toInt(), 0, (20 * dp).toInt(), 0)
      })
    } else {
      val list = ListView(this).apply {
        clipToPadding = false
        adapter = object : ArrayAdapter<WidgetNote>(
          this@NotePickerActivity, android.R.layout.simple_list_item_2, android.R.id.text1, notes
        ) {
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
        setOnItemClickListener { _, _, position, _ ->
          val n = notes[position]
          WidgetData.choose(this@NotePickerActivity, widgetId, n.id)
          val mgr = AppWidgetManager.getInstance(this@NotePickerActivity)
          mgr.updateAppWidget(widgetId, SingleNoteWidget.render(this@NotePickerActivity, widgetId, notes))
          setResult(RESULT_OK, Intent().putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId))
          finish()
        }
      }
      root.addView(list, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f))
    }

    ViewCompat.setOnApplyWindowInsetsListener(root) { v, insets ->
      val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars())
      v.setPadding(bars.left, bars.top, bars.right, bars.bottom)
      insets
    }
    setContentView(root)
  }
}
