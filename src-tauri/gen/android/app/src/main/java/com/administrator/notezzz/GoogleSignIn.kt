package com.administrator.notezzz

import android.accounts.Account
import android.app.Activity
import android.content.Context
import androidx.activity.result.ActivityResult
import androidx.activity.result.ActivityResultLauncher
import androidx.activity.result.IntentSenderRequest
import com.google.android.gms.auth.GoogleAuthUtil
import com.google.android.gms.auth.api.identity.AuthorizationRequest
import com.google.android.gms.auth.api.identity.AuthorizationResult
import com.google.android.gms.auth.api.identity.Identity
import com.google.android.gms.common.api.Scope
import com.google.android.gms.tasks.Tasks
import java.util.concurrent.TimeUnit
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import kotlin.concurrent.thread

/**
 * Native Google sign-in for Drive. Android's own account sheet asks for
 * consent once; after that, tokens come silently from Play services, with no
 * browser round trip and no client secret in the app. Google matches the
 * app to its "Android" OAuth client by package name + signing certificate,
 * so nothing here names a client id. drive.file access is granted per Cloud
 * project, which is why notes written by the desktop and web clients (same
 * project) are visible here.
 *
 * Results go back to the page through [reply] (see MainActivity.reply).
 */
class GoogleSignIn(
  private val activity: Activity,
  private val reply: (id: Int, ok: Boolean, value: String) -> Unit,
) {
  /** Set by MainActivity: shows Google's consent sheet. */
  lateinit var launcher: ActivityResultLauncher<IntentSenderRequest>

  /** Requests waiting on the consent sheet. Main thread only. */
  private val waiting = mutableListOf<Int>()

  private val prefs get() = activity.getSharedPreferences("notezzz_google", Context.MODE_PRIVATE)

  /** {"signedIn": bool, "email": string} — the email may be empty if it couldn't be read. */
  fun accountJson(): String =
    JSONObject()
      .put("signedIn", prefs.getBoolean("signedIn", false))
      .put("email", prefs.getString("email", "") ?: "")
      .toString()

  private fun request(): AuthorizationRequest {
    val b = AuthorizationRequest.builder().setRequestedScopes(SCOPES)
    // Pin the account once known, so a phone with several Google accounts
    // never asks which one again (and never silently picks another).
    prefs.getString("email", "")?.takeIf { it.isNotEmpty() }?.let { b.setAccount(Account(it, "com.google")) }
    return b.build()
  }

  /**
   * A valid access token. `interactive` allows the consent sheet; without
   * it a missing grant fails with "consent_required". `invalidate` is a
   * token Drive rejected: dropped from Play services' cache first.
   */
  fun token(id: Int, interactive: Boolean, invalidate: String) {
    thread {
      if (invalidate.isNotEmpty()) runCatching { GoogleAuthUtil.clearToken(activity, invalidate) }
      activity.runOnUiThread { authorize(id, interactive) }
    }
  }

  private fun authorize(id: Int, interactive: Boolean) {
    Identity.getAuthorizationClient(activity).authorize(request())
      .addOnSuccessListener { r ->
        if (!r.hasResolution()) return@addOnSuccessListener finish(listOf(id), r)
        val pending = r.pendingIntent
        if (!interactive || pending == null) return@addOnSuccessListener reply(id, false, "consent_required")
        waiting += id
        // One sheet at a time; later callers ride on the first one's answer.
        if (waiting.size == 1) {
          runCatching { launcher.launch(IntentSenderRequest.Builder(pending.intentSender).build()) }
            .onFailure { e -> failAll(e.message ?: "cannot show Google sign-in") }
        }
      }
      .addOnFailureListener { e -> reply(id, false, e.message ?: "Google authorization failed") }
  }

  /** The consent sheet closed. */
  fun onConsentResult(result: ActivityResult) {
    if (waiting.isEmpty()) return
    runCatching { Identity.getAuthorizationClient(activity).getAuthorizationResultFromIntent(result.data) }
      .onSuccess { r ->
        val ids = waiting.toList()
        waiting.clear()
        finish(ids, r)
      }
      .onFailure { e ->
        failAll(if (result.resultCode == Activity.RESULT_CANCELED) "cancelled" else e.message ?: "Google sign-in failed")
      }
  }

  private fun failAll(message: String) {
    val ids = waiting.toList()
    waiting.clear()
    ids.forEach { reply(it, false, message) }
  }

  private fun finish(ids: List<Int>, r: AuthorizationResult) {
    val token = r.accessToken
    if (token.isNullOrEmpty()) {
      ids.forEach { reply(it, false, "Google returned no access token") }
      return
    }
    // A grant without Drive can't sync a thing. Drop the token and say so;
    // the phone doesn't count as signed in on it.
    if (!grantsDrive(r)) {
      thread { runCatching { GoogleAuthUtil.clearToken(activity, token) } }
      ids.forEach { reply(it, false, DRIVE_NOT_GRANTED) }
      return
    }
    thread {
      var email = prefs.getString("email", "") ?: ""
      if (!prefs.getBoolean("signedIn", false) || email.isEmpty()) {
        email = fetchEmail(token) ?: email
        prefs.edit().putBoolean("signedIn", true).putString("email", email).apply()
      }
      val json = JSONObject().put("token", token).put("email", email).toString()
      ids.forEach { reply(it, true, json) }
    }
  }

  /** Forget the account on this phone; `token` is dropped from Play services' cache. */
  fun signOut(id: Int, token: String) {
    thread {
      if (token.isNotEmpty()) runCatching { GoogleAuthUtil.clearToken(activity, token) }
      prefs.edit().clear().apply()
      reply(id, true, "")
    }
  }

  /** The account's address, asked of Drive: the app no longer requests Google's email permission. */
  private fun fetchEmail(token: String): String? = runCatching {
    val conn = URL(ABOUT).openConnection() as HttpURLConnection
    conn.setRequestProperty("Authorization", "Bearer $token")
    conn.connectTimeout = 10_000
    conn.readTimeout = 10_000
    conn.inputStream.use {
      JSONObject(it.reader().readText()).optJSONObject("user")?.optString("emailAddress").orEmpty()
    }.ifEmpty { null }
  }.getOrNull()

  companion object {
    /**
     * A token without any UI, for background work (NotesRefreshWorker).
     * Null when signed out here or when Google wants consent again. Blocks:
     * call off the main thread.
     */
    fun silentToken(context: Context): String? = runCatching {
      val prefs = context.getSharedPreferences("notezzz_google", Context.MODE_PRIVATE)
      if (!prefs.getBoolean("signedIn", false)) return null
      val b = AuthorizationRequest.builder().setRequestedScopes(SCOPES)
      prefs.getString("email", "")?.takeIf { it.isNotEmpty() }?.let { b.setAccount(Account(it, "com.google")) }
      val r = Tasks.await(Identity.getAuthorizationClient(context).authorize(b.build()), 30, TimeUnit.SECONDS)
      if (r.hasResolution() || !grantsDrive(r)) null else r.accessToken
    }.getOrNull()

    /**
     * Did Google grant Drive? Its consent screen lists permissions as
     * checkboxes when an app asks for several; the app now asks for Drive
     * alone, and still checks. An empty list is taken on trust: Drive itself
     * rejects a token without the permission, and the app handles that too.
     */
    fun grantsDrive(r: AuthorizationResult): Boolean =
      r.grantedScopes.isEmpty() || r.grantedScopes.contains(DRIVE_FILE)

    const val DRIVE_NOT_GRANTED = "drive_not_granted"
    private const val DRIVE_FILE = "https://www.googleapis.com/auth/drive.file"
    private const val ABOUT = "https://www.googleapis.com/drive/v3/about?fields=user(emailAddress)"
    // Drive alone: a second permission makes Google show checkboxes, and
    // people left Drive unticked.
    private val SCOPES = listOf(Scope(DRIVE_FILE))
  }
}
