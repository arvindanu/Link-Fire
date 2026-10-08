package com.termorganworks.linkfire

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.net.wifi.WifiManager
import android.os.Build
import android.os.VibrationEffect
import android.os.Vibrator
import android.provider.Settings
import android.webkit.WebView
import android.webkit.JavascriptInterface
import org.json.JSONObject
import java.io.BufferedReader
import java.io.InputStreamReader
import java.io.OutputStream
import java.net.Inet4Address
import java.net.InetSocketAddress
import java.net.NetworkInterface
import java.net.ServerSocket
import java.net.Socket
import java.util.Collections
import java.util.concurrent.Executors

/**
 * Local-network transport for the game. Exposed to JS as `Android`.
 *
 * Protocol: one TCP connection, newline-delimited JSON, TCP_NODELAY.
 * Host  = ServerSocket on all interfaces (the hotspot interface included).
 * Guest = connects to the Wi-Fi gateway (= the host's hotspot IP), or a typed IP.
 *
 * Events go back to JS through `Net._ev(type, data)`:
 *   hosting(ips) | connected(ip) | msg(lines) | closed | error(text)
 */
class NetBridge(private val act: Activity, private val web: WebView) {

    private val writer = Executors.newSingleThreadExecutor()

    @Volatile private var sock: Socket? = null
    @Volatile private var out: OutputStream? = null
    @Volatile private var server: ServerSocket? = null
    @Volatile private var gen = 0 // bumped on every host/join/close so stale threads go quiet

    private val fallbackHosts = listOf(
        "192.168.43.1",  // Android hotspot (classic)
        "192.168.49.1",  // Wi-Fi Direct
        "172.20.10.1",   // iPhone hotspot
        "192.168.137.1", // Windows hotspot
        "192.168.0.1",
        "192.168.1.1"
    )

    private fun emit(type: String, data: String = "") {
        val js = "Net._ev(" + JSONObject.quote(type) + "," + JSONObject.quote(data) + ")"
        act.runOnUiThread { web.evaluateJavascript(js, null) }
    }

    // ---- host -------------------------------------------------------------

    @JavascriptInterface
    fun host(port: Int) {
        close()
        val g = ++gen
        Thread {
            try {
                val ss = ServerSocket()
                ss.reuseAddress = true
                ss.bind(InetSocketAddress(port))
                server = ss
                emit("hosting", ips())
                while (g == gen) {
                    val s = ss.accept()
                    if (g != gen || sock != null) { // only one opponent at a time
                        try { s.close() } catch (e: Exception) {}
                        continue
                    }
                    attach(s, g)
                }
            } catch (e: Exception) {
                if (g == gen) emit("error", e.message ?: "Could not open room")
            }
        }.start()
    }

    // ---- join -------------------------------------------------------------

    /** ip = "" means: auto-detect the host (Wi-Fi gateway + common hotspot addresses). */
    @JavascriptInterface
    fun join(ip: String, port: Int) {
        close()
        val g = ++gen
        Thread {
            val targets = ArrayList<String>()
            if (ip.isNotEmpty()) {
                targets.add(ip)
            } else {
                gateway()?.let { targets.add(it) }
                for (d in fallbackHosts) if (!targets.contains(d)) targets.add(d)
            }
            val end = System.currentTimeMillis() + 12000
            var last = ""
            while (g == gen && System.currentTimeMillis() < end) {
                for (t in targets) {
                    if (g != gen) return@Thread
                    try {
                        val s = Socket()
                        s.connect(InetSocketAddress(t, port), 1200)
                        if (g != gen) {
                            s.close()
                            return@Thread
                        }
                        attach(s, g)
                        return@Thread
                    } catch (e: Exception) {
                        last = e.message ?: ""
                    }
                }
                try { Thread.sleep(300) } catch (e: Exception) {}
            }
            if (g == gen) emit("error", "Could not reach the host. $last")
        }.start()
    }

    // ---- connection -------------------------------------------------------

