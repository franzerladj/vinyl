package de.feuerpfeil.crate;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/**
 * Der Wecker fürs Abholen der Mitteilungen (siehe Poller). Android weckt die App dafür auch im Ruhezustand kurz auf.
 * Außerdem: nach einem Neustart des Handys und nach einem Update der App werden die Wecker neu gestellt,
 * denn beides löscht sie.
 */
public class AlarmReceiver extends BroadcastReceiver {
    static final String ACTION_POLL = "de.feuerpfeil.crate.POLL";

    @Override
    public void onReceive(final Context context, Intent intent) {
        final Context c = context.getApplicationContext();
        if (Poller.token(c) == null) return;
        String action = intent == null ? null : intent.getAction();
        final String src = ACTION_POLL.equals(action) ? "alarm" : "boot";
        // Zuerst den nächsten Wecker stellen: schlägt der Abruf fehl, geht es trotzdem weiter
        Poller.schedule(c);
        final PendingResult pending = goAsync();
        new Thread(() -> {
            try {
                Poller.poll(c, src);
            } finally {
                pending.finish();
            }
        }).start();
    }
}
