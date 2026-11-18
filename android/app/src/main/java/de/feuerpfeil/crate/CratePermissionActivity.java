package de.feuerpfeil.crate;

import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Message;
import android.os.Messenger;
import android.os.RemoteException;
import android.provider.Settings;
import android.widget.Toast;

import com.google.androidbrowserhelper.trusted.NotificationUtils;

/**
 * Holt die Erlaubnis für Mitteilungen, wenn die Webseite danach fragt (Schalter in den Crate-Einstellungen).
 * 1. Ist schon alles erlaubt: sofort „erlaubt“ melden.
 * 2. Sonst den Android-Dialog zeigen.
 * 3. Zeigt Android keinen Dialog mehr (zweimal abgelehnt) oder ist die Kategorie aus: die
 *    Mitteilungs-Einstellungen der App öffnen und beim Zurückkommen nachsehen.
 * Die Antwort an Chrome ist „erlaubt“ oder „noch offen“, nie „gesperrt“ (siehe CrateDelegationService).
 */
public class CratePermissionActivity extends Activity {
    private static final String PERMISSION = "android.permission.POST_NOTIFICATIONS";
    private static final String STATE_SETTINGS = "inSettings";
    private String channel;
    private Messenger messenger;
    private boolean inSettings;
    private boolean answered;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        channel = getIntent().getStringExtra(CrateDelegationService.KEY_CHANNEL);
        messenger = getIntent().getParcelableExtra("messenger");
        inSettings = state != null && state.getBoolean(STATE_SETTINGS);
        if (channel == null || messenger == null) {
            finish();
            return;
        }
        if (inSettings) {
            // Android hat die Aktivität zwischendurch neu aufgebaut: beim Zurückkommen trotzdem antworten
            leftForSettings = true;
            return;
        }
        if (enabled()) {
            answer();
            return;
        }
        boolean granted = Build.VERSION.SDK_INT < 33 || checkSelfPermission(PERMISSION) == PackageManager.PERMISSION_GRANTED;
        if (!granted) requestPermissions(new String[] {PERMISSION}, 1);
        else openSettings();
    }

    private boolean enabled() {
        return NotificationUtils.areNotificationsEnabled(this, channel);
    }

    @Override
    public void onRequestPermissionsResult(int code, String[] permissions, int[] results) {
        if (enabled()) {
            answer();
            return;
        }
        // Abgelehnt, oder Android fragt nicht mehr: direkt zu den Einstellungen
        openSettings();
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
            answer();
        }
    }

    private boolean leftForSettings;

    @Override
    protected void onPause() {
        super.onPause();
        if (inSettings) leftForSettings = true;
    }

    @Override
    protected void onResume() {
        super.onResume();
        // Zurück aus den Einstellungen: nachsehen und antworten
        if (inSettings && leftForSettings) answer();
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        out.putBoolean(STATE_SETTINGS, inSettings);
    }

    private void answer() {
        if (answered) return;
        answered = true;
        Bundle data = new Bundle();
        data.putInt(CrateDelegationService.KEY_STATUS, enabled() ? CrateDelegationService.ALLOW : CrateDelegationService.ASK);
        Message message = Message.obtain();
        message.setData(data);
        try {
            messenger.send(message);
        } catch (RemoteException e) {
            // Chrome ist weg: nichts zu tun
        }
        finish();
    }

    @Override
    protected void onDestroy() {
        // Aktivität wird geschlossen, ohne dass geantwortet wurde: Chrome nicht hängen lassen
        if (isFinishing() && !answered && messenger != null) answer();
        super.onDestroy();
    }
}
