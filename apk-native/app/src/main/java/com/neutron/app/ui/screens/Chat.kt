package com.neutron.app.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
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

data class ChatMsg(val role: String, val content: String)

@Composable
fun ChatScreen(store: SessionStore) {
    val scope = rememberCoroutineScope()
    val messages = remember { mutableStateListOf<ChatMsg>() }
    var input by remember { mutableStateOf("") }
    var sending by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val listState = rememberLazyListState()

    val provider = store.defaultProvider()
    val apiKey = store.getProviderKey(provider)
    val model = store.defaultModel().ifBlank { null }

    LaunchedEffect(messages.size) {
        if (messages.isNotEmpty()) listState.animateScrollToItem(messages.size - 1)
    }

    fun send() {
        val text = input.trim()
        if (text.isEmpty() || sending) return
        if (apiKey.isNullOrBlank()) {
            error = "No API key set for \"$provider\". Add one in More → AI Keys."
            return
        }
        input = ""
        error = null
        messages.add(ChatMsg("user", text))
        sending = true
        scope.launch {
            try {
                val history = messages
                    .filter { it.role == "user" || it.role == "assistant" }
                    .takeLast(20)
                    .map { it.role to it.content }
                val reply = store.api.chat(history, provider, model, apiKey)
                val answer = reply.text.ifBlank { "(empty response)" }
                messages.add(ChatMsg("assistant", answer))
            } catch (e: Exception) {
                error = e.message ?: "Chat failed."
            }
            sending = false
        }
    }

    Column(Modifier.fillMaxSize()) {
        if (messages.isEmpty()) {
            Column(
                Modifier.weight(1f).fillMaxWidth().padding(28.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.Center,
            ) {
                Text("💬", fontSize = 48.sp)
                Spacer(Modifier.height(12.dp))
                Text("Ask NEUTRON anything", fontSize = 20.sp, fontWeight = FontWeight.Bold)
                Spacer(Modifier.height(6.dp))
                Text("Using $provider${model?.let { " · $it" } ?: ""}",
                    color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 13.sp)
                if (apiKey.isNullOrBlank()) {
                    Spacer(Modifier.height(8.dp))
                    Text("Add your API key in More → AI Keys to start.",
                        color = MaterialTheme.colorScheme.error, fontSize = 13.sp)
                }
            }
        } else {
            LazyColumn(
                state = listState,
                modifier = Modifier.weight(1f).fillMaxWidth().padding(horizontal = 12.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                item { Spacer(Modifier.height(8.dp)) }
                items(messages) { m ->
                    val isUser = m.role == "user"
                    Row(Modifier.fillMaxWidth(),
                        horizontalArrangement = if (isUser) Arrangement.End else Arrangement.Start) {
                        Card(
                            modifier = Modifier.widthIn(max = 300.dp),
                            colors = CardDefaults.cardColors(
                                containerColor = if (isUser) MaterialTheme.colorScheme.primaryContainer
                                else MaterialTheme.colorScheme.surfaceVariant),
                        ) {
                            SelectionContainer {
                                Text(m.content, Modifier.padding(12.dp), fontSize = 14.sp)
                            }
                        }
                    }
                }
                if (sending) {
                    item {
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.Start) {
                            Card(colors = CardDefaults.cardColors(
                                containerColor = MaterialTheme.colorScheme.surfaceVariant)) {
                                Row(Modifier.padding(14.dp),
                                    verticalAlignment = Alignment.CenterVertically,
                                    horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                    CircularProgressIndicator(
                                        modifier = Modifier.padding(2.dp),
                                        strokeWidth = 2.dp)
                                    Text("Thinking…", fontSize = 13.sp,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant)
                                }
                            }
                        }
                    }
                }
                item { Spacer(Modifier.height(8.dp)) }
            }
        }

        error?.let {
            Text(it, color = MaterialTheme.colorScheme.error, fontSize = 13.sp,
                modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp))
        }
        Row(
            Modifier.fillMaxWidth().padding(12.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            OutlinedTextField(
                value = input, onValueChange = { input = it },
                placeholder = { Text("Message NEUTRON…") },
                modifier = Modifier.weight(1f),
                maxLines = 4, enabled = !sending,
            )
            Button(onClick = { send() }, enabled = !sending && input.isNotBlank()) {
                Text("Send")
            }
        }
    }
}
