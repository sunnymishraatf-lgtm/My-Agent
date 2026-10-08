package com.neutron.app.ui.screens

import android.content.Intent
import android.net.Uri
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
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.neutron.app.api.ApiClient
import com.neutron.app.data.SessionStore
import kotlinx.coroutines.launch

@Composable
fun MusicScreen(store: SessionStore) {
    val scope = rememberCoroutineScope()
    val ctx = LocalContext.current
    var query by remember { mutableStateOf("") }
    var tracks by remember { mutableStateOf<List<ApiClient.Track>?>(null) }
    var searching by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    fun search() {
        val q = query.trim()
        if (q.isEmpty() || searching) return
        searching = true; error = null
        scope.launch {
            try {
                tracks = store.api.musicSearch(q)
                if (tracks!!.isEmpty()) error = "No results found."
            } catch (e: Exception) { error = e.message ?: "Search failed." }
            searching = false
        }
    }

    fun play(t: ApiClient.Track) {
        // Hand off to the YouTube app (or browser) — no stream ripping.
        val uri = if (t.id.startsWith("http")) Uri.parse(t.id)
        else Uri.parse("https://www.youtube.com/watch?v=${t.id}")
        val intent = Intent(Intent.ACTION_VIEW, uri).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        try { ctx.startActivity(intent) }
        catch (_: Exception) { error = "No app can play this link." }
    }

    Column(Modifier.fillMaxSize().padding(16.dp)) {
        Text("Music", fontSize = 22.sp, fontWeight = FontWeight.Bold)
        Spacer(Modifier.height(4.dp))
        Text("Search songs, play in your YouTube app.",
            color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 13.sp)
        Spacer(Modifier.height(12.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalAlignment = Alignment.CenterVertically) {
            OutlinedTextField(
                value = query, onValueChange = { query = it },
                placeholder = { Text("Song or artist…") }, singleLine = true,
                modifier = Modifier.weight(1f), enabled = !searching,
            )
            Button(onClick = { search() }, enabled = !searching) { Text("Search") }
        }
        Spacer(Modifier.height(12.dp))
        when {
            searching -> CircularProgressIndicator()
            error != null -> Text(error!!, color = MaterialTheme.colorScheme.error)
            tracks != null -> {
                if (tracks!!.isEmpty()) {
                    Text("No results.", color = MaterialTheme.colorScheme.onSurfaceVariant)
                } else {
                    LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        items(tracks!!, key = { it.id + it.title }) { t ->
                            Card(onClick = { play(t) }, modifier = Modifier.fillMaxWidth()) {
                                Row(Modifier.padding(14.dp).fillMaxWidth(),
                                    horizontalArrangement = Arrangement.SpaceBetween,
                                    verticalAlignment = Alignment.CenterVertically) {
                                    Column(Modifier.weight(1f)) {
                                        Text(t.title, fontWeight = FontWeight.SemiBold,
                                            fontSize = 15.sp)
                                        t.artist?.let {
                                            Text(it, fontSize = 13.sp,
                                                color = MaterialTheme.colorScheme.onSurfaceVariant)
                                        }
                                    }
                                    Text("▶", fontSize = 22.sp,
                                        color = MaterialTheme.colorScheme.primary)
                                }
                            }
                        }
                    }
                }
            }
            else -> Text("Search above to find music.",
                color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}
