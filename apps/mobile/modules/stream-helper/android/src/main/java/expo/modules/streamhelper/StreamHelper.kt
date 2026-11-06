package expo.modules.streamhelper

import android.content.Context
import android.content.Intent
import androidx.core.content.ContextCompat
import com.bannertv.helper.AddressRules
import com.bannertv.helper.HelperServer
import com.bannertv.helper.Pairing
import com.bannertv.helper.StreamLinks
import java.net.NetworkInterface
import org.json.JSONObject

/**
 * The stream helper as the phone app sees it: switched on and off from Settings, run by
 * HelperService so it keeps going with the screen off. The Android TV app's StreamHelper.kt with
 * this module's service and the app's own version; the server and its rules are shared from
 * apps/androidtv/helper-core.
 */
object StreamHelper {
    private const val PREFS = "stream_helper"
    private const val KEYS = "keys"

    private var server: HelperServer? = null
    private var pairing: Pairing? = null

    @Synchronized
    fun isOn(): Boolean = server != null

    /** Starts the server. Called by HelperService only. */
    @Synchronized
    internal fun startServer(context: Context) {
        if (server != null) return
        val prefs = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val saved = prefs.getStringSet(KEYS, emptySet()) ?: emptySet()
        val pairs = Pairing(saved) { keys -> prefs.edit().putStringSet(KEYS, keys).apply() }
        val created =
            HelperServer(
                links = StreamLinks(),
                pairing = pairs,
                userAgent = "BannerTV/${versionName(context)} (Android)",
            )
        created.start()
        server = created
        pairing = pairs
    }

    /** Stops the server and forgets every stream link. Called by HelperService only. */
    @Synchronized
    internal fun stopServer() {
        server?.stop()
        server = null
        pairing = null
    }

    fun start(context: Context) {
        val intent = Intent(context, HelperService::class.java).setAction(HelperService.ACTION_START)
        ContextCompat.startForegroundService(context, intent)
    }

    fun stop(context: Context) {
        context.startService(Intent(context, HelperService::class.java).setAction(HelperService.ACTION_STOP))
    }

    /** Unpairs every TV, on or off. */
    @Synchronized
    fun forgetTvs(context: Context) {
        val live = pairing
        if (live != null) {
            live.forgetAll()
        } else {
            context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().remove(KEYS).apply()
        }
    }

    /**
     * What Settings shows, the same JSON as the Android TV app's helperState(): on or off, the
     * address and code to type on the TV, how many TVs are paired.
     */
    @Synchronized
    fun state(context: Context): JSONObject {
        val live = server
        val pairs = pairing
        val state = JSONObject().put("on", live != null)
        if (live != null && pairs != null) {
            state.put("address", homeAddress()?.hostAddress ?: JSONObject.NULL)
            state.put("port", live.port)
            state.put("code", pairs.code)
            state.put("paired", pairs.pairedCount())
        } else {
            val saved = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .getStringSet(KEYS, emptySet())
            state.put("paired", saved?.size ?: 0)
        }
        return state
    }

    /** The app's versionName (app.config.ts takes it from the LG app's appinfo.json). */
    @Suppress("DEPRECATION")
    private fun versionName(context: Context): String =
        try {
            context.packageManager.getPackageInfo(context.packageName, 0).versionName ?: "0"
        } catch (e: Exception) {
            "0"
        }

    private fun homeAddress(): java.net.InetAddress? =
        try {
            val pairs = NetworkInterface.getNetworkInterfaces()?.toList().orEmpty()
                .filter { it.isUp && !it.isLoopback }
                .flatMap { iface -> iface.inetAddresses.toList().map { iface.name to it } }
            AddressRules.homeAddress(pairs)
        } catch (e: Exception) {
            null
        }
}
