package com.projectirl

import android.graphics.Color
import android.os.Build
import androidx.core.view.WindowCompat
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.UiThreadUtil
import com.facebook.react.uimanager.ViewManager

/**
 * Colours Android's system navigation bar to match the screen behind it.
 * On iOS the app draws under the home indicator; without this Android shows a
 * black strip under every screen. Called from src/services/systemBars.js.
 */
class SystemBarsModule(context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
  override fun getName() = NAME

  /** [color] is "#RRGGBB" or "#AARRGGBB"; [lightBackground] picks dark icons. */
  @ReactMethod
  fun setNavigationBar(color: String, lightBackground: Boolean) {
    val activity = reactApplicationContext.currentActivity ?: return
    UiThreadUtil.runOnUiThread {
      try {
        val window = activity.window
        window.navigationBarColor = Color.parseColor(color)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) window.isNavigationBarContrastEnforced = false
        WindowCompat.getInsetsController(window, window.decorView).isAppearanceLightNavigationBars = lightBackground
      } catch (_: Exception) {
        // A bad colour string must never crash the app.
      }
    }
  }

  companion object {
    const val NAME = "ComeOverSystemBars"
  }
}

class SystemBarsPackage : ReactPackage {
  override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> = listOf(SystemBarsModule(reactContext))

  override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> = emptyList()
}
