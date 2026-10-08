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
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
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
import com.neutron.app.data.SessionStore
import kotlinx.coroutines.launch

@Composable
fun SettingsScreen(
    store: SessionStore,
    darkTheme: Boolean,
    onToggleTheme: (Boolean) -> Unit,
    onLogout: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    val user by store.user.collectAsState()
    var showLogout by remember { mutableStateOf(false) }
    var showServer by remember { mutableStateOf(false) }
    var serverUrl by remember { mutableStateOf(store.baseUrl()) }

    if (showLogout) {
        AlertDialog(
            onDismissRequest = { showLogout = false },
            title = { Text("Log out?") },
            confirmButton = {
                Button(onClick = {
                    showLogout = false
                    scope.launch {
                        try { store.api.logout() } catch (_: Exception) {}
                        store.clearSession()
                        onLogout()
                    }
                }) { Text("Log out") }
            },
            dismissButton = { TextButton(onClick = { showLogout = false }) { Text("Cancel") } },
        )
    }
    if (showServer) {
        AlertDialog(
            onDismissRequest = { showServer = false },
            title = { Text("Backend server") },
            text = {
                OutlinedTextField(value = serverUrl, onValueChange = { serverUrl = it },
                    label = { Text("Server URL") }, singleLine = true,
                    modifier = Modifier.fillMaxWidth())
            },
            confirmButton = {
                Button(onClick = {
                    if (serverUrl.isNotBlank()) store.setBaseUrl(serverUrl)
                    showServer = false
                }) { Text("Save") }
            },
            dismissButton = { TextButton(onClick = { showServer = false }) { Text("Cancel") } },
        )
    }

    Column(
        modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Text("Settings", fontSize = 22.sp, fontWeight = FontWeight.Bold)

        Card(Modifier.fillMaxWidth()) {
            Column(Modifier.padding(16.dp)) {
                Text(user?.displayName ?: "@${user?.username}", fontWeight = FontWeight.SemiBold, fontSize = 17.sp)
                Text("@${user?.username}" + (user?.email?.let { " · $it" } ?: ""),
                    color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 13.sp)
                Text("Signed in via ${user?.provider ?: "?"}${if (user?.role == "admin") " · ADMIN" else ""}",
                    color = MaterialTheme.colorScheme.primary, fontSize = 13.sp)
            }
        }

        Card(Modifier.fillMaxWidth()) {
            Row(Modifier.padding(16.dp).fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically) {
                Column {
                    Text("Dark theme", fontWeight = FontWeight.SemiBold)
                    Text("Easier on the eyes at night", fontSize = 13.sp,
                        color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                Switch(checked = darkTheme, onCheckedChange = onToggleTheme)
            }
        }

        OutlinedButton(onClick = { showServer = true }, modifier = Modifier.fillMaxWidth()) {
            Text("Backend server")
        }
        Text(store.baseUrl(), fontSize = 12.sp,
            color = MaterialTheme.colorScheme.onSurfaceVariant)

        Spacer(Modifier.height(8.dp))
        Button(onClick = { showLogout = true }, modifier = Modifier.fillMaxWidth()) {
            Text("Log out")
        }
        Text("NEUTRON Native v2.0", fontSize = 12.sp,
            color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}
