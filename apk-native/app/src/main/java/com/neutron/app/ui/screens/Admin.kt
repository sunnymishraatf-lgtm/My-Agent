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
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
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
import com.neutron.app.api.AdminUser
import com.neutron.app.data.SessionStore
import kotlinx.coroutines.launch

@Composable
fun AdminUsersScreen(store: SessionStore) {
    val scope = rememberCoroutineScope()
    var users by remember { mutableStateOf<List<AdminUser>?>(null) }
    var search by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }
    var toast by remember { mutableStateOf<String?>(null) }
    var pendingDelete by remember { mutableStateOf<AdminUser?>(null) }

    fun load() {
        scope.launch {
            try { users = store.api.adminUsers(search); error = null }
            catch (e: Exception) { error = e.message ?: "Failed to load." }
        }
    }
    LaunchedEffect(Unit) { load() }

    pendingDelete?.let { u ->
        AlertDialog(
            onDismissRequest = { pendingDelete = null },
            title = { Text("Remove @${u.username}?") },
            text = { Text("This permanently deletes their account and all their data.") },
            confirmButton = {
                Button(onClick = {
                    pendingDelete = null
                    scope.launch {
                        try { toast = store.api.adminDeleteUser(u.id); load() }
                        catch (e: Exception) { toast = e.message }
                    }
                }) { Text("Remove") }
            },
            dismissButton = { TextButton(onClick = { pendingDelete = null }) { Text("Cancel") } },
        )
    }

    Column(Modifier.fillMaxSize().padding(16.dp)) {
        Text("Users", fontSize = 22.sp, fontWeight = FontWeight.Bold)
        Spacer(Modifier.height(8.dp))
        OutlinedTextField(value = search, onValueChange = { search = it },
            label = { Text("Search username, name, email") }, singleLine = true,
            modifier = Modifier.fillMaxWidth())
        Spacer(Modifier.height(4.dp))
        Button(onClick = { load() }, modifier = Modifier.fillMaxWidth()) { Text("Search") }
        Spacer(Modifier.height(8.dp))
        toast?.let { Text(it, color = MaterialTheme.colorScheme.primary) }
        when {
            error != null -> Text(error!!, color = MaterialTheme.colorScheme.error)
            users == null -> CircularProgressIndicator()
            users!!.isEmpty() -> Text("No users found.",
                color = MaterialTheme.colorScheme.onSurfaceVariant)
            else -> {
                Text("${users!!.size} users", color = MaterialTheme.colorScheme.onSurfaceVariant,
                    fontSize = 13.sp)
                Spacer(Modifier.height(6.dp))
                LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    items(users!!, key = { it.id }) { u ->
                        Card(Modifier.fillMaxWidth()) {
                            Row(Modifier.padding(14.dp).fillMaxWidth(),
                                horizontalArrangement = Arrangement.SpaceBetween,
                                verticalAlignment = Alignment.CenterVertically) {
                                Column(Modifier.weight(1f)) {
                                    Text("@${u.username}", fontWeight = FontWeight.SemiBold)
                                    Text((u.email ?: "no email") + " · ${u.role}",
                                        fontSize = 13.sp,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant)
                                }
                                if (u.role != "admin") {
                                    TextButton(onClick = { pendingDelete = u }) { Text("Remove") }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
fun AdminSendScreen(store: SessionStore) {
    val scope = rememberCoroutineScope()
    var title by remember { mutableStateOf("") }
    var message by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var result by remember { mutableStateOf<String?>(null) }
    var confirm by remember { mutableStateOf(false) }

    if (confirm) {
        AlertDialog(
            onDismissRequest = { confirm = false },
            title = { Text("Send to ALL users?") },
            text = { Text("\"$title\"\n\nThis cannot be undone.") },
            confirmButton = {
                Button(onClick = {
                    confirm = false; busy = true
                    scope.launch {
                        try {
                            result = store.api.adminSendNotification(
                                title.trim(), message.trim(), "information", "all")
                            title = ""; message = ""
                        } catch (e: Exception) { result = "Failed: ${e.message}" }
                        busy = false
                    }
                }) { Text("Send") }
            },
            dismissButton = { TextButton(onClick = { confirm = false }) { Text("Cancel") } },
        )
    }

    Column(
        modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text("Send notification", fontSize = 22.sp, fontWeight = FontWeight.Bold)
        OutlinedTextField(value = title, onValueChange = { title = it },
            label = { Text("Title") }, singleLine = true, modifier = Modifier.fillMaxWidth())
        OutlinedTextField(value = message, onValueChange = { message = it },
            label = { Text("Message") }, minLines = 4, modifier = Modifier.fillMaxWidth())
        Button(
            onClick = { confirm = true },
            enabled = !busy && title.isNotBlank() && message.isNotBlank(),
            modifier = Modifier.fillMaxWidth(),
        ) { Text(if (busy) "Sending…" else "Send to all users") }
        result?.let { Text(it, color = MaterialTheme.colorScheme.primary) }
        Text("Audience targeting (active/specific) and history live in the full admin panel.",
            fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}
