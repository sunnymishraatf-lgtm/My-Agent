package com.neutron.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** Re-arms the periodic update check after a reboot. */
public class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent != null
                && Intent.ACTION_BOOT_COMPLETED.equals(intent.getAction())) {
            UpdateScheduler.schedule(context);
        }
    }
}
