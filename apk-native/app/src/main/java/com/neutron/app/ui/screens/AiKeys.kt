package com.neutron.app.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.neutron.app.data.SessionStore

val AI_PROVIDERS = listOf("openai", "anthropic", "google", "nvidia", "groq", "openrouter")

@Composable
fun AiKeysScreen(store: SessionStore) {
    var provider by remember { mutableStateOf(store.defaultProvider()) }
    var model by remember { mutableStateOf(store.defaultModel()) }
    var key by remember { mutableStateOf(store.getProviderKey(provider) ?: "") }
    var showKey by remember { mutableStateOf(false) }
    var saved by remember { mutableStateOf<String?>(null) }

    fun loadFor(p: String) {
        provider = p
        key = store.getProviderKey(p) ?: ""
        showKey = false
        saved = null
    }

    Column(
        modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text("AI Keys", fontSize = 22.sp, fontWeight = FontWeight.Bold)
        Text("Your keys stay encrypted on this device and are only sent to the provider you choose.",
            fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)

        Text("Provider", fontWeight = FontWeight.SemiBold)
        Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
            AI_PROVIDERS.chunked(3).forEach { row ->
                androidx.compose.foundation.layout.Row(
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    row.forEach { p ->
                        val has = store.getProviderKey(p) != null
                        androidx.compose.material3.FilterChip(
                            selected = provider == p,
                            onClick = { loadFor(p) },
                            label = { Text(p + if (has) " ✓" else "") },
                            modifier = Modifier.weight(1f),
                        )
                    }
                }
            }
        }

        OutlinedTextField(
            value = model, onValueChange = { model = it },
            label = { Text("Model (optional, e.g. gpt-4o-mini)") },
            singleLine = true, modifier = Modifier.fillMaxWidth(),
        )
        OutlinedTextField(
            value = key, onValueChange = { key = it; saved = null },
            label = { Text("API key for $provider") }, singleLine = true,
            visualTransformation = if (showKey) VisualTransformation.None
            else PasswordVisualTransformation(),
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
            modifier = Modifier.fillMaxWidth(),
            trailingIcon = {
                androidx.compose.material3.TextButton(onClick = { showKey = !showKey }) {
                    Text(if (showKey) "Hide" else "Show")
                }
            },
        )
        Button(
            onClick = {
                if (key.isBlank()) {
                    // Clearing: remove stored key.
                    store.setProviderKey(provider, "")
                } else {
                    store.setProviderKey(provider, key.trim())
                }
                store.setDefaultProvider(provider)
                store.setDefaultModel(model.trim())
                saved = "Saved. \"$provider\" is now the default."
            },
            modifier = Modifier.fillMaxWidth(),
        ) { Text("Save") }
        saved?.let { Text(it, color = MaterialTheme.colorScheme.primary) }

        Card(Modifier.fillMaxWidth()) {
            Text(
                "Chat and Agent use the default provider above. " +
                    "Clear the key field and save to remove a key.",
                Modifier.padding(14.dp), fontSize = 13.sp,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        Spacer(Modifier.height(8.dp))
    }
}
