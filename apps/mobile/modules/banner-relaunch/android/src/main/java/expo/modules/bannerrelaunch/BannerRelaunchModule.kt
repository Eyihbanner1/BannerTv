package expo.modules.bannerrelaunch

import android.content.Intent
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Tells the page that BannerTV was opened again from the launcher while it was still running,
 * as the Android TV app's MainActivity does ({ "type": "relaunch" }, ADR 0005). The app's
 * activity is singleTask, so a launcher tap on the live app arrives here as a new intent; a
 * return through Recents does not, so the profile question is not asked on every return.
 */
class BannerRelaunchModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("BannerRelaunch")
    Events("relaunch")

    OnNewIntent { intent ->
      if (intent.action == Intent.ACTION_MAIN && intent.hasCategory(Intent.CATEGORY_LAUNCHER)) {
        sendEvent("relaunch")
      }
    }
  }
}
