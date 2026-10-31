package com.bannertv.app

/**
 * Maps Media3 PlaybackException error codes to the protocol's error kinds. The codes are
 * PlaybackException.ERROR_CODE_* values, written out so this runs in a plain JVM test.
 */
object PlayerErrors {
    const val FORMAT: String = "format"
    const val NETWORK: String = "network"
    const val DECODE: String = "decode"
    const val OTHER: String = "other"

    /** ERROR_CODE_BEHIND_LIVE_WINDOW: recovered natively, never reported. */
    const val BEHIND_LIVE_WINDOW: Int = 1002

    fun recoversNatively(code: Int): Boolean = code == BEHIND_LIVE_WINDOW

    fun kind(code: Int): String = when (code) {
        in 2000..2999 -> NETWORK
        // Malformed container or manifest: the file is damaged rather than unsupported.
        3001, 3002 -> DECODE
        3003, 3004 -> FORMAT
        // Decoder init, query and decoding failures.
        4001, 4002, 4003 -> DECODE
        // Beyond the decoder's capabilities, or not supported at all.
        4004, 4005 -> FORMAT
        // Audio track init and write: usually an encoding the output cannot take.
        5001, 5002 -> FORMAT
        in 6000..6999 -> FORMAT
        else -> OTHER
    }

    /** The protocol's detail string, for example "ERROR_CODE_IO_BAD_HTTP_STATUS (2004)". */
    fun detail(codeName: String, code: Int): String = "$codeName ($code)"

    /** A short message for the viewer. Built here rather than taken from the exception, which can carry the URL. */
    fun message(kind: String, httpStatus: Int?): String = when (kind) {
        NETWORK ->
            if (httpStatus != null) {
                "The server refused the stream (HTTP $httpStatus)."
            } else {
                "The stream could not be loaded. Check the connection and try again."
            }
        DECODE -> "This device could not decode the video."
        FORMAT -> "This device cannot play this format."
        else -> "Playback failed."
    }
}
