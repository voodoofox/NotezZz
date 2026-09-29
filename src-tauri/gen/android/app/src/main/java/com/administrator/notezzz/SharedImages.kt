package com.administrator.notezzz

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.media.ExifInterface
import android.net.Uri
import android.util.Base64
import java.io.ByteArrayOutputStream
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/**
 * Photos and screenshots shared into NotezZz, made note-sized: upright (EXIF
 * rotation applied), at most MAX_PX on the long side — the same limit as the
 * editor's own image button — and inlined as data URLs, because notes sync
 * as single JSON files.
 */
object SharedImages {
  private const val MAX_PX = 1280
  /** A share of a whole album must not turn into one enormous note. */
  const val MAX_IMAGES = 6

  fun dataUrl(context: Context, uri: Uri): String? = runCatching {
    val resolver = context.contentResolver
    val type = resolver.getType(uri).orEmpty()

    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    resolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, bounds) }
    val longSide = max(bounds.outWidth, bounds.outHeight)
    if (longSide <= 0) return null

    // Decode no bigger than needed: a power-of-two subsample first, then an
    // exact scale. A 12 MP photo never has to fit in memory at full size.
    var sample = 1
    while (longSide / (sample * 2) >= MAX_PX) sample *= 2
    val decoded = resolver.openInputStream(uri)?.use {
      BitmapFactory.decodeStream(it, null, BitmapFactory.Options().apply { inSampleSize = sample })
    } ?: return null

    val k = min(1f, MAX_PX.toFloat() / max(decoded.width, decoded.height))
    val matrix = Matrix().apply {
      postScale(k, k)
      postRotate(rotation(context, uri))
    }
    val upright = Bitmap.createBitmap(decoded, 0, 0, decoded.width, decoded.height, matrix, true)

    val png = type == "image/png"
    val out = ByteArrayOutputStream()
    upright.compress(if (png) Bitmap.CompressFormat.PNG else Bitmap.CompressFormat.JPEG, 85, out)
    "data:image/${if (png) "png" else "jpeg"};base64," + Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP)
  }.getOrNull()

  private fun rotation(context: Context, uri: Uri): Float = runCatching {
    context.contentResolver.openInputStream(uri)?.use {
      when (ExifInterface(it).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)) {
        ExifInterface.ORIENTATION_ROTATE_90 -> 90f
        ExifInterface.ORIENTATION_ROTATE_180 -> 180f
        ExifInterface.ORIENTATION_ROTATE_270 -> 270f
        else -> 0f
      }
    } ?: 0f
  }.getOrDefault(0f)
}
