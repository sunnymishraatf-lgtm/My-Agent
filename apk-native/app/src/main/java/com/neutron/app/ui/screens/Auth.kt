package com.neutron.app.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.neutron.app.api.ApiClient
import com.neutron.app.data.SessionStore
import kotlinx.coroutines.launch

@Composable
fun AuthScreen(store: SessionStore, onAuthed: () -> Unit) {
    val scope = rememberCoroutineScope()
    var mode by remember { mutableStateOf("choose") } // choose | login | register
    var login by remember { mutableStateOf("") }
    var email by remember { mutableStateOf("") }
    var username by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    fun fail(e: Exception) {
        error = if (e is ApiClient.ApiException) e.message else "Network error. Check your connection."
        busy = false
    }

    Column(
        modifier = Modifier.fillMaxSize().padding(28.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Text("NEUTRON", fontSize = 40.sp, fontWeight = FontWeight.Black,
            color = MaterialTheme.colorScheme.primary)
        Spacer(Modifier.height(6.dp))
        Text("Your AI companion, now native.",
            color = MaterialTheme.colorScheme.onSurfaceVariant)
        Spacer(Modifier.height(32.dp))

        when (mode) {
            "choose" -> {
                Button(
                    onClick = {
                        busy = true; error = null
                        scope.launch {
                            try {
                                val r = store.api.guestLogin()
                                store.saveSession(r.user, r.token)
                                onAuthed()
                            } catch (e: Exception) { fail(e) }
                        }
                    },
                    modifier = Modifier.fillMaxWidth(), enabled = !busy,
                ) { Text(if (busy) "Entering…" else "Continue as guest") }
                Spacer(Modifier.height(12.dp))
                OutlinedButton(
                    onClick = { mode = "login"; error = null },
                    modifier = Modifier.fillMaxWidth(), enabled = !busy,
                ) { Text("Log in with email") }
                Spacer(Modifier.height(4.dp))
                TextButton(onClick = { mode = "register"; error = null }, enabled = !busy) {
                    Text("No account? Create one")
                }
            }
            "login", "register" -> {
                if (mode == "register") {
                    OutlinedTextField(value = email, onValueChange = { email = it },
                        label = { Text("Email") }, singleLine = true,
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email),
                        modifier = Modifier.fillMaxWidth(), enabled = !busy)
                    Spacer(Modifier.height(10.dp))
                    OutlinedTextField(value = username, onValueChange = { username = it },
                        label = { Text("Username") }, singleLine = true,
                        modifier = Modifier.fillMaxWidth(), enabled = !busy)
                    Spacer(Modifier.height(10.dp))
                } else {
                    OutlinedTextField(value = login, onValueChange = { login = it },
                        label = { Text("Email or username") }, singleLine = true,
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email),
                        modifier = Modifier.fillMaxWidth(), enabled = !busy)
                    Spacer(Modifier.height(10.dp))
                }
                OutlinedTextField(value = password, onValueChange = { password = it },
                    label = { Text("Password") }, singleLine = true,
                    visualTransformation = PasswordVisualTransformation(),
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                    modifier = Modifier.fillMaxWidth(), enabled = !busy)
                Spacer(Modifier.height(16.dp))
                Button(
                    onClick = {
                        busy = true; error = null
                        scope.launch {
                            try {
                                val r = if (mode == "register")
                                    store.api.register(email.trim(), password, username.trim())
                                else
                                    store.api.emailLogin(login.trim(), password)
                                store.saveSession(r.user, r.token)
                                onAuthed()
                            } catch (e: Exception) { fail(e) }
                        }
                    },
                    modifier = Modifier.fillMaxWidth(), enabled = !busy,
                ) { Text(if (busy) "Please wait…" else if (mode == "register") "Create account" else "Log in") }
                Spacer(Modifier.height(4.dp))
                TextButton(onClick = { mode = "choose"; error = null }, enabled = !busy) {
                    Text("← Back")
                }
            }
        }

        error?.let {
            Spacer(Modifier.height(12.dp))
            Text(it, color = MaterialTheme.colorScheme.error)
        }
    }
}
