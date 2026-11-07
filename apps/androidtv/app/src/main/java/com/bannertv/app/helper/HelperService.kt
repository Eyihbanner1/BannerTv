package com.bannertv.app.helper

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.wifi.WifiManager
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import com.bannertv.app.MainActivity
import com.bannertv.app.R

/**
 * Keeps the stream helper running while the phone's screen is off, with a notification that
 * says so and a Stop button. Holds Wi-Fi and the CPU awake only while it runs.
 */
class HelperService : Service() {
    private var wifiLock: WifiManager.WifiLock? = null
    private var wakeLock: PowerManager.WakeLock? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            shutDown()
            return START_NOT_STICKY
        }
        // Foreground first: Android stops an app that starts a foreground service and is slow to say so.
        val type =
            if (Build.VERSION.SDK_INT >= 34) ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE else 0
        ServiceCompat.startForeground(this, NOTIFICATION_ID, notification(), type)
        try {
            StreamHelper.startServer(this)
        } catch (e: Exception) {
            shutDown()
            return START_NOT_STICKY
        }
        holdLocks()
        // Not restarted by the system: the viewer switches it on again from Settings.
        return START_NOT_STICKY
    }

    override fun onDestroy() {
        StreamHelper.stopServer()
        releaseLocks()
        super.onDestroy()
    }

    private fun shutDown() {
        StreamHelper.stopServer()
        releaseLocks()
        ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    private fun holdLocks() {
        if (wifiLock == null) {
            val wifi = applicationContext.getSystemService(Context.WIFI_SERVICE) as? WifiManager
            @Suppress("DEPRECATION")
            val mode =
                if (Build.VERSION.SDK_INT >= 29) {
                    WifiManager.WIFI_MODE_FULL_LOW_LATENCY
                } else {
                    WifiManager.WIFI_MODE_FULL_HIGH_PERF
                }
            wifiLock = wifi?.createWifiLock(mode, "BannerTV:streamHelper")?.apply {
                setReferenceCounted(false)
                acquire()
            }
        }
        if (wakeLock == null) {
            val power = getSystemService(Context.POWER_SERVICE) as? PowerManager
            wakeLock = power?.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "BannerTV:streamHelper")?.apply {
                setReferenceCounted(false)
                acquire()
            }
        }
    }

    private fun releaseLocks() {
        wifiLock?.let { if (it.isHeld) it.release() }
        wifiLock = null
        wakeLock?.let { if (it.isHeld) it.release() }
        wakeLock = null
    }

    private fun notification(): android.app.Notification {
        val manager = getSystemService(NotificationManager::class.java)
        if (Build.VERSION.SDK_INT >= 26 && manager?.getNotificationChannel(CHANNEL) == null) {
            val channel =
                NotificationChannel(CHANNEL, getString(R.string.helper_channel), NotificationManager.IMPORTANCE_LOW)
            manager?.createNotificationChannel(channel)
        }
        val open =
            PendingIntent.getActivity(
                this,
                0,
                Intent(this, MainActivity::class.java),
                PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
            )
        val stop =
            PendingIntent.getService(
                this,
                1,
                Intent(this, HelperService::class.java).setAction(ACTION_STOP),
                PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
            )
        return NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(R.drawable.ic_helper)
            .setContentTitle(getString(R.string.helper_on_title))
            .setContentText(getString(R.string.helper_on_text))
            .setContentIntent(open)
            .addAction(0, getString(R.string.helper_stop), stop)
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build()
    }

    companion object {
        const val ACTION_START = "com.bannertv.app.helper.START"
        const val ACTION_STOP = "com.bannertv.app.helper.STOP"
        private const val CHANNEL = "stream_helper"
        private const val NOTIFICATION_ID = 47020
    }
}
