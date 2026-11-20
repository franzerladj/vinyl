package de.feuerpfeil.crate;

import android.app.Activity;
import android.app.ProgressDialog;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.widget.Toast;

import androidx.core.content.FileProvider;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * crate://update: die App aktualisiert sich selbst, ohne Store.
 * 1. Neue Version von crate-8vf.pages.dev laden (rund 0,6 MB).
 * 2. Prüfen, dass sie wirklich neuer ist.
 * 3. Android fragt beim ersten Mal, ob Crate Apps installieren darf: dorthin führen, zurückkommen.
 * 4. Den Installations-Dialog von Android öffnen. Bestätigen muss man selbst, das lässt Android nicht anders zu.
 * Android installiert nur, wenn die Datei mit demselben Schlüssel signiert ist wie die installierte App:
 * eine fremde Datei kann sich so nicht einschleichen.
 */
public class UpdateActivity extends Activity {
    private static final int REQUEST_ALLOW = 7;
    private ProgressDialog progress;
    private File apk;
    private boolean finished;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        apk = new File(new File(getCacheDir(), "updates"), "crate.apk");
        progress = new ProgressDialog(this);
        progress.setMessage("Neue Version wird geladen …");
        progress.setProgressStyle(ProgressDialog.STYLE_HORIZONTAL);
        progress.setIndeterminate(true);
        progress.setCancelable(true);
        progress.setOnCancelListener(d -> done(null));
        progress.show();
        new Thread(this::download).start();
    }

    private void download() {
        HttpURLConnection conn = null;
        try {
            apk.getParentFile().mkdirs();
            conn = (HttpURLConnection) new URL(Poller.HOST + "/download/crate.apk?t=" + System.currentTimeMillis()).openConnection();
            conn.setConnectTimeout(15000);
            conn.setReadTimeout(30000);
            conn.setUseCaches(false);
            if (conn.getResponseCode() != 200) throw new Exception("HTTP " + conn.getResponseCode());
            final int total = conn.getContentLength();
            try (InputStream in = conn.getInputStream(); FileOutputStream out = new FileOutputStream(apk)) {
                byte[] buf = new byte[16384];
                int n;
                int got = 0;
                while ((n = in.read(buf)) > 0) {
                    out.write(buf, 0, n);
                    got += n;
                    final int now = got;
                    if (total > 0) runOnUiThread(() -> {
                        if (progress == null) return;
                        progress.setIndeterminate(false);
                        progress.setMax(total / 1024);
                        progress.setProgress(now / 1024);
                    });
                }
            }
            runOnUiThread(this::check);
        } catch (Exception e) {
            runOnUiThread(() -> done("Das Update konnte nicht geladen werden. Bitte später nochmal."));
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    private void check() {
        if (finished) return;
        try {
            PackageInfo next = getPackageManager().getPackageArchiveInfo(apk.getAbsolutePath(), 0);
            PackageInfo mine = getPackageManager().getPackageInfo(getPackageName(), 0);
            if (next == null || !getPackageName().equals(next.packageName)) {
                done("Die geladene Datei ist keine Crate-App.");
                return;
            }
            if (next.versionCode <= mine.versionCode) {
                done("Crate ist schon aktuell.");
                return;
            }
        } catch (Exception e) {
            done("Das Update konnte nicht geprüft werden.");
            return;
        }
        if (Build.VERSION.SDK_INT >= 26 && !getPackageManager().canRequestPackageInstalls()) {
            // Einmalig: Crate erlauben, sich selbst zu aktualisieren
            Toast.makeText(this, "Bitte Crate erlauben, sich zu aktualisieren, dann zurück.", Toast.LENGTH_LONG).show();
            try {
                startActivityForResult(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + getPackageName())), REQUEST_ALLOW);
                return;
            } catch (Exception e) {
                // Manche Geräte kennen die Seite nicht: der Installer fragt dann selbst
            }
        }
        install();
    }

    @Override
    protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        if (request != REQUEST_ALLOW) return;
        if (Build.VERSION.SDK_INT >= 26 && !getPackageManager().canRequestPackageInstalls()) {
            done("Ohne diese Erlaubnis kann sich Crate nicht selbst aktualisieren.");
            return;
        }
        install();
    }

    private void install() {
        try {
            Uri uri = Build.VERSION.SDK_INT >= 24 ? FileProvider.getUriForFile(this, getPackageName() + ".fileprovider", apk) : Uri.fromFile(publicCopy());
            Intent i = new Intent(Intent.ACTION_VIEW);
            i.setDataAndType(uri, "application/vnd.android.package-archive");
            i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(i);
            done(null);
        } catch (Exception e) {
            done("Der Installer ließ sich nicht öffnen.");
        }
    }

    /** Vor Android 7 liest der Installer nur Dateien, die für alle lesbar sind */
    private File publicCopy() throws Exception {
        File dir = getExternalFilesDir(null);
        if (dir == null) throw new Exception("kein Speicher");
        File out = new File(dir, "crate-update.apk");
        try (InputStream in = new java.io.FileInputStream(apk); FileOutputStream o = new FileOutputStream(out)) {
            byte[] buf = new byte[16384];
            int n;
            while ((n = in.read(buf)) > 0) o.write(buf, 0, n);
        }
        out.setReadable(true, false);
        return out;
    }

    private void done(String message) {
        if (finished) return;
        finished = true;
        if (message != null) Toast.makeText(this, message, Toast.LENGTH_LONG).show();
        try {
            if (progress != null) progress.dismiss();
        } catch (Exception e) {
            // Fenster schon weg
        }
        progress = null;
        finish();
    }

    @Override
    protected void onDestroy() {
        try {
            if (progress != null) progress.dismiss();
        } catch (Exception e) {
            // egal
        }
        progress = null;
        super.onDestroy();
    }
}
