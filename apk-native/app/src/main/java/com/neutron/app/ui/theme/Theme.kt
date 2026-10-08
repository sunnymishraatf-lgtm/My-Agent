package com.neutron.app.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

// NEUTRON brand: warm clay accent (matches the web claymorphism default).
private val Clay = Color(0xFFCC8066)
private val ClayDark = Color(0xFFA85F42)

private val LightColors = lightColorScheme(
    primary = ClayDark,
    onPrimary = Color.White,
    primaryContainer = Color(0xFFFFE9DF),
    onPrimaryContainer = Color(0xFF4A2A1C),
    secondary = Color(0xFF7A5C4D),
    surface = Color(0xFFFFFBF8),
    onSurface = Color(0xFF1F1B16),
)

private val DarkColors = darkColorScheme(
    primary = Clay,
    onPrimary = Color(0xFF2B150C),
    primaryContainer = Color(0xFF5A3423),
    onPrimaryContainer = Color(0xFFFFE9DF),
    secondary = Color(0xFFD8BCA8),
    surface = Color(0xFF161210),
    onSurface = Color(0xFFF5EDE6),
)

@Composable
fun NeutronTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    content: @Composable () -> Unit,
) {
    MaterialTheme(
        colorScheme = if (darkTheme) DarkColors else LightColors,
        content = content,
    )
}
