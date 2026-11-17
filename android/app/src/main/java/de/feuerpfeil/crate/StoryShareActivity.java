package de.feuerpfeil.crate;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ComponentName;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.widget.Toast;

import androidx.core.content.FileProvider;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * Bild direkt in die Instagram-Story geben.
 * Die Webseite kann das nicht selbst: sie legt das Bild kurz auf dem Crate-Server ab und ruft
 * crate://story?id=... auf. Diese Aktivität holt es ab und öffnet den Story-Editor von Instagram.
 * Ohne Instagram erscheint das normale Teilen-Menü.
 */
public class StoryShareActivity extends Activity {
    private static final String HOST = "https://crate-8vf.pages.dev";
    private static final String INSTAGRAM = "com.instagram.android";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        Uri data = getIntent().getData();
        final String id = data == null ? null : data.getQueryParameter("id");
        if (id == null || !id.matches("[a-f0-9]{32}")) {
            finish();
            return;
        }
        new Thread(() -> {
            try {
                HttpURLConnection conn = (HttpURLConnection) new URL(HOST + "/api/story/" + id).openConnection();
                conn.setConnectTimeout(15000);
                conn.setReadTimeout(20000);
                if (conn.getResponseCode() != 200) throw new Exception("HTTP " + conn.getResponseCode());
                String type = conn.getContentType();
                final String mime = type != null && type.startsWith("image/png") ? "image/png" : "image/jpeg";
                File dir = new File(getCacheDir(), "share");
                dir.mkdirs();
                File file = new File(dir, "image/png".equals(mime) ? "story.png" : "story.jpg");
                try (InputStream in = conn.getInputStream(); FileOutputStream out = new FileOutputStream(file)) {
                    byte[] buf = new byte[16384];
                    int n;
                    while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
                }
                final Uri uri = FileProvider.getUriForFile(this, getPackageName() + ".fileprovider", file);
                runOnUiThread(() -> share(uri, mime));
            } catch (Exception e) {
                runOnUiThread(() -> {
                    Toast.makeText(this, "Das Bild konnte nicht geladen werden.", Toast.LENGTH_LONG).show();
                    finish();
                });
            }
        }).start();
    }

    private Intent send(Uri uri, String mime) {
        Intent i = new Intent(Intent.ACTION_SEND);
        i.setType(mime);
        i.putExtra(Intent.EXTRA_STREAM, uri);
        i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
        return i;
    }

    private boolean tryStart(Intent i) {
        try {
            startActivity(i);
            return true;
        } catch (ActivityNotFoundException | SecurityException e) {
            return false;
        }
    }

    private void share(Uri uri, String mime) {
        try {
            grantUriPermission(INSTAGRAM, uri, Intent.FLAG_GRANT_READ_URI_PERMISSION);
        } catch (Exception ignored) {
            // Instagram nicht installiert
        }
        // 1. Das Story-Ziel von Instagram (dasselbe, das im Teilen-Menü „Stories“ heißt): öffnet direkt den Editor
        Intent story = send(uri, mime);
        story.setComponent(new ComponentName(INSTAGRAM, "com.instagram.share.handleractivity.StoryShareHandlerActivity"));
        boolean ok = tryStart(story);
        // 2. Der offizielle Weg von Instagram für Stories
        if (!ok) {
            Intent add = new Intent("com.instagram.share.ADD_TO_STORY");
            add.setDataAndType(uri, mime);
            add.setPackage(INSTAGRAM);
            add.putExtra("source_application", getPackageName());
            add.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
            ok = tryStart(add);
        }
        // 3. Instagram allgemein (fragt dann Story, Beitrag oder Nachricht)
        if (!ok) {
            Intent insta = send(uri, mime);
            insta.setPackage(INSTAGRAM);
            ok = tryStart(insta);
        }
        // 4. Kein Instagram: normales Teilen-Menü
        if (!ok) tryStart(Intent.createChooser(send(uri, mime), "Teilen"));
        finish();
    }
}
