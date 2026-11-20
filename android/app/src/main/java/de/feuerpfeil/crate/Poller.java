package de.feuerpfeil.crate;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.job.JobInfo;
import android.app.job.JobScheduler;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Build;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;

/**
 * Mitteilungen ohne Browser: die App holt sie selbst beim Crate-Server ab und zeigt sie als
 * Android-Mitteilungen. Chrome und seine Erlaubnis spielen dabei keine Rolle mehr.
 *
 * Ablauf: Die Webseite lässt sich vom Server ein Kennwort für dieses Gerät geben und reicht es über
 * crate://push?t=... an die App (NativePushActivity). Ab dann fragt die App etwa alle 15 Minuten
 * (JobScheduler, überlebt Neustarts) und bei jedem Öffnen unter /api/push/native/poll nach.
 */
final class Poller {
    static final String HOST = "https://crate-8vf.pages.dev";
    static final String CHANNEL = "crate_news";
    static final int JOB_ID = 4711;
    private static final String PREFS = "crate_push";
    private static final String KEY_TOKEN = "token";
    private static final String KEY_UPDATE_TOLD = "updateTold";
    private static final long PERIOD_MS = 15 * 60 * 1000L;
    private static final Object LOCK = new Object();

    private Poller() {}

    static SharedPreferences prefs(Context c) {
        return c.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    static String token(Context c) {
        return prefs(c).getString(KEY_TOKEN, null);
    }

    static void setToken(Context c, String token) {
        if (token == null) prefs(c).edit().remove(KEY_TOKEN).apply();
        else prefs(c).edit().putString(KEY_TOKEN, token).apply();
    }

    /** Kategorie „Neuigkeiten“ anlegen (ab Android 8 Pflicht) */
    static void ensureChannel(Context c) {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null || nm.getNotificationChannel(CHANNEL) != null) return;
        NotificationChannel ch = new NotificationChannel(CHANNEL, "Neuigkeiten", NotificationManager.IMPORTANCE_HIGH);
        ch.setDescription("Wantlist, Freunde, Gigs");
        nm.createNotificationChannel(ch);
    }

