package de.feuerpfeil.crate;

import android.app.job.JobParameters;
import android.app.job.JobService;

/** Holt etwa alle 15 Minuten neue Mitteilungen ab (siehe Poller). Android startet den Dienst von selbst. */
public class PollJobService extends JobService {
    @Override
    public boolean onStartJob(final JobParameters params) {
        new Thread(() -> {
            int r = Poller.poll(getApplicationContext(), "job");
            // Kein Netz oder Server nicht erreichbar: Android versucht es früher nochmal
            jobFinished(params, r == Poller.FAILED);
        }).start();
        return true;
    }

    @Override
    public boolean onStopJob(JobParameters params) {
        return true;
    }
}
