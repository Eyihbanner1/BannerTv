package com.bannertv.app

import android.annotation.SuppressLint
import android.content.ActivityNotFoundException
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.graphics.Bitmap
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.util.TypedValue
import android.view.Gravity
import android.view.KeyEvent
import android.view.ViewGroup
import android.view.WindowManager
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.TextView
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.media3.ui.PlayerView
import androidx.webkit.WebViewAssetLoader
import androidx.webkit.WebViewCompat
import com.bannertv.app.helper.StreamHelper
import org.json.JSONObject
import java.util.concurrent.atomic.AtomicReference

/**
 * The whole app: the bundled web build in a full-screen WebView, with the native player's video
 * underneath it. The web app drives everything through window.BannerAndroid.
 */
class MainActivity : ComponentActivity() {
    private var webView: WebView? = null
    private var player: PlayerController? = null
    private var events: JsEvents? = null
    private var watchNext: WatchNextPublisher? = null
    private var keyboardVisible = false

    // The link the app was opened with (a Watch Next card), until the page takes it. The page
    // takes it once someone is watching, which may be after a reload to ask "Who's watching?",
    // so it is held here rather than sent. The page reads it on the WebView's bridge thread.
    private val pendingLink = AtomicReference<OpenLink?>(null)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // Restored from saved state, or reopened from Recents, the activity is handed the intent
        // it was first started with again: that card was opened already.
        if (savedInstanceState == null && !launchedFromHistory(intent)) {
            pendingLink.set(DeepLink.parse(intent?.dataString))
        }

