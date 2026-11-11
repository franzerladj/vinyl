package de.feuerpfeil.crate;

import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;

import com.google.androidbrowserhelper.trusted.LauncherActivity;
import com.google.androidbrowserhelper.trusted.TwaLauncher;

/**
 * Startet Crate immer in Chrome, wenn Chrome installiert ist. Auf Samsung-Handys ist oft Samsung Internet
 * der Standard-Browser: dort kommen Mitteilungen der App nicht an, weil Samsung Internet die Erlaubnis
 * der App nicht an die Webseite weitergibt.
 */
public class CrateLauncherActivity extends LauncherActivity {
    private static final String CHROME = "com.android.chrome";

    @Override
    protected TwaLauncher createTwaLauncher() {
        return chromeAvailable() ? new TwaLauncher(this, CHROME) : super.createTwaLauncher();
    }

    private boolean chromeAvailable() {
        try {
            ApplicationInfo info = getPackageManager().getApplicationInfo(CHROME, 0);
            return info.enabled;
        } catch (PackageManager.NameNotFoundException e) {
            return false;
        }
    }
}
