package com.neutron.app.ui.screens

import androidx.compose.foundation.background
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
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.neutron.app.api.ApiClient
import com.neutron.app.data.SessionStore
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

@Composable
fun TerminalScreen(store: SessionStore) {
    val scope = rememberCoroutineScope()
    var sessions by remember { mutableStateOf<List<ApiClient.TermSession>?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var showCreate by remember { mutableStateOf(false) }
    var newLabel by remember { mutableStateOf("") }
    var openId by remember { mutableStateOf<String?>(null) }
    var openLabel by remember { mutableStateOf("") }

    fun load() {
        scope.launch {
            try { sessions = store.api.termSessions(); error = null }
            catch (e: Exception) { error = e.message ?: "Failed to load sessions." }
        }
    }
    LaunchedEffect(Unit) { load() }

    val oid = openId
    if (oid != null) {
        TerminalView(store, oid, openLabel, onClose = { openId = null; load() })
        return
    }

    if (showCreate) {
        AlertDialog(
            onDismissRequest = { showCreate = false },
            title = { Text("New terminal session") },
            text = {
                OutlinedTextField(value = newLabel, onValueChange = { newLabel = it },
                    label = { Text("Label") }, singleLine = true, modifier = Modifier.fillMaxWidth())
            },
            confirmButton = {
                Button(onClick = {
                    showCreate = false
                    scope.launch {
                        try {
                            val s = store.api.termCreate(newLabel.ifBlank { "shell" })
                            openId = s.id; openLabel = s.label
                        } catch (e: Exception) { error = e.message }
                    }
                }) { Text("Create") }
            },
            dismissButton = { TextButton(onClick = { showCreate = false }) { Text("Cancel") } },
        )
    }

    Column(Modifier.fillMaxSize().padding(16.dp)) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically) {
            Text("Terminal", fontSize = 22.sp, fontWeight = FontWeight.Bold)
            Button(onClick = { showCreate = true }) { Text("+ New") }
        }
        Spacer(Modifier.height(12.dp))
        error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        when (val s = sessions) {
            null -> CircularProgressIndicator()
            else -> if (s.isEmpty()) {
                Text("No sessions yet. Create one to run commands on the server.",
                    color = MaterialTheme.colorScheme.onSurfaceVariant)
            } else {
                LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    items(s, key = { it.id }) { sess ->
                        Card(onClick = {
                            openId = sess.id; openLabel = sess.label
                        }, modifier = Modifier.fillMaxWidth()) {
                            Row(Modifier.padding(14.dp).fillMaxWidth(),
                                horizontalArrangement = Arrangement.SpaceBetween,
                                verticalAlignment = Alignment.CenterVertically) {
                                Column(Modifier.weight(1f)) {
                                    Text(sess.label, fontWeight = FontWeight.SemiBold)
                                    Text(sess.state.ifBlank { sess.id.take(12) },
                                        fontSize = 12.sp,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant)
                                }
                                TextButton(onClick = {
                                    scope.launch {
                                        try { store.api.termDelete(sess.id); load() }
                                        catch (e: Exception) { error = e.message }
                                    }
                                }) { Text("Delete") }
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun TerminalView(store: SessionStore, id: String, label: String, onClose: () -> Unit) {
    val scope = rememberCoroutineScope()
    val lines = remember { mutableStateListOf<String>() }
    var cursor by remember { mutableLongStateOf(0L) }
    var input by remember { mutableStateOf("") }
    var state by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }
    val scroll = rememberScrollState()

    // Poll for new output.
    LaunchedEffect(id) {
        while (true) {
            try {
                val out = store.api.termOutput(id, cursor)
                if (out.lines.isNotEmpty()) {
                    lines.addAll(out.lines)
                    cursor = out.cursor
                }
                state = out.state
                error = null
            } catch (e: Exception) {
                error = e.message
                delay(5000)
                continue
            }
            delay(1500)
        }
    }
    LaunchedEffect(lines.size) { scroll.animateScrollTo(scroll.maxValue) }

    fun sendCmd(cmd: String) {
        val c = if (cmd.endsWith("\n")) cmd else "$cmd\n"
        scope.launch {
            try { store.api.termInput(id, c); error = null }
            catch (e: Exception) { error = e.message }
        }
    }

    Column(Modifier.fillMaxSize()) {
        Row(Modifier.fillMaxWidth().padding(12.dp, 8.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically) {
            TextButton(onClick = onClose) { Text("← Sessions") }
            Text(label, fontWeight = FontWeight.SemiBold)
            Text(state.ifBlank { "live" }, fontSize = 12.sp,
                color = MaterialTheme.colorScheme.primary)
        }
        androidx.compose.foundation.layout.Box(
            Modifier.fillMaxWidth().weight(1f)) {
            Column(
                Modifier.fillMaxSize().background(Color(0xFF0D1117))
                    .verticalScroll(scroll).padding(12.dp),
            ) {
                for (l in lines) {
                    Text(l, color = Color(0xFFC9D1D9), fontFamily = FontFamily.Monospace,
                        fontSize = 12.sp, lineHeight = 16.sp)
                }
                if (lines.isEmpty()) {
                    Text("Connecting…", color = Color(0xFF8B949E),
                        fontFamily = FontFamily.Monospace, fontSize = 12.sp)
                }
            }
        }
        error?.let {
            Text(it, color = MaterialTheme.colorScheme.error, fontSize = 12.sp,
                modifier = Modifier.padding(horizontal = 12.dp))
        }
        Row(
            Modifier.fillMaxWidth().padding(8.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            OutlinedTextField(
                value = input, onValueChange = { input = it },
                placeholder = { Text("command…") }, singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Ascii),
                modifier = Modifier.weight(1f),
                textStyle = androidx.compose.ui.text.TextStyle(fontFamily = FontFamily.Monospace),
            )
            Button(onClick = { sendCmd(input); input = "" }) { Text("Run") }
        }
    }
}