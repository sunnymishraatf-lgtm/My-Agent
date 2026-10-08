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
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
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
import com.neutron.app.api.Connection
import com.neutron.app.data.SessionStore
import kotlinx.coroutines.launch

@Composable
fun FriendsScreen(store: SessionStore) {
    val scope = rememberCoroutineScope()
    var items by remember { mutableStateOf<List<Connection>?>(null) }
    var error by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(Unit) {
        scope.launch {
            try { items = store.api.connections(); error = null }
            catch (e: Exception) { error = e.message ?: "Failed to load." }
        }
    }

    Column(Modifier.fillMaxSize().padding(16.dp)) {
        Text("Friends", fontSize = 22.sp, fontWeight = FontWeight.Bold)
        Spacer(Modifier.height(4.dp))
        Text("Manage connections in the full app — coming natively soon.",
            color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 13.sp)
        Spacer(Modifier.height(12.dp))
        when {
            error != null -> Text(error!!, color = MaterialTheme.colorScheme.error)
            items == null -> CircularProgressIndicator()
            items!!.isEmpty() -> Text("No connections yet.",
                color = MaterialTheme.colorScheme.onSurfaceVariant)
            else -> LazyColumn(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                items(items!!, key = { it.id }) { c ->
                    Card(Modifier.fillMaxWidth()) {
                        Row(Modifier.padding(16.dp).fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically) {
                            Column(Modifier.weight(1f)) {
                                Text(c.displayName.ifBlank { "@${c.username}" },
                                    fontWeight = FontWeight.SemiBold, fontSize = 16.sp)
                                Text("@${c.username}",
                                    color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 13.sp)
                            }
                            Text(c.status.replaceFirstChar { it.uppercase() },
                                color = MaterialTheme.colorScheme.primary, fontSize = 13.sp)
                        }
                    }
                }
            }
        }
    }
}
