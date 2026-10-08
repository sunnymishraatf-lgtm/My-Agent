package com.neutron.app

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Badge
import androidx.compose.material3.BadgedBox
import androidx.compose.material3.Card
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Build
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.Menu
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Send
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.neutron.app.data.SessionStore
import com.neutron.app.ui.screens.AdminSendScreen
import com.neutron.app.ui.screens.AdminUsersScreen
import com.neutron.app.ui.screens.AgentScreen
import com.neutron.app.ui.screens.AiKeysScreen
import com.neutron.app.ui.screens.AuthScreen
import com.neutron.app.ui.screens.ChatScreen
import com.neutron.app.ui.screens.FriendsScreen
import com.neutron.app.ui.screens.HomeScreen
import com.neutron.app.ui.screens.MusicScreen
import com.neutron.app.ui.screens.NotificationsScreen
import com.neutron.app.ui.screens.SettingsScreen
import com.neutron.app.ui.screens.SplashScreen
import com.neutron.app.ui.screens.TerminalScreen
import com.neutron.app.ui.theme.NeutronTheme
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext

class MainActivity : ComponentActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val store = SessionStore(applicationContext)
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
    Chat("Chat", Icons.Filled.Send),
    Agent("Agent", Icons.Filled.Build),
    Music("Music", Icons.Filled.PlayArrow),
    More("More", Icons.Filled.Menu),
}

/** Sub-screens opened from Home quick actions or the More menu. */
private sealed class Overlay(val key: String) {
    data object Notifications : Overlay("notifications")
    data object Friends : Overlay("friends")
    data object Terminal : Overlay("terminal")
    data object AiKeys : Overlay("ai_keys")
    data object Settings : Overlay("settings")
    data object AdminUsers : Overlay("admin_users")
    data object AdminSend : Overlay("admin_send")
}

@Composable
private fun App(store: SessionStore, darkTheme: Boolean, onToggleTheme: (Boolean) -> Unit) {
    var authed by remember { mutableStateOf<Boolean?>(null) }
    var tab by remember { mutableStateOf(Tab.Home) }
    var overlay by remember { mutableStateOf<Overlay?>(null) }
    val unread by store.unread.collectAsState()

    // Poll unread count while logged in.
    LaunchedEffect(authed) {
        if (authed == true) {
            while (true) {
                withContext(Dispatchers.IO) {
                    try { store.setUnread(store.api.unreadCount()) } catch (_: Exception) {}
                }
                delay(45_000)
            }
        }
    }

    when (authed) {
        null -> SplashScreen(store, onDone = { authed = it })
        false -> AuthScreen(store, onAuthed = { authed = true })
        true -> {
            val ov = overlay
            if (ov != null) {
                OverlayScreen(ov, store, darkTheme, onToggleTheme,
                    onBack = { overlay = null },
                    onLogout = { authed = false; overlay = null })
            } else {
                Scaffold(
                    bottomBar = {
                        NavigationBar {
                            Tab.values().forEach { t ->
                                NavigationBarItem(
                                    selected = tab == t,
                                    onClick = { tab = t },
                                    icon = { Icon(t.icon, t.title) },
                                    label = { Text(t.title) },
                                )
                            }
                        }
                    }
                ) { pad ->
                    Box(Modifier.padding(pad)) {
                        when (tab) {
                            Tab.Home -> HomeScreen(store,
                                onOpenOverlay = { key ->
                                    overlay = when (key) {
                                        "notifications" -> Overlay.Notifications
                                        "terminal" -> Overlay.Terminal
                                        "admin_send" -> Overlay.AdminSend
                                        "admin_users" -> Overlay.AdminUsers
                                        else -> null
                                    }
                                })
                            Tab.Chat -> ChatScreen(store)
                            Tab.Agent -> AgentScreen(store)
                            Tab.Music -> MusicScreen(store)
                            Tab.More -> MoreScreen(
                                store = store,
                                unread = unread,
                                onOpen = { overlay = it },
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun OverlayScreen(
    ov: Overlay,
    store: SessionStore,
    darkTheme: Boolean,
    onToggleTheme: (Boolean) -> Unit,
    onBack: () -> Unit,
    onLogout: () -> Unit,
) {
    Column {
        androidx.compose.material3.TextButton(onClick = onBack,
            modifier = Modifier.padding(8.dp)) { Text("← Back") }
        when (ov) {
            is Overlay.Notifications -> NotificationsScreen(store)
            is Overlay.Friends -> FriendsScreen(store)
            is Overlay.Terminal -> TerminalScreen(store)
            is Overlay.AiKeys -> AiKeysScreen(store)
            is Overlay.Settings -> SettingsScreen(store, darkTheme, onToggleTheme, onLogout)
            is Overlay.AdminUsers -> AdminUsersScreen(store)
            is Overlay.AdminSend -> AdminSendScreen(store)
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun MoreScreen(
    store: SessionStore,
    unread: Int,
    onOpen: (Overlay) -> Unit,
) {
    val user = store.user.collectAsState().value
    val isAdmin = user?.role == "admin"

    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Text("More", fontSize = 22.sp, fontWeight = FontWeight.Bold)
        MoreRow("🔔", "Notifications",
            if (unread > 0) "$unread unread" else "Announcements") { onOpen(Overlay.Notifications) }
        MoreRow("👥", "Friends", "Connections") { onOpen(Overlay.Friends) }
        MoreRow("⌨️", "Terminal", "Server shell") { onOpen(Overlay.Terminal) }
        MoreRow("🔑", "AI Keys", "Providers & models") { onOpen(Overlay.AiKeys) }
        if (isAdmin) {
            MoreRow("👥", "Manage users", "View & remove") { onOpen(Overlay.AdminUsers) }
            MoreRow("📣", "Send notification", "Broadcast") { onOpen(Overlay.AdminSend) }
        }
        MoreRow("⚙️", "Settings", "Theme, server, logout") { onOpen(Overlay.Settings) }
        Spacer(Modifier.height(8.dp))
        Text("Signed in as @${user?.username ?: "?"}",
            color = androidx.compose.material3.MaterialTheme.colorScheme.onSurfaceVariant,
            fontSize = 13.sp)
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun MoreRow(emoji: String, title: String, subtitle: String, onClick: () -> Unit) {
    Card(onClick = onClick, modifier = Modifier.fillMaxWidth()) {
        Row(Modifier.padding(16.dp), horizontalArrangement = Arrangement.spacedBy(14.dp)) {
            Text(emoji, fontSize = 24.sp)
            Column {
                Text(title, fontWeight = FontWeight.SemiBold, fontSize = 16.sp)
                Text(subtitle,
                    color = androidx.compose.material3.MaterialTheme.colorScheme.onSurfaceVariant,
                    fontSize = 13.sp)
            }
        }
    }
}
