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
 * crate://push?t=<Kennwort>: Mitteilungen in der App selbst einschalten (aufgerufen vom Schalter in den Crate-Einstellungen).
 * 1. Kennwort merken, mit dem die App beim Server abholt.
 * 2. Erlaubnis von Android holen: Dialog, und wenn Android nicht mehr fragt, die Mitteilungs-Einstellungen der App.
 * 3. Einmal fragen, ob Crate vom Akku-Sparen ausgenommen wird. Ohne das schiebt Android das Abholen stundenlang auf,
 *    weil Crate sichtbar in Chrome läuft und die App selbst als unbenutzt gilt.
 * 4. Wecker stellen und gleich einmal abholen. Dabei erfährt der Server, ob Android es erlaubt,
 *    und die Webseite zeigt den Schalter entsprechend.
 * crate://push?poll=1: nur sofort abholen (Test-Mitteilung), mit Rückmeldung, falls es nicht klappt.
 *
 * Abgeholt wird, solange diese Aktivität offen ist: einem Prozess ohne sichtbare Aktivität sperrt Android
 * unter Umständen sofort das Netz, dann käme der Abruf nie an.
 */
public class NativePushActivity extends Activity {
    private static final String PERMISSION = "android.permission.POST_NOTIFICATIONS";
    private static final String STATE_STEP = "step";
    private static final int STEP_START = 0, STEP_SETTINGS = 1, STEP_BATTERY = 2;
    private static final int REQUEST_BATTERY = 3;
    private int step = STEP_START;
    private boolean leftForSettings;
    private boolean done;
    private boolean pollOnly;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        Uri data = getIntent().getData();
        String token = data == null ? null : data.getQueryParameter("t");
        if (token == null) {
            // Nur abholen
            pollOnly = true;
            finishUp();
            return;
        }
        if (!token.matches("[a-f0-9]{64}")) {
            done = true;
            finish();
            return;
        }
        Poller.setToken(this, token);
        Poller.ensureChannel(this);
        step = state == null ? STEP_START : state.getInt(STATE_STEP, STEP_START);
        if (step == STEP_SETTINGS) {
            // Android hat die Aktivität zwischendurch neu aufgebaut: beim Zurückkommen weitermachen
            leftForSettings = true;
            return;
        }
        if (step == STEP_BATTERY) return; // die Antwort kommt über onActivityResult
        if (Poller.allowed(this)) {
            askBattery();
            return;
        }
        boolean granted = Build.VERSION.SDK_INT < 33 || checkSelfPermission(PERMISSION) == PackageManager.PERMISSION_GRANTED;
        if (!granted) requestPermissions(new String[] {PERMISSION}, 1);
        else openSettings();
    }

    @Override
    public void onRequestPermissionsResult(int code, String[] permissions, int[] results) {
        if (Poller.allowed(this)) {
            askBattery();
            return;
        }
        // Zum ersten Mal abgelehnt: so melden. Fragt Android gar nicht mehr, führen die Einstellungen weiter.
        if (Build.VERSION.SDK_INT >= 23 && shouldShowRequestPermissionRationale(PERMISSION)) finishUp();
        else openSettings();
    }

    private void openSettings() {
        step = STEP_SETTINGS;
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

    /** Einmal fragen, ob Crate im Hintergrund laufen darf (Ausnahme vom Akku-Sparen). Danach geht es in jedem Fall weiter. */
    private void askBattery() {
        if (Poller.exempt(this) || Build.VERSION.SDK_INT < 23) {
            finishUp();
            return;
        }
        step = STEP_BATTERY;
        try {
            startActivityForResult(new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:" + getPackageName())), REQUEST_BATTERY);
        } catch (Exception e) {
            finishUp();
        }
    }

    @Override
    protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        if (request == REQUEST_BATTERY) finishUp();
    }

    @Override
    protected void onPause() {
        super.onPause();
        if (step == STEP_SETTINGS) leftForSettings = true;
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (step == STEP_SETTINGS && leftForSettings) {
            leftForSettings = false;
            if (Poller.allowed(this)) askBattery();
            else finishUp();
        }
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        out.putInt(STATE_STEP, step);
    }

    /** Wecker stellen, abholen und erst dann schließen */
    private void finishUp() {
        if (done) return;
        done = true;
        Poller.schedule(this);
        final String src = pollOnly ? "now" : "link";
        new Thread(() -> {
            final int r = Poller.poll(getApplicationContext(), src);
            runOnUiThread(() -> {
                String msg = null;
                if (r == Poller.NO_TOKEN) msg = "Crate ist hier noch nicht verbunden. Bitte den Schalter für Mitteilungen einmal aus- und wieder einschalten.";
                else if (r == Poller.GONE) msg = "Dieses Gerät wurde abgemeldet. Bitte Mitteilungen in Crate neu einschalten.";
                else if (r == Poller.FAILED) msg = "Crate hat den Server gerade nicht erreicht. Bitte gleich nochmal.";
                else if (r == Poller.NOT_ALLOWED && pollOnly) msg = "Android lässt Crate gerade keine Mitteilungen zeigen.";
                if (msg != null) Toast.makeText(this, msg, Toast.LENGTH_LONG).show();
                finish();
            });
        }).start();
    }
}
