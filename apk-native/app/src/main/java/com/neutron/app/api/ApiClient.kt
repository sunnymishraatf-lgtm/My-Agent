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

    // ---------- chat ----------
    data class ChatReply(val text: String, val model: String?)

    suspend fun chat(
        messages: List<Pair<String, String>>,
        provider: String?, model: String?, apiKey: String?,
    ): ChatReply {
        val arr = JSONArray()
        for ((role, content) in messages) {
            arr.put(JSONObject().put("role", role).put("content", content))
        }
        val b = JSONObject().put("messages", arr)
        if (!provider.isNullOrBlank()) b.put("provider", provider)
        if (!model.isNullOrBlank()) b.put("model", model)
        if (!apiKey.isNullOrBlank()) b.put("apiKey", apiKey)
        val j = request("POST", "/api/chat", body = b)
        // Response shape: { ok, message: { content } } or { ok, reply/text }.
        val msg = j.optJSONObject("message")
        val text = msg?.optString("content")
            ?: j.optString("reply").ifBlank { j.optString("text") }
        return ChatReply(text, j.optString("model", null))
    }

    // ---------- terminal ----------
    data class TermSession(val id: String, val label: String, val state: String)

    suspend fun termSessions(): List<TermSession> {
        val j = request("GET", "/api/terminal/sessions")
        return pagedArray(j, "sessions").map {
            TermSession(
                it.optString("id", ""), it.optString("label", it.optString("id", "")),
                it.optString("state", it.optString("status", "")),
            )
        }
    }

    suspend fun termCreate(label: String): TermSession {
        val j = request("POST", "/api/terminal/sessions",
            body = JSONObject().put("label", label))
        val s = j.optJSONObject("session") ?: j
        return TermSession(s.optString("id", ""), s.optString("label", label),
            s.optString("state", s.optString("status", "")))
    }

    data class TermOutput(val lines: List<String>, val cursor: Long, val state: String)

    suspend fun termOutput(id: String, since: Long): TermOutput {
        val j = request("GET", "/api/terminal/sessions/$id/output",
            query = mapOf("since" to since.toString()))
        val lines = mutableListOf<String>()
        val arr = j.optJSONArray("lines") ?: j.optJSONArray("output") ?: JSONArray()
        for (i in 0 until arr.length()) lines.add(arr.optString(i))
        return TermOutput(lines, j.optLong("cursor", j.optLong("since", since)),
            j.optString("state", j.optString("status", "")))
    }

    suspend fun termInput(id: String, data: String) {
        request("POST", "/api/terminal/sessions/$id/input",
            body = JSONObject().put("data", data))
    }

    suspend fun termDelete(id: String) {
        request("DELETE", "/api/terminal/sessions/$id")
    }

    // ---------- music ----------
    data class Track(val id: String, val title: String, val artist: String?)

    suspend fun musicSearch(q: String): List<Track> {
        val j = request("POST", "/api/chat",
            body = JSONObject().put("action", "music-search").put("q", q))
        return pagedArray(j, "results").map {
            Track(it.optString("id", ""), it.optString("title", ""),
                it.optString("artist", null))
        }
    }

    // ---------- agent ----------
    data class AgentRun(
        val id: String, val goal: String, val status: String,
        val log: String, val approvals: List<Approval>,
    )
    data class Approval(val id: String, val summary: String)

    private fun JSONObject.toAgentRun(): AgentRun {
        val apprs = mutableListOf<Approval>()
        val arr = optJSONArray("approvals") ?: optJSONArray("pendingApprovals") ?: JSONArray()
        for (i in 0 until arr.length()) {
            val a = arr.getJSONObject(i)
            apprs.add(Approval(a.optString("id", ""), a.optString("summary", a.optString("description", ""))))
        }
        // Log can be a string or an array of lines/entries.
        val logRaw = opt("log") ?: opt("output") ?: ""
        val log = when (logRaw) {
            is JSONArray -> (0 until logRaw.length()).joinToString("\n") { logRaw.optString(it) }
            else -> logRaw.toString()
        }
        return AgentRun(
            id = optString("id", ""), goal = optString("goal", ""),
            status = optString("status", ""), log = log, approvals = apprs,
        )
    }

    suspend fun agentRuns(): List<AgentRun> {
        val j = request("GET", "/api/agent/runs")
        return pagedArray(j, "runs").map { it.toAgentRun() }
    }

    suspend fun agentCreate(goal: String, provider: String?, model: String?, apiKey: String?): AgentRun {
        val b = JSONObject().put("goal", goal)
        if (!provider.isNullOrBlank()) b.put("provider", provider)
        if (!model.isNullOrBlank()) b.put("model", model)
        if (!apiKey.isNullOrBlank()) b.put("apiKey", apiKey)
        val j = request("POST", "/api/agent/runs", body = b)
        return (j.optJSONObject("run") ?: j).toAgentRun()
    }

    suspend fun agentGet(id: String): AgentRun {
        val j = request("GET", "/api/agent/runs/$id")
        return (j.optJSONObject("run") ?: j).toAgentRun()
    }

    suspend fun agentStop(id: String) {
        request("POST", "/api/agent/runs/$id/stop")
    }

    suspend fun agentDecide(runId: String, approvalId: String, approved: Boolean) {
        request("POST", "/api/agent/runs/$runId/approvals/$approvalId",
            body = JSONObject().put("approved", approved))
    }

    companion object {
        const val DEFAULT_BASE_URL = "https://neutron-server.onrender.com"
    }
}