    /** Darf Crate gerade Mitteilungen zeigen (App-Schalter und Kategorie)? */
    static boolean allowed(Context c) {
        if (!NotificationManagerCompat.from(c).areNotificationsEnabled()) return false;
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
            NotificationChannel ch = nm == null ? null : nm.getNotificationChannel(CHANNEL);
            if (ch != null && ch.getImportance() == NotificationManager.IMPORTANCE_NONE) return false;
        }
        return true;
    }

    /** Regelmäßiges Abholen einplanen (nur wenn es nicht schon läuft, sonst begänne die Frist jedes Mal neu) */
    static void schedule(Context c) {
        JobScheduler js = (JobScheduler) c.getSystemService(Context.JOB_SCHEDULER_SERVICE);
        if (js == null) return;
        for (JobInfo j : js.getAllPendingJobs()) if (j.getId() == JOB_ID) return;
        JobInfo.Builder b = new JobInfo.Builder(JOB_ID, new ComponentName(c, PollJobService.class))
                .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
                .setPeriodic(PERIOD_MS)
                .setPersisted(true);
        try {
            js.schedule(b.build());
        } catch (Exception e) {
            // Ohne Erlaubnis für den Neustart: wenigstens bis dahin abholen
            try {
                js.schedule(b.setPersisted(false).build());
            } catch (Exception ignored) {
                // dann nur beim Öffnen der App
            }
        }
    }

    static void cancel(Context c) {
        JobScheduler js = (JobScheduler) c.getSystemService(Context.JOB_SCHEDULER_SERVICE);
        if (js != null) js.cancel(JOB_ID);
    }

    static void pollAsync(final Context context) {
        final Context c = context.getApplicationContext();
        new Thread(() -> poll(c)).start();
    }

    /** Neue Mitteilungen abholen und zeigen. false = hat nicht geklappt (später nochmal). */
    static boolean poll(Context c) {
        synchronized (LOCK) {
            String token = token(c);
            if (token == null) {
                cancel(c);
                return true;
            }
            ensureChannel(c);
            boolean ok = allowed(c);
            HttpURLConnection conn = null;
            try {
                String url = HOST + "/api/push/native/poll?t=" + URLEncoder.encode(token, "UTF-8") + "&ok=" + (ok ? "1" : "0") + "&v=" + versionCode(c);
                conn = (HttpURLConnection) new URL(url).openConnection();
                conn.setConnectTimeout(15000);
                conn.setReadTimeout(20000);
                conn.setRequestProperty("Accept", "application/json");
                int status = conn.getResponseCode();
                if (status == 410) {
                    // Auf der Webseite ausgeschaltet oder Konto gelöscht: aufhören
                    setToken(c, null);
                    cancel(c);
                    return true;
                }
                if (status != 200) return false;
                JSONObject json = new JSONObject(read(conn.getInputStream()));
                JSONArray list = json.optJSONArray("messages");
                if (list != null && ok) for (int i = 0; i < list.length(); i++) show(c, list.getJSONObject(i));
                // Gibt es eine neuere App? Einmal je Version Bescheid geben, Antippen startet das Update
                int latest = json.optInt("apk", 0);
                if (ok && latest > versionCode(c) && prefs(c).getInt(KEY_UPDATE_TOLD, 0) < latest) {
                    prefs(c).edit().putInt(KEY_UPDATE_TOLD, latest).apply();
                    showUpdate(c, json.optString("apkName", ""));
                }
                return true;
            } catch (Exception e) {
                return false;
            } finally {
                if (conn != null) conn.disconnect();
            }
        }
    }

    private static int versionCode(Context c) {
        try {
            return c.getPackageManager().getPackageInfo(c.getPackageName(), 0).versionCode;
        } catch (Exception e) {
            return 0;
        }
    }

    private static String read(InputStream in) throws Exception {
        try (InputStream s = in; ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            byte[] buf = new byte[8192];
            int n;
            while ((n = s.read(buf)) > 0) out.write(buf, 0, n);
            return out.toString("UTF-8");
        }
    }

    private static void showUpdate(Context c, String name) {
        Intent open = new Intent(c, UpdateActivity.class);
        open.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 23 ? PendingIntent.FLAG_IMMUTABLE : 0);
        PendingIntent tap = PendingIntent.getActivity(c, 4712, open, flags);
        String body = (name.isEmpty() ? "Eine neue Version" : "Version " + name) + " ist da. Tippen zum Aktualisieren, deine Daten bleiben.";
        Notification n = new NotificationCompat.Builder(c, CHANNEL)
                .setSmallIcon(R.drawable.ic_notification)
                .setContentTitle("Crate aktualisieren")
                .setContentText(body)
                .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
                .setContentIntent(tap)
                .setAutoCancel(true)
                .setPriority(NotificationCompat.PRIORITY_DEFAULT)
                .build();
        NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;
        try {
            nm.notify("update", 2, n);
        } catch (SecurityException e) {
            // Erlaubnis entzogen: der Hinweis steht dann nur in der App
        }
    }

    private static void show(Context c, JSONObject m) {
        String title = m.optString("title", "Crate");
        String body = m.optString("body", "");
        String path = m.optString("url", "/");
        String tag = m.optString("tag", "");
        if (tag.isEmpty()) tag = title + "|" + body;
        if (!path.startsWith("/") || path.startsWith("//")) path = "/";
        // Antippen öffnet Crate an der passenden Stelle
        Intent open = new Intent(Intent.ACTION_VIEW, Uri.parse(HOST + path), c, CrateLauncherActivity.class);
        open.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 23 ? PendingIntent.FLAG_IMMUTABLE : 0);
        PendingIntent tap = PendingIntent.getActivity(c, tag.hashCode(), open, flags);
        Notification n = new NotificationCompat.Builder(c, CHANNEL)
                .setSmallIcon(R.drawable.ic_notification)
                .setContentTitle(title)
                .setContentText(body)
                .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
                .setContentIntent(tap)
                .setAutoCancel(true)
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setDefaults(NotificationCompat.DEFAULT_ALL)
                .build();
        NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;
        try {
            nm.notify(tag, 1, n);
        } catch (SecurityException e) {
            // Erlaubnis zwischendurch entzogen: beim nächsten Abholen meldet die App das dem Server
        }
    }
}
