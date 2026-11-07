package expo.modules.streamhelper

import android.content.Context
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * The phone's side of the Android bridge's helper() and helperState() (ADR 0005, decision 13).
 * src/player/phone-host.ts puts them on window.BannerAndroid, so the shared androidHelperState()
 * and sendHelperCommand() reach this phone's helper as they reach the Android TV app's.
 */
class StreamHelperModule : Module() {
    private val context: Context
        get() = appContext.reactContext?.applicationContext ?: throw Exceptions.ReactContextLost()

    override fun definition() = ModuleDefinition {
        Name("BannerStreamHelper")

        // Synchronous, as the bridge's helperState() is: the same JSON the Android TV app returns.
        Function("state") {
            StreamHelper.state(context).toString()
        }

        // "start", "stop" or "forget" (unpair every TV). Anything else is ignored.
        Function("command") { command: String ->
            when (command) {
                "start" -> StreamHelper.start(context)
                "stop" -> StreamHelper.stop(context)
                "forget" -> StreamHelper.forgetTvs(context)
                else -> Unit
            }
        }
    }
}
