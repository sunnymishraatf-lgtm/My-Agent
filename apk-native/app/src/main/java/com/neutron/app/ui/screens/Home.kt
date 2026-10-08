package com.neutron.app.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.neutron.app.api.AdminStats
import com.neutron.app.data.SessionStore
import java.text.DateFormat
import java.util.Date

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HomeScreen(store: SessionStore, onOpenOverlay: (String) -> Unit) {
    val user by store.user.collectAsState()
    val unread by store.unread.collectAsState()
    var stats by remember { mutableStateOf<AdminStats?>(null) }
    val isAdmin = user?.role == "admin"

    LaunchedEffect(Unit) {
        try { store.setUnread(store.api.unreadCount()) } catch (_: Exception) {}
        if (isAdmin) {
            try { stats = store.api.adminStats() } catch (_: Exception) {}
        }
    }

    Column(
        modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Text(
            "Hello, ${user?.displayName ?: user?.username ?: "there"} 👋",
            fontSize = 24.sp, fontWeight = FontWeight.Bold,
        )
        Text(
            DateFormat.getDateInstance(DateFormat.LONG).format(Date()),
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )

        Row(horizontalArrangement = Arrangement.spacedBy(12.dp), modifier = Modifier.fillMaxWidth()) {
            StatCard("Unread", unread.toString(), Modifier.weight(1f))
            if (isAdmin && stats != null) {
                StatCard("Users", stats!!.totalUsers.toString(), Modifier.weight(1f))
                StatCard("Sent today", stats!!.sentToday.toString(), Modifier.weight(1f))
            }
        }

        Text("Quick actions", fontWeight = FontWeight.SemiBold, fontSize = 17.sp)
        ActionRow("🔔", "Notifications",
            if (unread > 0) "$unread unread" else "Announcements") { onOpenOverlay("notifications") }
        ActionRow("⌨️", "Terminal", "Server shell") { onOpenOverlay("terminal") }
        if (isAdmin) {
            Spacer(Modifier.height(4.dp))
            Text("Admin", fontWeight = FontWeight.SemiBold, fontSize = 17.sp)
            ActionRow("📣", "Send notification", "Broadcast to users") { onOpenOverlay("admin_send") }
            ActionRow("👥", "Manage users", "View & remove users") { onOpenOverlay("admin_users") }
        }
    }
}

@Composable
private fun StatCard(label: String, value: String, modifier: Modifier = Modifier) {
    Card(modifier = modifier, colors = CardDefaults.cardColors(
        containerColor = MaterialTheme.colorScheme.primaryContainer)) {
        Column(Modifier.padding(14.dp)) {
            Text(value, fontSize = 26.sp, fontWeight = FontWeight.Bold,
                color = MaterialTheme.colorScheme.onPrimaryContainer)
            Text(label, color = MaterialTheme.colorScheme.onPrimaryContainer)
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ActionRow(emoji: String, title: String, subtitle: String, onClick: () -> Unit) {
    Card(onClick = onClick, modifier = Modifier.fillMaxWidth()) {
        Row(Modifier.padding(16.dp), horizontalArrangement = Arrangement.spacedBy(14.dp)) {
            Text(emoji, fontSize = 26.sp)
            Column {
                Text(title, fontWeight = FontWeight.SemiBold, fontSize = 16.sp)
                Text(subtitle, color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 13.sp)
            }
        }
    }
    Spacer(Modifier.height(2.dp))
}