        val tooOld = webViewTooOld()
        if (tooOld != null) {
            showMessage(tooOld)
            return
        }
        // Constructing a WebView throws when the provider is missing or turned off.
        val web =
            try {
                WebView(this)
            } catch (e: Exception) {
                showMessage(R.string.webview_unavailable)
                return
            } catch (e: LinkageError) {
                showMessage(R.string.webview_unavailable)
                return
            }
        startApp(web)
    }

    /**
     * The message to show when the installed WebView is known to be too old (or, from API 26,
     * missing), else null. On API 25 the package lookup goes through reflection and can fail on
     * a perfectly good WebView, so there a missing answer is left to the constructor to judge.
     */
    private fun webViewTooOld(): Int? {
        val info =
            try {
                WebViewCompat.getCurrentWebViewPackage(this)
            } catch (e: Exception) {
                null
            }
        if (info == null) return if (Build.VERSION.SDK_INT >= 26) R.string.webview_too_old else null
        val major = Protocol.webViewMajor(info.versionName)
        return if (major != null && major < Protocol.MIN_WEBVIEW_MAJOR) R.string.webview_too_old else null
    }

    @SuppressLint("SetJavaScriptEnabled", "JavascriptInterface")
    private fun startApp(web: WebView) {
        val root = FrameLayout(this)
        root.setBackgroundColor(getColor(R.color.background))
        val playerView = PlayerView(this)
        root.addView(playerView, FrameLayout.LayoutParams(MATCH, MATCH))
        root.addView(web, FrameLayout.LayoutParams(MATCH, MATCH))
        setContentView(root)
        hideSystemBars()

        if ((applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE) != 0) {
            // The debug build can be inspected from chrome://inspect.
            WebView.setWebContentsDebuggingEnabled(true)
        }

        // Transparent, so the video drawn underneath shows wherever the page is transparent.
        web.setBackgroundColor(Color.TRANSPARENT)
        web.isFocusable = true
        web.isFocusableInTouchMode = true
        val settings = web.settings
        settings.javaScriptEnabled = true
        settings.domStorageEnabled = true
        settings.mediaPlaybackRequiresUserGesture = false
        // The page is https, but addons and streams can be plain http, on the LAN too.
        settings.mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
        settings.allowFileAccess = false
        settings.allowContentAccess = false

        val assetLoader =
            WebViewAssetLoader.Builder()
                .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
                .build()
        web.setWebViewClient(AppWebViewClient(assetLoader))
        web.setWebChromeClient(AppChromeClient())

        val js = JsEvents(web)
        val controller =
            PlayerController(
                context = this,
                view = playerView,
                userAgent = "BannerTV/${BuildConfig.VERSION_NAME} (Android)",
                emit = js::send,
                onPlayingChanged = ::keepScreenOn,
            )
        val app = applicationContext
        val publisher = WatchNextPublisher(this)
        val bridge =
            WebBridge(
                facts = DeviceFacts(this),
                onExit = { finish() },
                onOpenExternal = ::openExternal,
                onPlayerCommand = controller::handle,
                onHelperCommand = ::helperCommand,
                readHelperState = { StreamHelper.state(app).toString() },
                onWatchNext = publisher::publish,
                onTakeLink = { pendingLink.getAndSet(null)?.let(::linkJson) ?: "" },
            )
        web.addJavascriptInterface(bridge, Protocol.BRIDGE_NAME)
        webView = web
        player = controller
        events = js
        watchNext = publisher

        // Back never reaches the page, so it is always sent there; the page calls exit() at its root.
        onBackPressedDispatcher.addCallback(
            this,
            object : OnBackPressedCallback(true) {
                override fun handleOnBackPressed() {
                    events?.key("Back", false)
                }
            },
        )
        // Opened again from the launcher while running, as webOSRelaunch on the TV. Not on every
        // return to the front: the page asks "Who's watching?" again on relaunch. Opened from a
        // card instead, the page is told a link waits; it asks "Who's watching?" by the same rule
        // before it takes the link.
        addOnNewIntentListener { newIntent ->
            val link = DeepLink.parse(newIntent.dataString)
            if (link == null) {
                events?.relaunch()
            } else {
                pendingLink.set(link)
                events?.open()
            }
        }
        ViewCompat.setOnApplyWindowInsetsListener(root) { _, insets ->
            val visible = insets.isVisible(WindowInsetsCompat.Type.ime())
            if (visible != keyboardVisible) {
                keyboardVisible = visible
                events?.keyboard(visible)
            }
            insets
        }

        web.loadUrl(Protocol.START_URL)
        web.requestFocus()
    }

    /** A plain native message in place of the app, for devices whose WebView cannot run it. */
    private fun showMessage(text: Int) {
        val padding = (resources.displayMetrics.widthPixels * 0.1f).toInt()
        val view = TextView(this)
        view.setText(text)
        view.setTextColor(getColor(R.color.text))
        view.setBackgroundColor(getColor(R.color.background))
        view.setTextSize(TypedValue.COMPLEX_UNIT_SP, 28f)
        view.setLineSpacing(0f, 1.25f)
        view.gravity = Gravity.CENTER
        view.setPadding(padding, padding / 2, padding, padding / 2)
        setContentView(view)
        hideSystemBars()
    }

    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        val js = events
        val name = RemoteKeys.nameFor(event.keyCode)
        if (js != null && name != null) {
            // Both halves are consumed so the WebView never sees these keys as well.
            if (event.action == KeyEvent.ACTION_DOWN) js.key(name, event.repeatCount > 0)
            return true
        }
        return super.dispatchKeyEvent(event)
    }

    // The page is told it is hidden only when the app leaves the screen, as on the TV. onPause
    // also comes for a system panel over the app (sound settings, the Assistant), and a hidden
    // page pauses the film.
    override fun onStart() {
        super.onStart()
        webView?.onResume()
    }

    override fun onResume() {
        super.onResume()
        hideSystemBars()
        webView?.requestFocus()
    }

    override fun onStop() {
        webView?.onPause()
        super.onStop()
        player?.pauseForBackground()
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) {
            hideSystemBars()
            webView?.requestFocus()
        }
    }

    override fun onDestroy() {
        player?.destroy()
        player = null
        releaseWebView()
        watchNext?.close()
        watchNext = null
        super.onDestroy()
    }

    private fun launchedFromHistory(intent: Intent?): Boolean =
        intent != null && (intent.flags and Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY) != 0

    /** A link as the page reads it from takeLink(). */
    private fun linkJson(link: OpenLink): String {
        val json = JSONObject().put("type", link.type).put("meta", link.meta)
        if (link.video != null) json.put("video", link.video)
        return json.toString()
    }

    private fun keepScreenOn(playing: Boolean) {
        if (playing) {
            window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        } else {
            window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        }
    }

    /** The stream helper keeps running after the app closes, until stopped here or from its notification. */
    private fun helperCommand(command: String) {
        when (command) {
            "start" -> {
                if (Build.VERSION.SDK_INT >= 33) {
                    // The helper's notification (with its Stop button) needs this from Android 13.
                    requestPermissions(arrayOf(android.Manifest.permission.POST_NOTIFICATIONS), 0)
                }
                StreamHelper.start(this)
            }
            "stop" -> StreamHelper.stop(this)
            "forget" -> StreamHelper.forgetTvs(this)
        }
    }

    private fun openExternal(uri: Uri) {
        val intent = Intent(Intent.ACTION_VIEW, uri).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        try {
            startActivity(intent)
        } catch (e: ActivityNotFoundException) {
            // Nothing on the device opens it (a TV without YouTube, say): do nothing.
        } catch (e: SecurityException) {
            // The only app that matches is not exported to us.
        }
    }

    /** Full screen on phones; harmless on TVs, which have no system bars to hide. */
    private fun hideSystemBars() {
        WindowCompat.setDecorFitsSystemWindows(window, false)
        val controller = WindowInsetsControllerCompat(window, window.decorView)
        controller.systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        controller.hide(WindowInsetsCompat.Type.systemBars())
    }

    private fun releaseWebView() {
        events?.close()
        events = null
        val web = webView ?: return
        webView = null
        (web.parent as? ViewGroup)?.removeView(web)
        web.destroy()
    }

    private inner class AppWebViewClient(private val assets: WebViewAssetLoader) : WebViewClient() {
        override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
            assets.shouldInterceptRequest(request.url)

        // The app never navigates away from its own origin.
        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean =
            !Protocol.isAppUrl(request.url.toString())

        override fun onPageFinished(view: WebView, url: String?) {
            view.requestFocus()
        }

        // A crashed or killed renderer takes the page with it. Start the activity again rather
        // than let WebView take the whole app down.
        override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
            releaseWebView()
            recreate()
            return true
        }
    }

    private class AppChromeClient : WebChromeClient() {
        // Without a poster, Android WebView paints a grey play button over the native video.
        private val poster: Bitmap =
            Bitmap.createBitmap(1, 1, Bitmap.Config.ARGB_8888).apply { eraseColor(Color.TRANSPARENT) }

        override fun getDefaultVideoPoster(): Bitmap = poster
    }

    private companion object {
        const val MATCH = ViewGroup.LayoutParams.MATCH_PARENT
    }
}
