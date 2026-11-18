package de.feuerpfeil.crate;

import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.widget.Toast;

/**
 * crate://push?t=<Kennwort>: Mitteilungen in der App einschalten (aufgerufen vom Schalter in den Crate-Einstellungen).
 * 1. Kennwort merken, mit dem die App beim Server abholt.
 * 2. Erlaubnis von Android holen: Dialog, und wenn Android nicht mehr fragt, die Mitteilungs-Einstellungen der App.
 * 3. Regelmäßiges Abholen einplanen und gleich einmal abholen. Dabei erfährt der Server, ob Android es erlaubt,
 *    und die Webseite zeigt den Schalter entsprechend.
 * crate://push?poll=1: nur sofort abholen (Test-Mitteilung).
 */
public class NativePushActivity extends Activity {
    private static final String PERMISSION = "android.permission.POST_NOTIFICATIONS";
    private static final String STATE_SETTINGS = "inSettings";
    private boolean inSettings;
    private boolean leftForSettings;
    private boolean done;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        Uri data = getIntent().getData();
        String token = data == null ? null : data.getQueryParameter("t");
        if (token == null) {
            // Nur abholen
            Poller.pollAsync(this);
            done = true;
            finish();
            return;
        }
        if (!token.matches("[a-f0-9]{64}")) {
            done = true;
            finish();
            return;
        }
        Poller.setToken(this, token);
        Poller.ensureChannel(this);
        inSettings = state != null && state.getBoolean(STATE_SETTINGS);
        if (inSettings) {
            // Android hat die Aktivität zwischendurch neu aufgebaut: beim Zurückkommen fertig machen
            leftForSettings = true;
            return;
        }
        if (Poller.allowed(this)) {
            finishUp();
            return;
        }
        boolean granted = Build.VERSION.SDK_INT < 33 || checkSelfPermission(PERMISSION) == PackageManager.PERMISSION_GRANTED;
        if (!granted) requestPermissions(new String[] {PERMISSION}, 1);
        else openSettings();
    }

    @Override
    public void onRequestPermissionsResult(int code, String[] permissions, int[] results) {
        if (Poller.allowed(this)) {
            finishUp();
            return;
        }
        // Zum ersten Mal abgelehnt: so melden. Fragt Android gar nicht mehr, führen die Einstellungen weiter.
        if (Build.VERSION.SDK_INT >= 23 && shouldShowRequestPermissionRationale(PERMISSION)) finishUp();
        else openSettings();
    }

    private void openSettings() {
        inSettings = true;
        Toast.makeText(this, "Bitte Mitteilungen für Crate einschalten, dann zurück.", Toast.LENGTH_LONG).show();
        Intent intent;
        if (Build.VERSION.SDK_INT >= 26) {
            intent = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS);
            intent.putExtra(Settings.EXTRA_APP_PACKAGE, getPackageName());
        } else {
            intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
            intent.setData(Uri.parse("package:" + getPackageName()));
        }
        try {
            startActivity(intent);
        } catch (Exception e) {
            finishUp();
        }
    }

    @Override
    protected void onPause() {
        super.onPause();
        if (inSettings) leftForSettings = true;
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (inSettings && leftForSettings) finishUp();
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        out.putBoolean(STATE_SETTINGS, inSettings);
    }

    private void finishUp() {
        if (done) return;
        done = true;
        Poller.schedule(this);
        // Meldet dem Server den Stand und zeigt die Begrüßung, wenn erlaubt
        Poller.pollAsync(this);
        finish();
    }

    @Override
    protected void onDestroy() {
        // Geschlossen, ohne fertig zu werden (z. B. Zurück im Dialog): Stand trotzdem melden
        if (isFinishing() && !done && Poller.token(this) != null) {
            Poller.schedule(this);
            Poller.pollAsync(this);
        }
        super.onDestroy();
    }
}
