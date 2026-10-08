package com.neutron.app.data

import android.content.Context
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import com.neutron.app.api.ApiClient
import com.neutron.app.api.User
import com.neutron.app.api.toUser
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import org.json.JSONObject

/** Encrypted session storage + in-memory app state. */
class SessionStore(context: Context) {

    private val masterKey = MasterKey.Builder(context)
        .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
        .build()

    private val prefs = EncryptedSharedPreferences.create(
        context, "neutron_session", masterKey,
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
    )

    val api = ApiClient(
        baseUrl = prefs.getString("base_url", ApiClient.DEFAULT_BASE_URL)
            ?: ApiClient.DEFAULT_BASE_URL,
        token = prefs.getString("token", null),
    )

    private val _user = MutableStateFlow<User?>(loadUser())
    val user: StateFlow<User?> = _user

    private val _unread = MutableStateFlow(0)
    val unread: StateFlow<Int> = _unread

    private fun loadUser(): User? {
        val raw = prefs.getString("user", null) ?: return null
        return try { JSONObject(raw).toUser() } catch (_: Exception) { null }
    }

    fun saveSession(user: User, token: String) {
        prefs.edit()
            .putString("token", token)
            .putString("user", JSONObject()
                .put("id", user.id).put("username", user.username)
                .put("displayName", user.displayName).put("email", user.email)
                .put("provider", user.provider).put("role", user.role)
                .put("avatarUrl", user.avatarUrl).put("createdAt", user.createdAt)
                .toString())
            .apply()
        api.setToken(token)
        _user.value = user
    }

    fun updateUser(user: User) {
        _user.value = user
        prefs.edit().putString("user", JSONObject()
            .put("id", user.id).put("username", user.username)
            .put("displayName", user.displayName).put("email", user.email)
            .put("provider", user.provider).put("role", user.role)
            .put("avatarUrl", user.avatarUrl).put("createdAt", user.createdAt)
            .toString()).apply()
    }

    fun clearSession() {
        prefs.edit().remove("token").remove("user").apply()
        api.setToken(null)
        _user.value = null
        _unread.value = 0
    }

    fun setBaseUrl(url: String) {
        val clean = url.trim().trimEnd('/')
        prefs.edit().putString("base_url", clean).apply()
        api.setBaseUrl(clean)
    }

    // ---------- AI provider keys (BYOK) ----------
    fun setProviderKey(provider: String, key: String) {
        prefs.edit().putString("pk_$provider", key).apply()
    }

    fun getProviderKey(provider: String): String? =
        prefs.getString("pk_$provider", null)?.ifBlank { null }

    fun setDefaultProvider(provider: String) {
        prefs.edit().putString("default_provider", provider).apply()
    }

    fun defaultProvider(): String =
        prefs.getString("default_provider", "openai") ?: "openai"

    fun setDefaultModel(model: String) {
        prefs.edit().putString("default_model", model).apply()
    }

    fun defaultModel(): String = prefs.getString("default_model", "") ?: ""

    fun baseUrl(): String = prefs.getString("base_url", ApiClient.DEFAULT_BASE_URL)
        ?: ApiClient.DEFAULT_BASE_URL

    fun setUnread(n: Int) { _unread.value = n }
}
