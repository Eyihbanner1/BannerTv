package expo.modules.bannerrelaunch

import android.app.Activity
import android.content.Context
import android.content.pm.ActivityInfo
import android.os.Bundle
import expo.modules.core.BasePackage
import expo.modules.core.interfaces.ReactActivityLifecycleListener

/**
 * Stands every new activity upright before anything is drawn. Android keeps the sideways lock
 * the player asked for with the activity's record, so when it closes the app in the background
 * while the player is open and later brings it back, the app would open sideways on Home until
 * the JavaScript asks for upright (src/player/orientation.ts). A new activity always opens on
 * Home, never on the player, so upright is always right here.
 *
 * Asking before the activity's first resume also makes expo-screen-orientation remember upright
 * as the orientation it puts back when the app starts itself again ("Who's watching?" after a
 * launcher tap, a profile switch, an account join), instead of the leftover sideways lock.
 */
class UprightStartPackage : BasePackage() {
  override fun createReactActivityLifecycleListeners(activityContext: Context): List<ReactActivityLifecycleListener> {
    return listOf(UprightStartListener())
  }
}

class UprightStartListener : ReactActivityLifecycleListener {
  override fun onCreate(activity: Activity, savedInstanceState: Bundle?) {
    activity.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_PORTRAIT
  }
}
