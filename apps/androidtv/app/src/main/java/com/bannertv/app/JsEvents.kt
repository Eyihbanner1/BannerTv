package com.bannertv.app

import android.os.Handler
import android.os.Looper
import android.webkit.WebView
import org.json.JSONObject

/**
 * Sends native events to the page through window.__bannerAndroid.event(object). Events sent
 * before the page has defined it are dropped by the guard in the script.
 */
class JsEvents(private val webView: WebView) {
    private val main = Handler(Looper.getMainLooper())

    @Volatile
    private var closed = false

    fun send(event: JSONObject) {
        // JSONObject output is a valid JavaScript object literal, so it goes in as it is.
        val script = Protocol.eventScript(event.toString())
        if (Looper.myLooper() == Looper.getMainLooper()) {
            evaluate(script)
        } else {
            main.post { evaluate(script) }
        }
    }

    fun key(name: String, repeat: Boolean) {
        send(JSONObject().put("type", "key").put("key", name).put("repeat", repeat))
    }

    fun relaunch() {
        send(JSONObject().put("type", "relaunch"))
    }

    /** A link came in while running; the page takes it with takeLink(). */
    fun open() {
        send(JSONObject().put("type", "open"))
    }

    fun keyboard(visible: Boolean) {
        send(JSONObject().put("type", "keyboard").put("visible", visible))
    }

    /** Stops sending: the WebView is about to be destroyed. */
    fun close() {
        closed = true
        main.removeCallbacksAndMessages(null)
    }

    private fun evaluate(script: String) {
        if (!closed) webView.evaluateJavascript(script, null)
    }
}
