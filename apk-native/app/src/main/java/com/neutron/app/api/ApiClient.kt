package com.neutron.app.api

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedReader
import java.io.InputStreamReader
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder

/** Minimal NEUTRON backend client over HttpURLConnection. No extra deps. */
class ApiClient(private var baseUrl: String, private var token: String? = null) {

    fun setToken(t: String?) { token = t }
    fun setBaseUrl(u: String) { baseUrl = u.trimEnd('/') }

    class ApiException(val status: Int, message: String) : Exception(message)

    private suspend fun request(
        method: String,
        path: String,
        query: Map<String, String> = emptyMap(),
        body: JSONObject? = null,
    ): JSONObject = withContext(Dispatchers.IO) {
        val qs = if (query.isEmpty()) "" else "?" + query.entries.joinToString("&") {
            "${URLEncoder.encode(it.key, "UTF-8")}=${URLEncoder.encode(it.value, "UTF-8")}"
        }
        val url = URL("$baseUrl$path$qs")
        val conn = (url.openConnection() as HttpURLConnection).apply {
            requestMethod = method
            connectTimeout = 20000
            readTimeout = 25000
            setRequestProperty("Accept", "application/json")
            setRequestProperty("Content-Type", "application/json; charset=utf-8")
            token?.let { setRequestProperty("Authorization", "Bearer $it") }
            if (body != null) {
                doOutput = true
                outputStream.bufferedWriter(Charsets.UTF_8).use { it.write(body.toString()) }
            }
        }
        val code = conn.responseCode
        val stream = if (code in 200..299) conn.inputStream else conn.errorStream
        val text = stream?.let {
            BufferedReader(InputStreamReader(it, Charsets.UTF_8)).readText()
        } ?: ""
        conn.disconnect()
        val json = try { JSONObject(text) } catch (_: Exception) { JSONObject() }
        if (code !in 200..299) {
            val msg = json.optString("error", "Request failed ($code)")
            throw ApiException(code, msg)
        }
        if (!json.optBoolean("ok", true)) {
            throw ApiException(code, json.optString("error", "Request failed"))
        }
        json
    }

    private fun pagedArray(json: JSONObject, key: String): List<JSONObject> {
        val out = mutableListOf<JSONObject>()
        val arr: JSONArray = json.optJSONArray(key) ?: JSONArray()
        for (i in 0 until arr.length()) out.add(arr.getJSONObject(i))
        // Some endpoints return {items:[...]}, others a bare list key.
        return out
    }

    // ---------- auth ----------
    suspend fun guestLogin(): AuthResult {
        val j = request("POST", "/api/auth/guest", body = JSONObject())
        return AuthResult(j.getJSONObject("user").toUser(), j.getString("token"))
    }

    suspend fun emailLogin(login: String, password: String): AuthResult {
        val j = request("POST", "/api/auth/login", body = JSONObject()
            .put("login", login).put("password", password))
        return AuthResult(j.getJSONObject("user").toUser(), j.getString("token"))
    }

    suspend fun register(email: String, password: String, username: String): AuthResult {
        val j = request("POST", "/api/auth/register", body = JSONObject()
            .put("email", email).put("password", password).put("username", username))
        return AuthResult(j.getJSONObject("user").toUser(), j.getString("token"))
    }

    suspend fun googleLogin(idToken: String): AuthResult {
        val j = request("POST", "/api/auth/google", body = JSONObject().put("idToken", idToken))
        return AuthResult(j.getJSONObject("user").toUser(), j.getString("token"))
    }

    suspend fun me(): User {
        return request("GET", "/api/auth/me").getJSONObject("user").toUser()
    }

    suspend fun logout() {
        try { request("POST", "/api/auth/logout") } catch (_: Exception) { /* best effort */ }
    }

    // ---------- notifications ----------
    suspend fun announcements(limit: Int = 50): List<Announcement> {
        val j = request("GET", "/api/notifications", query = mapOf("limit" to limit.toString()))
        return pagedArray(j, "items").map { it.toAnnouncement() }
    }

    suspend fun unreadCount(): Int {
        return request("GET", "/api/notifications/unread-count").optInt("count", 0)
    }

    suspend fun markRead(notificationId: String) {
        request("POST", "/api/notifications/$notificationId/read")
    }

    suspend fun markAllRead() {
        request("POST", "/api/notifications/read-all")
    }

    suspend fun deleteAnnouncement(notificationId: String) {
        request("DELETE", "/api/notifications/$notificationId")
    }

    // ---------- connections ----------
    suspend fun connections(): List<Connection> {
        val j = request("GET", "/api/connections")
        return pagedArray(j, "connections").map {
            Connection(
                id = it.getString("id"),
                username = it.optString("username", ""),
                displayName = it.optString("displayName", ""),
                status = it.optString("status", ""),
            )
        }
    }

    // ---------- admin ----------
    suspend fun adminStats(): AdminStats {
        val s = request("GET", "/api/admin/stats").getJSONObject("stats")
        return AdminStats(
            totalUsers = s.optInt("totalUsers", 0),
            activeUsers = s.optInt("activeUsers", 0),
            notificationsSent = s.optInt("notificationsSent", 0),
            sentToday = s.optInt("sentToday", 0),
        )
    }

    suspend fun adminUsers(search: String = ""): List<AdminUser> {
        val q = if (search.isBlank()) emptyMap() else mapOf("search" to search)
        val j = request("GET", "/api/admin/users", query = q)
        return pagedArray(j, "users").map {
            AdminUser(
                id = it.getString("id"),
                username = it.getString("username"),
                displayName = it.optString("displayName", ""),
                email = if (it.isNull("email")) null else it.optString("email"),
                role = it.optString("role", "user"),
                createdAt = it.optLong("createdAt", 0),
            )
        }
    }

    suspend fun adminDeleteUser(userId: String): String {
        val j = request("DELETE", "/api/admin/users/$userId")
        return j.optString("message", "User deleted.")
    }

    suspend fun adminSendNotification(
        title: String, message: String, type: String, audience: String,
        userIds: List<String> = emptyList(),
    ): String {
        val b = JSONObject()
            .put("title", title).put("message", message)
            .put("type", type).put("audience", audience)
        if (audience == "specific") b.put("userIds", JSONArray(userIds))
        val j = request("POST", "/api/admin/notifications", body = b)
        return j.optString("message", "Sent.")
    }

    suspend fun adminDeleteNotification(notificationId: String) {
        request("DELETE", "/api/admin/notifications/$notificationId")
    }

    companion object {
        const val DEFAULT_BASE_URL = "https://neutron-server.onrender.com"
    }
}
