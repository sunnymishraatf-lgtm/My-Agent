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
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.neutron.app.api.ApiClient
import com.neutron.app.data.SessionStore
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

@Composable
fun AgentScreen(store: SessionStore) {
    val scope = rememberCoroutineScope()
    var runs by remember { mutableStateOf<List<ApiClient.AgentRun>?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var showCreate by remember { mutableStateOf(false) }
    var goal by remember { mutableStateOf("") }
    var openId by remember { mutableStateOf<String?>(null) }

    fun load() {
        scope.launch {
            try { runs = store.api.agentRuns(); error = null }
            catch (e: Exception) { error = e.message ?: "Failed to load runs." }
        }
    }
    LaunchedEffect(Unit) { load() }

    val oid = openId
    if (oid != null) {
        AgentRunDetail(store, oid, onClose = { openId = null; load() })
        return
    }

    if (showCreate) {
        val provider = store.defaultProvider()
        val apiKey = store.getProviderKey(provider)
        AlertDialog(
            onDismissRequest = { showCreate = false },
            title = { Text("New agent run") },
            text = {
                Column {
                    OutlinedTextField(value = goal, onValueChange = { goal = it },
                        label = { Text("Goal — what should the agent do?") },
                        minLines = 3, modifier = Modifier.fillMaxWidth())
                    Spacer(Modifier.height(8.dp))
                    Text("Uses $provider${if (apiKey.isNullOrBlank()) " (no API key set!)" else ""}",
                        fontSize = 12.sp,
                        color = if (apiKey.isNullOrBlank()) MaterialTheme.colorScheme.error
                        else MaterialTheme.colorScheme.onSurfaceVariant)
                }
            },
            confirmButton = {
                Button(onClick = {
                    showCreate = false
                    scope.launch {
                        try {
                            val run = store.api.agentCreate(
                                goal.trim(), provider,
                                store.defaultModel().ifBlank { null }, apiKey)
                            goal = ""
                            openId = run.id
                        } catch (e: Exception) { error = e.message }
                    }
                }, enabled = goal.isNotBlank()) { Text("Start") }
            },
            dismissButton = { TextButton(onClick = { showCreate = false }) { Text("Cancel") } },
        )
    }

    Column(Modifier.fillMaxSize().padding(16.dp)) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically) {
            Text("Agent runs", fontSize = 22.sp, fontWeight = FontWeight.Bold)
            Button(onClick = { showCreate = true }) { Text("+ New run") }
        }
        Spacer(Modifier.height(4.dp))
        Text("Autonomous tasks on the server. Approve steps as they come up.",
            color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 13.sp)
        Spacer(Modifier.height(12.dp))
        error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        when (val r = runs) {
            null -> CircularProgressIndicator()
            else -> if (r.isEmpty()) {
                Text("No runs yet.", color = MaterialTheme.colorScheme.onSurfaceVariant)
            } else {
                LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    items(r, key = { it.id }) { run ->
                        Card(onClick = { openId = run.id }, modifier = Modifier.fillMaxWidth()) {
                            Column(Modifier.padding(14.dp)) {
                                Text(run.goal.ifBlank { run.id.take(12) },
                                    fontWeight = FontWeight.SemiBold, fontSize = 15.sp,
                                    maxLines = 2)
                                Spacer(Modifier.height(4.dp))
                                StatusChip(run.status)
                                if (run.approvals.isNotEmpty()) {
                                    Text("⚠️ ${run.approvals.size} approval(s) needed",
                                        color = Color(0xFFB7791F), fontSize = 13.sp)
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
private fun StatusChip(status: String) {
    val color = when (status.lowercase()) {
        "completed" -> Color(0xFF2F9E44)
        "failed", "denied" -> MaterialTheme.colorScheme.error
        "running", "active" -> MaterialTheme.colorScheme.primary
        else -> MaterialTheme.colorScheme.onSurfaceVariant
    }
    Card(colors = CardDefaults.cardColors(containerColor = color.copy(alpha = 0.15f))) {
        Text(status, Modifier.padding(horizontal = 10.dp, vertical = 4.dp),
            color = color, fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
    }
}

@Composable
private fun AgentRunDetail(store: SessionStore, id: String, onClose: () -> Unit) {
    val scope = rememberCoroutineScope()
    var run by remember { mutableStateOf<ApiClient.AgentRun?>(null) }
    var error by remember { mutableStateOf<String?>(null) }

    val active = run?.status?.lowercase() !in setOf("completed", "failed", "stopped", "denied")

    LaunchedEffect(id) {
        while (true) {
            try {
                run = store.api.agentGet(id)
                error = null
                if (!active) break
            } catch (e: Exception) { error = e.message }
            delay(3000)
        }
    }

    Column(Modifier.fillMaxSize()) {
        Row(Modifier.fillMaxWidth().padding(12.dp, 8.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically) {
            TextButton(onClick = onClose) { Text("← Runs") }
            run?.let { StatusChip(it.status) }
        }
        val r = run
        if (r == null) {
            CircularProgressIndicator(Modifier.padding(24.dp))
        } else {
            Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text(r.goal.ifBlank { "Run ${r.id.take(8)}" },
                    fontWeight = FontWeight.Bold, fontSize = 17.sp)

                // Pending approvals.
                for (a in r.approvals) {
                    Card(colors = CardDefaults.cardColors(
                        containerColor = Color(0xFFFFF3CD))) {
                        Column(Modifier.padding(14.dp)) {
                            Text("⚠️ Approval needed", fontWeight = FontWeight.Bold)
                            Spacer(Modifier.height(4.dp))
                            Text(a.summary.ifBlank { a.id }, fontSize = 14.sp)
                            Spacer(Modifier.height(8.dp))
                            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                Button(onClick = {
                                    scope.launch {
                                        try {
                                            store.api.agentDecide(id, a.id, true)
                                            run = store.api.agentGet(id)
                                        } catch (e: Exception) { error = e.message }
                                    }
                                }) { Text("Approve") }
                                OutlinedButton(onClick = {
                                    scope.launch {
                                        try {
                                            store.api.agentDecide(id, a.id, false)
                                            run = store.api.agentGet(id)
                                        } catch (e: Exception) { error = e.message }
                                    }
                                }) { Text("Deny") }
                            }
                        }
                    }
                }

                Text("Log", fontWeight = FontWeight.SemiBold)
                Card(Modifier.fillMaxWidth()) {
                    Text(r.log.ifBlank { "(no output yet)" },
                        Modifier.padding(12.dp),
                        fontFamily = FontFamily.Monospace, fontSize = 12.sp)
                }
                error?.let { Text(it, color = MaterialTheme.colorScheme.error, fontSize = 13.sp) }

                if (active) {
                    OutlinedButton(
                        onClick = {
                            scope.launch {
                                try {
                                    store.api.agentStop(id)
                                    run = store.api.agentGet(id)
                                } catch (e: Exception) { error = e.message }
                            }
                        },
                        modifier = Modifier.fillMaxWidth(),
                    ) { Text("Stop run") }
                }
            }
        }
    }
}
