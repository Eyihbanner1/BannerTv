package com.bannertv.app

import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.webkit.JavascriptInterface
import org.json.JSONException
import org.json.JSONObject

/**
 * window.BannerAndroid. WebView calls these on its JavaBridge thread, so anything that touches
 * the activity, views or player is posted to the main thread. Arguments are nullable because
 * the page can pass null or undefined.
 */
class WebBridge(
    private val facts: DeviceFacts,
    private val onExit: () -> Unit,
    private val onOpenExternal: (Uri) -> Unit,
    private val onPlayerCommand: (JSONObject) -> Unit,
    private val onWatchNext: (String) -> Unit,
    private val onTakeLink: () -> String,
) {
    private val main = Handler(Looper.getMainLooper())

    @JavascriptInterface
    fun protocol(): String = Protocol.VERSION

    @JavascriptInterface
    fun hostInfo(): String = facts.hostInfo().toString()

    @JavascriptInterface
    fun capabilities(): String = facts.capabilities().toString()

    @JavascriptInterface
    fun exit() {
        main.post { onExit() }
    }

    @JavascriptInterface
    fun openExternal(url: String?) {
        if (url == null || !Protocol.isExternalUrlAllowed(url)) return
        val uri = Uri.parse(url.trim())
        main.post { onOpenExternal(uri) }
    }

    @JavascriptInterface
    fun player(commandJson: String?) {
        if (commandJson == null) return
        val command =
            try {
                JSONObject(commandJson)
            } catch (e: JSONException) {
                return
            }
        main.post { onPlayerCommand(command) }
    }

    /** Replaces BannerTV's cards on the Watch Next row. Its own thread does the work, not this one. */
    @JavascriptInterface
    fun watchNext(cardsJson: String?) {
        if (cardsJson != null) onWatchNext(cardsJson)
    }

    /** The link the app was opened with, as JSON, once; "" when none waits. */
    @JavascriptInterface
    fun takeLink(): String = onTakeLink()
}
