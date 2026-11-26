package com.bannertv.app

/**
 * The remote keys the WebView never passes to the page, mapped to the names in the protocol.
 * The values are Android's KeyEvent key codes, written out so this runs in a plain JVM test.
 */
object RemoteKeys {
    const val KEYCODE_HEADSETHOOK: Int = 79
    const val KEYCODE_MEDIA_PLAY_PAUSE: Int = 85
    const val KEYCODE_MEDIA_STOP: Int = 86
    const val KEYCODE_MEDIA_REWIND: Int = 89
    const val KEYCODE_MEDIA_FAST_FORWARD: Int = 90
    const val KEYCODE_MEDIA_PLAY: Int = 126
    const val KEYCODE_MEDIA_PAUSE: Int = 127
    const val KEYCODE_PROG_RED: Int = 183
    const val KEYCODE_PROG_GREEN: Int = 184
    const val KEYCODE_PROG_YELLOW: Int = 185
    const val KEYCODE_PROG_BLUE: Int = 186
    const val KEYCODE_DPAD_CENTER: Int = 23
    const val KEYCODE_ENTER: Int = 66
    const val KEYCODE_NUMPAD_ENTER: Int = 160
    const val KEYCODE_BUTTON_A: Int = 96

    /**
     * The protocol name for a key the activity intercepts, or null to let the WebView have it
     * (D-pad, Enter and digits reach the page as ordinary key codes).
     */
    fun nameFor(keyCode: Int): String? = when (keyCode) {
        KEYCODE_MEDIA_PLAY_PAUSE, KEYCODE_HEADSETHOOK -> "MediaPlayPause"
        KEYCODE_MEDIA_PLAY -> "MediaPlay"
        KEYCODE_MEDIA_PAUSE -> "MediaPause"
        KEYCODE_MEDIA_STOP -> "MediaStop"
        KEYCODE_MEDIA_FAST_FORWARD -> "MediaFastForward"
        KEYCODE_MEDIA_REWIND -> "MediaRewind"
        KEYCODE_PROG_RED -> "Red"
        KEYCODE_PROG_GREEN -> "Green"
        KEYCODE_PROG_YELLOW -> "Yellow"
        KEYCODE_PROG_BLUE -> "Blue"
        else -> null
    }

    /**
     * Whether the key is OK: the keys after which the activity asks for the keyboard when the
     * page has put the focus in a text box (MainActivity.offerKeyboard).
     */
    fun isOk(keyCode: Int): Boolean = when (keyCode) {
        KEYCODE_DPAD_CENTER, KEYCODE_ENTER, KEYCODE_NUMPAD_ENTER, KEYCODE_BUTTON_A -> true
        else -> false
    }
}
