package com.administrator.notezzz

import android.Manifest
import android.app.AlarmManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat

/**
 * Note reminders on the phone: an alarm per upcoming reminder, a notification
 * when it goes off, tap to open the note. The PC is the one that pins the
 * note and clears the reminder (store.fireDueReminders); the phone only tells
 * you, once per reminder time. Alarms are rebuilt from widget.json whenever
 * it changes and after a reboot.
 */
object Reminders {
  private const val PREFS = "notezzz_reminders"
  private const val CHANNEL = "reminders"
  private const val DAY = 24 * 60 * 60 * 1000L
  const val EXTRA_ID = "id"
  const val EXTRA_TITLE = "title"
  const val EXTRA_AT = "at"

  fun schedule(context: Context, notes: List<WidgetNote>) {
    val am = context.getSystemService(AlarmManager::class.java) ?: return
    val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    // Drop every alarm set last time; the list below is the whole truth.
    prefs.getStringSet("scheduled", emptySet())!!.forEach { id ->
      alarmIntent(context, id, null, 0, PendingIntent.FLAG_NO_CREATE)?.let { am.cancel(it) }
    }
    val now = System.currentTimeMillis()
    val scheduled = mutableSetOf<String>()
    for (n in notes) {
      val t = n.remindAt
      if (t <= 0 || prefs.getBoolean(doneKey(n.id, t), false)) continue
      if (t <= now) {
        // Came due while the phone was off or the list was stale: say so
        // now, unless it is old news.
        if (now - t < DAY) notify(context, n.id, n.title, t)
        continue
      }
      val pi = alarmIntent(context, n.id, n.title, t, PendingIntent.FLAG_UPDATE_CURRENT) ?: continue
      // Exact when Android allows it; otherwise it may land a few minutes late.
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S || am.canScheduleExactAlarms()) {
        am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, t, pi)
      } else {
        am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, t, pi)
      }
      scheduled += n.id
    }
    prefs.edit().putStringSet("scheduled", scheduled).apply()
  }

  /** Any reminder still ahead? (Worth asking for notification permission.) */
  fun anyUpcoming(notes: List<WidgetNote>): Boolean {
    val now = System.currentTimeMillis()
    return notes.any { it.remindAt > now }
  }

  fun notify(context: Context, id: String, title: String?, at: Long) {
    val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    if (prefs.getBoolean(doneKey(id, at), false)) return
    prefs.edit().putBoolean(doneKey(id, at), true).apply()

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
      ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
    ) return
    val nm = context.getSystemService(NotificationManager::class.java) ?: return
    if (nm.getNotificationChannel(CHANNEL) == null) {
      nm.createNotificationChannel(
        NotificationChannel(CHANNEL, "Reminders", NotificationManager.IMPORTANCE_HIGH).apply {
          description = "A note you asked to be reminded about"
        }
      )
    }
    val open = PendingIntent.getActivity(
      context, id.hashCode(), MainActivity.actionIntent(context, "open", id),
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )
    val n = NotificationCompat.Builder(context, CHANNEL)
      .setSmallIcon(R.drawable.ic_w_alarm)
      .setContentTitle(title?.ifBlank { null } ?: "NotezZz reminder")
      .setContentText("Tap to open the note")
      .setCategory(NotificationCompat.CATEGORY_REMINDER)
      .setPriority(NotificationCompat.PRIORITY_HIGH)
      .setContentIntent(open)
      .setAutoCancel(true)
      .build()
    runCatching { NotificationManagerCompat.from(context).notify(id.hashCode(), n) }
  }

  private fun doneKey(id: String, at: Long) = "done:$id@$at"

  /** One alarm per note: the action carries the id, so each note's intent is distinct. */
  private fun alarmIntent(context: Context, id: String, title: String?, at: Long, flags: Int): PendingIntent? {
    val intent = Intent(context, ReminderReceiver::class.java)
      .setAction("com.administrator.notezzz.REMIND.$id")
      .putExtra(EXTRA_ID, id)
      .putExtra(EXTRA_TITLE, title)
      .putExtra(EXTRA_AT, at)
    return PendingIntent.getBroadcast(context, id.hashCode(), intent, flags or PendingIntent.FLAG_IMMUTABLE)
  }
}

/** An alarm went off. */
class ReminderReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val id = intent.getStringExtra(Reminders.EXTRA_ID) ?: return
    Reminders.notify(context, id, intent.getStringExtra(Reminders.EXTRA_TITLE), intent.getLongExtra(Reminders.EXTRA_AT, 0))
  }
}

/** Alarms don't survive a reboot or an app update; set them again. */
class BootReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    Reminders.schedule(context, WidgetData.read(context))
    NotesRefreshWorker.ensureScheduled(context)
  }
}