    private fun attach(s: Socket, g: Int) {
        try {
            s.tcpNoDelay = true
            s.keepAlive = true
        } catch (e: Exception) {}
        sock = s
        out = s.getOutputStream()
        emit("connected", s.inetAddress?.hostAddress ?: "")
        Thread {
            try {
                val r = BufferedReader(InputStreamReader(s.getInputStream(), Charsets.UTF_8))
                while (g == gen) {
                    val first = r.readLine() ?: break
                    val sb = StringBuilder(first)
                    while (r.ready()) { // batch whatever already arrived into one JS call
                        val more = r.readLine() ?: break
                        sb.append('\n').append(more)
                    }
                    emit("msg", sb.toString())
                }
            } catch (e: Exception) {
            } finally {
                if (sock === s) {
                    sock = null
                    out = null
                }
                try { s.close() } catch (e: Exception) {}
                if (g == gen) emit("closed")
            }
        }.start()
    }

    @JavascriptInterface
    fun send(line: String) {
        writer.execute {
            try {
                val o = out
                if (o != null) {
                    o.write((line + "\n").toByteArray(Charsets.UTF_8))
                    o.flush()
                }
            } catch (e: Exception) {
                try { sock?.close() } catch (x: Exception) {}
            }
        }
    }

    /** Drop only the current opponent; a host keeps its room open. */
    @JavascriptInterface
    fun drop() {
        try { sock?.close() } catch (e: Exception) {}
    }

    /** Leave everything: close the socket and the room. */
    @JavascriptInterface
    fun close() {
        gen++
        try { sock?.close() } catch (e: Exception) {}
        try { server?.close() } catch (e: Exception) {}
        sock = null
        out = null
        server = null
    }

    // ---- helpers for the UI ----------------------------------------------

    @JavascriptInterface
    fun localIps(): String = ips()

    @JavascriptInterface
    fun gatewayIp(): String = gateway() ?: ""

    @JavascriptInterface
    fun openWifiSettings() {
        act.runOnUiThread {
            try { act.startActivity(Intent(Settings.ACTION_WIFI_SETTINGS)) } catch (e: Exception) {}
        }
    }

    @JavascriptInterface
    fun openHotspotSettings() {
        act.runOnUiThread {
            try {
                val i = Intent()
                i.setClassName("com.android.settings", "com.android.settings.TetherSettings")
                act.startActivity(i)
            } catch (e: Exception) {
                try { act.startActivity(Intent(Settings.ACTION_WIRELESS_SETTINGS)) } catch (x: Exception) {}
            }
        }
    }

    @Suppress("DEPRECATION")
    @JavascriptInterface
    fun vibrate(ms: Int) {
        try {
            val v = act.getSystemService(Context.VIBRATOR_SERVICE) as Vibrator
            if (Build.VERSION.SDK_INT >= 26) {
                v.vibrate(VibrationEffect.createOneShot(ms.toLong(), VibrationEffect.DEFAULT_AMPLITUDE))
            } else {
                v.vibrate(ms.toLong())
            }
        } catch (e: Exception) {}
    }

    private fun ips(): String {
        val l = ArrayList<String>()
        try {
            for (ni in Collections.list(NetworkInterface.getNetworkInterfaces())) {
                if (!ni.isUp || ni.isLoopback) continue
                for (a in Collections.list(ni.inetAddresses)) {
                    if (a is Inet4Address) l.add(a.hostAddress ?: "")
                }
            }
        } catch (e: Exception) {}
        return l.joinToString(",")
    }

    @Suppress("DEPRECATION")
    private fun gateway(): String? {
        return try {
            val wm = act.applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager
            val g = wm.dhcpInfo.gateway
            if (g == 0) null
            else String.format("%d.%d.%d.%d", g and 0xff, (g shr 8) and 0xff, (g shr 16) and 0xff, (g shr 24) and 0xff)
        } catch (e: Exception) {
            null
        }
    }
}
