package com.termorganworks.linkfire

import android.annotation.SuppressLint
import android.app.Activity
import android.content.Context
import android.graphics.Color
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.os.Build
import android.os.Bundle
import android.view.View
import android.view.WindowManager
import android.webkit.WebView

/**
 * Full-screen landscape WebView that runs the HTML5 game from assets/.
 * All multiplayer sockets live in [NetBridge] (exposed to JS as `Android`).
 */
class MainActivity : Activity() {

    private lateinit var web: WebView
    private lateinit var bridge: NetBridge
    private var cm: ConnectivityManager? = null
    private var wifiCb: ConnectivityManager.NetworkCallback? = null

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        if (Build.VERSION.SDK_INT >= 28) {
            val lp = window.attributes
            lp.layoutInDisplayCutoutMode =
                WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
            window.attributes = lp
        }

        web = WebView(this)
        web.setBackgroundColor(Color.BLACK)
        web.overScrollMode = View.OVER_SCROLL_NEVER
        web.settings.javaScriptEnabled = true
        web.settings.domStorageEnabled = true
        web.settings.mediaPlaybackRequiresUserGesture = false
        web.settings.allowFileAccess = true

        bridge = NetBridge(this, web)
        web.addJavascriptInterface(bridge, "Android")
        setContentView(web)
        web.loadUrl("file:///android_asset/index.html")

        bindToWifi()
        hideSystemUi()
    }

    /**
     * A hotspot Wi-Fi has no internet, so Android may keep routing app traffic over
     * mobile data. Binding the process to the Wi-Fi network makes sockets to the
     * host's 192.168.x.x address actually use Wi-Fi.
     */
    private fun bindToWifi() {
        try {
            val c = getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
            cm = c
            val req = NetworkRequest.Builder()
                .addTransportType(NetworkCapabilities.TRANSPORT_WIFI)
                .build()
            val cb = object : ConnectivityManager.NetworkCallback() {
                override fun onAvailable(network: Network) {
                    c.bindProcessToNetwork(network)
                }

                override fun onLost(network: Network) {
                    c.bindProcessToNetwork(null)
                }
            }
            wifiCb = cb
            c.requestNetwork(req, cb)
        } catch (e: Exception) {
            // Not fatal: the game still works when the default route is already Wi-Fi.
        }
    }

    @Suppress("DEPRECATION")
    private fun hideSystemUi() {
        window.decorView.systemUiVisibility = (View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                or View.SYSTEM_UI_FLAG_FULLSCREEN
                or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                or View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                or View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION)
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) hideSystemUi()
    }

    // The game decides what "back" means (leave match, previous menu...).
    // It answers "true" when it handled the press, otherwise we close the app.
    @Suppress("DEPRECATION", "OVERRIDE_DEPRECATION")
    override fun onBackPressed() {
        web.evaluateJavascript("(window.Game&&Game.onBack?Game.onBack():false)") { r ->
            if (r != "true") finish()
        }
    }

    override fun onDestroy() {
        bridge.close()
        try {
            wifiCb?.let { cm?.unregisterNetworkCallback(it) }
            cm?.bindProcessToNetwork(null)
        } catch (e: Exception) {
        }
        web.destroy()
        super.onDestroy()
    }
}
