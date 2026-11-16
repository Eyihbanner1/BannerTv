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
    private val onHelperCommand: (String) -> Unit,
    private val readHelperState: () -> String,
    private val onWatchNext: (String) -> Unit,
    private val onTakeLink: () -> String,
    private val onHash: (HashRequest) -> Unit,
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

    /** The stream helper for the LG, as JSON: on, address, port, code, paired. */
    @JavascriptInterface
    fun helperState(): String = readHelperState()

    /** Switches the stream helper: "start", "stop" or "forget" (unpair every TV). */
    @JavascriptInterface
    fun helper(command: String?) {
        if (command == null || command !in Protocol.HELPER_COMMANDS) return
        main.post { onHelperCommand(command) }
    }

    /** Replaces BannerTV's cards on the Watch Next row. Its own thread does the work, not this one. */
    @JavascriptInterface
    fun watchNext(cardsJson: String?) {
        if (cardsJson != null) onWatchNext(cardsJson)
    }

    /** The link the app was opened with, as JSON, once; "" when none waits. */
    @JavascriptInterface
    fun takeLink(): String = onTakeLink()

    /**
     * Reads the video's hash for the subtitles on its own thread; answers with a hash event, never
     * the link. This only hands the request on: nothing is read on the bridge thread.
     */
    @JavascriptInterface
    fun hash(requestJson: String?) {
        if (requestJson == null) return
        val request =
            try {
                JSONObject(requestJson)
            } catch (e: JSONException) {
                return
            }
        Protocol.hashRequest(
            id = request.optInt("id", 0),
            url = request.optString("url", ""),
            size = request.optLong("size", 0),
            asked = readHeaders(request.optJSONObject("headers")),
        )?.let(onHash)
    }

    /** The addon's request headers as the page sent them; Protocol keeps those that can be sent. */
    private fun readHeaders(json: JSONObject?): Map<String, String?> {
        if (json == null) return emptyMap()
        val headers = HashMap<String, String?>()
        val names = json.keys()
        while (names.hasNext()) {
            val name = names.next()
            headers[name] = json.opt(name) as? String
        }
        return headers
    }
}
