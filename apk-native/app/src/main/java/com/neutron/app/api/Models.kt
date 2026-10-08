package com.neutron.app.api

/** Subset of the NEUTRON backend user object (passwordHash never sent). */
data class User(
    val id: String,
    val username: String,
    val displayName: String,
    val email: String?,
    val provider: String,
    val role: String,
    val avatarUrl: String?,
    val createdAt: Long,
)

data class AuthResult(val user: User, val token: String)

data class Announcement(
    val notificationId: String,
    val title: String,
    val message: String,
    val type: String,
    val read: Boolean,
    val createdAt: Long,
)

data class Connection(
    val id: String,
    val username: String,
    val displayName: String,
    val status: String,
)

data class AdminStats(
    val totalUsers: Int,
    val activeUsers: Int,
    val notificationsSent: Int,
    val sentToday: Int,
)

data class AdminUser(
    val id: String,
    val username: String,
    val displayName: String,
    val email: String?,
    val role: String,
    val createdAt: Long,
)

fun org.json.JSONObject.toUser(): User = User(
    id = getString("id"),
    username = getString("username"),
    displayName = optString("displayName", ""),
    email = if (isNull("email")) null else optString("email"),
    provider = optString("provider", ""),
    role = optString("role", "user"),
    avatarUrl = if (isNull("avatarUrl")) null else optString("avatarUrl"),
    createdAt = optLong("createdAt", 0),
)

fun org.json.JSONObject.toAnnouncement(): Announcement = Announcement(
    notificationId = getString("notificationId"),
    title = getString("title"),
    message = getString("message"),
    type = optString("type", "information"),
    read = optBoolean("read", false),
    createdAt = optLong("createdAt", 0),
)
