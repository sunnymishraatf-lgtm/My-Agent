package com.neutron.app.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.neutron.app.api.Announcement
import com.neutron.app.data.SessionStore
import kotlinx.coroutines.launch
import java.text.DateFormat
import java.util.Date

@Composable
fun NotificationsScreen(store: SessionStore) {
    val scope = rememberCoroutineScope()
    var items by remember { mutableStateOf<List<Announcement>?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var pendingDelete by remember { mutableStateOf<Announcement?>(null) }

    fun load() {
        scope.launch {
            try {
                items = store.api.announcements()
                store.setUnread(store.api.unreadCount())
                error = null
            } catch (e: Exception) { error = e.message ?: "Failed to load." }
        }
    }
    LaunchedEffect(Unit) { load() }

    pendingDelete?.let { a ->
        AlertDialog(
            onDismissRequest = { pendingDelete = null },
            title = { Text("Delete announcement?") },
            text = { Text("It will be permanently removed from your inbox.") },
            confirmButton = {
                Button(onClick = {
                    pendingDelete = null
                    scope.launch {
                        try { store.api.deleteAnnouncement(a.notificationId); load() }
                        catch (e: Exception) { error = e.message }
                    }
                }) { Text("Delete") }
            },
            dismissButton = { TextButton(onClick = { pendingDelete = null }) { Text("Cancel") } },
        )
    }

    Column(Modifier.fillMaxSize().padding(16.dp)) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically) {
            Text("Announcements", fontSize = 22.sp, fontWeight = FontWeight.Bold)
            OutlinedButton(onClick = {
                scope.launch {
                    try { store.api.markAllRead(); load() } catch (e: Exception) { error = e.message }
                }
            }) { Text("Mark all read") }
        }
        Spacer(Modifier.height(12.dp))
        when {
            error != null -> Text(error!!, color = MaterialTheme.colorScheme.error)
            items == null -> CircularProgressIndicator()
            items!!.isEmpty() -> Text("No announcements yet.",
                color = MaterialTheme.colorScheme.onSurfaceVariant)
            else -> LazyColumn(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                items(items!!, key = { it.notificationId }) { a ->
                    Card(
                        modifier = Modifier.fillMaxWidth(),
                        colors = CardDefaults.cardColors(
                            containerColor = if (a.read) MaterialTheme.colorScheme.surfaceVariant
                            else MaterialTheme.colorScheme.primaryContainer),
                    ) {
                        Column(Modifier.padding(14.dp)) {
                            Row(Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.SpaceBetween) {
                                Text(a.title, fontWeight = FontWeight.SemiBold, fontSize = 16.sp,
                                    modifier = Modifier.weight(1f))
                                Text(typeLabel(a.type),
                                    color = MaterialTheme.colorScheme.primary, fontSize = 12.sp)
                            }
                            Spacer(Modifier.height(4.dp))
                            Text(a.message, fontSize = 14.sp)
                            Spacer(Modifier.height(8.dp))
                            Row(horizontalArrangement = Arrangement.spacedBy(8.dp),
                                verticalAlignment = Alignment.CenterVertically) {
                                Text(
                                    DateFormat.getDateTimeInstance(DateFormat.SHORT, DateFormat.SHORT)
                                        .format(Date(a.createdAt)),
                                    fontSize = 12.sp,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    modifier = Modifier.weight(1f),
                                )
                                if (!a.read) {
                                    TextButton(onClick = {
                                        scope.launch {
                                            try { store.api.markRead(a.notificationId); load() }
                                            catch (e: Exception) { error = e.message }
                                        }
                                    }) { Text("Mark read") }
                                }
                                TextButton(onClick = { pendingDelete = a }) { Text("Delete") }
                            }
                        }
                    }
                }
            }
        }
    }
}

private fun typeLabel(t: String): String = when (t) {
    "success" -> "Success"; "warning" -> "Warning"; "important" -> "Important"
    "system_update" -> "Update"; else -> "Info"
}
