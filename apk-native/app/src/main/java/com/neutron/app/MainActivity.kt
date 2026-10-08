package com.neutron.app

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Badge
import androidx.compose.material3.BadgedBox
import androidx.compose.material3.Icon
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.Menu
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.Settings
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.dp
import com.neutron.app.data.SessionStore
import com.neutron.app.ui.screens.AdminSendScreen
import com.neutron.app.ui.screens.AdminUsersScreen
import com.neutron.app.ui.screens.AuthScreen
import com.neutron.app.ui.screens.FriendsScreen
import com.neutron.app.ui.screens.HomeScreen
import com.neutron.app.ui.screens.LegacyWebScreen
import com.neutron.app.ui.screens.NotificationsScreen
import com.neutron.app.ui.screens.SettingsScreen
import com.neutron.app.ui.screens.SplashScreen
import com.neutron.app.ui.theme.NeutronTheme
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

class MainActivity : ComponentActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val store = SessionStore(applicationContext)
        // Dark theme preference (plain pref, not encrypted).
        val themePrefs = getSharedPreferences("neutron_ui", MODE_PRIVATE)
        setContent {
            var dark by remember {
                mutableStateOf(themePrefs.getBoolean("dark", false))
            }
            NeutronTheme(darkTheme = dark) {
                App(store,
                    darkTheme = dark,
                    onToggleTheme = {
                        dark = it
                        themePrefs.edit().putBoolean("dark", it).apply()
                    })
            }
        }
    }
}

private enum class Tab(val title: String, val icon: ImageVector) {
    Home("Home", Icons.Filled.Home),
    Notifications("Alerts", Icons.Filled.Notifications),
    Friends("Friends", Icons.Filled.Person),
    Web("Full app", Icons.Filled.Menu),
    Settings("Settings", Icons.Filled.Settings),
}

@Composable
private fun App(store: SessionStore, darkTheme: Boolean, onToggleTheme: (Boolean) -> Unit) {
    var authed by remember { mutableStateOf<Boolean?>(null) }
    var tab by remember { mutableStateOf(Tab.Home) }
    // Which legacy/admin sub-screen is open (null = tab content).
    var overlay by remember { mutableStateOf<String?>(null) }
    val user by store.user.collectAsState()
    val unread by store.unread.collectAsState()

    // Poll unread count while logged in.
    LaunchedEffect(authed) {
        if (authed == true) {
            while (true) {
                withContext(Dispatchers.IO) {
                    try { store.setUnread(store.api.unreadCount()) } catch (_: Exception) {}
                }
                kotlinx.coroutines.delay(45_000)
            }
        }
    }

    when (authed) {
        null -> SplashScreen(store, onDone = { authed = it })
        false -> AuthScreen(store, onAuthed = { authed = true })
        true -> {
            val ov = overlay
            if (ov != null) {
                OverlayScreen(ov, store, onBack = { overlay = null })
            } else {
                Scaffold(
                    bottomBar = {
                        NavigationBar {
                            Tab.values().forEach { t ->
                                NavigationBarItem(
                                    selected = tab == t,
                                    onClick = { tab = t },
                                    icon = {
                                        if (t == Tab.Notifications && unread > 0) {
                                            BadgedBox(badge = { Badge { Text("$unread") } }) {
                                                Icon(t.icon, t.title)
                                            }
                                        } else Icon(t.icon, t.title)
                                    },
                                    label = { Text(t.title) },
                                )
                            }
                        }
                    }
                ) { pad ->
                    androidx.compose.foundation.layout.Box(Modifier.padding(pad)) {
                        when (tab) {
                            Tab.Home -> HomeScreen(store, onOpenLegacy = { overlay = it })
                            Tab.Notifications -> NotificationsScreen(store)
                            Tab.Friends -> FriendsScreen(store)
                            Tab.Web -> LegacyWebScreen(
                                "https://neutron-agent.vercel.app/app", "Full NEUTRON app")
                            Tab.Settings -> SettingsScreen(store, darkTheme, onToggleTheme,
                                onLogout = { authed = false; overlay = null })
                        }
                    }
                }
            }
            // Keep the cached user fresh.
            LaunchedEffect(user?.id) { }
        }
    }
}

@Composable
private fun OverlayScreen(key: String, store: SessionStore, onBack: () -> Unit) {
    androidx.compose.foundation.layout.Column {
        androidx.compose.material3.TextButton(onClick = onBack,
            modifier = Modifier.padding(8.dp)) { Text("← Back") }
        when (key) {
            "admin_users" -> AdminUsersScreen(store)
            "admin_send" -> AdminSendScreen(store)
            else -> LegacyWebScreen(
                if (key.startsWith("http")) key else "https://neutron-agent.vercel.app$key",
                "NEUTRON")
        }
    }
}
