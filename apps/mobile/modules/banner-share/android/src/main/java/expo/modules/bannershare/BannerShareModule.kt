package expo.modules.bannershare

import android.content.Intent
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/** Longer than any addon address: shared text past this is not one, so it is not passed on. */
private const val MAX_TEXT = 8192

/**
 * The text another app shared with BannerTV ("Share to BannerTV"), or null when the intent is
 * no text share. The page decides whether it holds an addon's address.
 */
private fun sharedText(intent: Intent?): String? {
  if (intent == null || intent.action != Intent.ACTION_SEND) return null
  if (intent.type?.startsWith("text/") != true) return null
  val text = intent.getCharSequenceExtra(Intent.EXTRA_TEXT)?.toString() ?: return null
  return if (text.length <= MAX_TEXT) text else null
}

/**
 * Hands the page what is shared with BannerTV, as an addon's address from a browser
 * (app.config.ts asks Android for text shares). The app's activity is singleTask, so a share
 * while the app runs arrives here as a new intent and goes out as `shared`; a share that starts
 * the app is the activity's own intent, which the page reads once with takeLaunchText. The text
 * can hold an addon's keys: it is never logged.
 */
class BannerShareModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("BannerShare")
    Events("shared")

    Function("takeLaunchText") {
      val intent = appContext.currentActivity?.intent
      val text = sharedText(intent)
      // Taken once: the share is handled, and the screens may start again in this run.
      if (text != null) intent?.removeExtra(Intent.EXTRA_TEXT)
      text
    }

    OnNewIntent { intent ->
      val text = sharedText(intent)
      if (text != null) sendEvent("shared", mapOf("text" to text))
    }
  }
}
