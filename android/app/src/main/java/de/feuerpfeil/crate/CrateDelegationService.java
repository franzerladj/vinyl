package de.feuerpfeil.crate;

import android.app.PendingIntent;
import android.content.Intent;
import android.os.Build;
import android.os.Bundle;
import android.text.TextUtils;

import androidx.browser.trusted.TrustedWebActivityCallbackRemote;

import com.google.androidbrowserhelper.trusted.DelegationService;
import com.google.androidbrowserhelper.trusted.NotificationUtils;

/**
 * Mitteilungen der Webseite als Android-Mitteilungen, mit eigenem Umgang mit der Erlaubnis.
 *
 * Hintergrund: Chrome fragt die App nur einmal je Chrome-Start, ob sie Mitteilungen zeigen darf, und
 * merkt sich die Antwort. Die Bibliothek antwortet nach der ersten Ablehnung mit „gesperrt“. Dann hilft
 * auch späteres Erlauben in den Android-Einstellungen nicht, bis Chrome neu startet.
 * Deshalb antwortet Crate nie mit „gesperrt“, sondern mit „noch offen“: Die Webseite darf dann jederzeit
 * erneut fragen, und {@link CratePermissionActivity} führt durch Dialog oder Einstellungen.
 */
public class CrateDelegationService extends DelegationService {
    static final int ALLOW = 0;
    static final int BLOCK = 1;
    static final int ASK = 2;
    static final String KEY_STATUS = "permissionStatus";
    static final String KEY_CHANNEL = "notificationChannelName";

    @Override
    public Bundle onExtraCommand(String commandName, Bundle args, TrustedWebActivityCallbackRemote callback) {
        String channel = args == null ? null : args.getString(KEY_CHANNEL);
        if ("checkNotificationPermission".equals(commandName) && !TextUtils.isEmpty(channel)) {
            Bundle out = new Bundle();
            boolean enabled = NotificationUtils.areNotificationsEnabled(this, channel);
            // Vor Android 13 gibt es keinen Erlaubnis-Dialog: dort bleibt es bei erlaubt oder gesperrt
            int status = enabled ? ALLOW : Build.VERSION.SDK_INT >= 33 ? ASK : BLOCK;
            out.putInt(KEY_STATUS, status);
            out.putBoolean("success", true);
            return out;
        }
        if ("getNotificationPermissionRequestPendingIntent".equals(commandName) && !TextUtils.isEmpty(channel)) {
            Intent intent = new Intent(this, CratePermissionActivity.class);
            intent.putExtra(KEY_CHANNEL, channel);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            // Veränderbar, weil Chrome den Rückkanal (Messenger) nachträglich in den Intent legt
            int flags = PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 31 ? PendingIntent.FLAG_MUTABLE : 0);
            Bundle out = new Bundle();
            out.putParcelable("notificationPermissionRequestPendingIntent", PendingIntent.getActivity(this, 0, intent, flags));
            out.putBoolean("success", true);
            return out;
        }
        return super.onExtraCommand(commandName, args, callback);
    }
}
