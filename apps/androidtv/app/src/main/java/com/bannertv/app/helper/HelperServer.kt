package com.bannertv.app.helper

import com.bannertv.app.Protocol
import java.io.BufferedInputStream
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import java.net.HttpURLConnection
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.ServerSocket
import java.net.Socket
import java.net.SocketException
import java.net.URI
import java.net.URL
import java.net.URLDecoder
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.Semaphore

/**
 * The stream helper's small web server, for TVs on the home network that can't send an add-on's
 * request headers themselves (the LG). Plain JVM, no Android imports, so unit tests run it.
 *
 * - GET /status: who this is, so the TV knows it found the helper.
 * - POST /pair (code=123456): the pairing code for a key.
 * - POST /links (url=…&h.Referer=…, Authorization: Bearer <key>): a stream for a helper link.
 * - POST /forget (Authorization: Bearer <key>): the TV unpaired, so its key stops working.
 * - GET or HEAD /s/<token>/<address>/<name>: the stream, fetched with its headers. Playlists come
 *   back with every address they name pointed at the helper too.
 *
 * Only home-network devices are answered, and only public addresses are fetched. Stream links
 * and headers are never logged.
 */
class HelperServer(
    private val links: StreamLinks,
    private val pairing: Pairing,
    private val userAgent: String,
    private val allowClient: (InetAddress) -> Boolean = AddressRules::isHomeClient,
    private val allowTarget: (InetAddress) -> Boolean = AddressRules::isPublicTarget,
    private val resolve: (String) -> List<InetAddress> = { host -> InetAddress.getAllByName(host).toList() },
) {
    private var server: ServerSocket? = null
    private var pool: ExecutorService? = null
    private val slots = Semaphore(MAX_CONNECTIONS)

    /** The port it listens on, or 0 when stopped. */
    @get:Synchronized
    val port: Int
        get() = server?.localPort ?: 0

    /** Starts listening on every interface, on PORT if free, else any port. */
    @Synchronized
    fun start(preferredPort: Int = PORT) {
        if (server != null) return
        val socket =
            try {
                ServerSocket().apply {
                    reuseAddress = true
                    bind(InetSocketAddress(preferredPort))
                }
            } catch (e: IOException) {
                ServerSocket(0)
            }
        val workers = Executors.newCachedThreadPool()
        server = socket
        pool = workers
        val accept = Thread({ acceptLoop(socket, workers) }, "stream-helper")
        accept.isDaemon = true
        accept.start()
    }

    @Synchronized
    fun stop() {
        try {
            server?.close()
        } catch (e: IOException) {
            // Closing anyway.
        }
        server = null
        pool?.shutdownNow()
        pool = null
        links.clear()
    }

    private fun acceptLoop(socket: ServerSocket, workers: ExecutorService) {
        while (!socket.isClosed) {
            val client =
                try {
                    socket.accept()
                } catch (e: IOException) {
                    return
                }
            if (!allowClient(client.inetAddress) || !slots.tryAcquire()) {
                closeQuietly(client)
                continue
            }
            try {
                workers.execute {
                    try {
                        serve(client)
                    } finally {
                        slots.release()
                        closeQuietly(client)
                    }
                }
            } catch (e: Exception) {
                slots.release()
                closeQuietly(client)
            }
        }
    }

    private fun serve(client: Socket) {
        client.soTimeout = CLIENT_TIMEOUT_MS
        val input = BufferedInputStream(client.getInputStream())
        val output = client.getOutputStream()
        val request =
            try {
                readRequest(input)
            } catch (e: IOException) {
                null
            } ?: return respondText(output, 400, "Bad request")
        try {
            route(request, output)
        } catch (e: SocketException) {
            // The TV hung up (it seeks or stops by closing): nothing to answer.
        } catch (e: IOException) {
            // Same: the connection is gone.
        }
    }

    private fun route(request: Request, output: OutputStream) {
        val path = request.path
        when {
            request.method == "OPTIONS" -> respond(output, 204, emptyMap(), null)
            request.method == "GET" && path == "/status" ->
                respondJson(output, 200, """{"helper":"bannertv","version":$VERSION}""")
            request.method == "POST" && path == "/pair" -> {
                val key = pairing.pair(request.form()["code"])
                if (key == null) {
                    respondText(output, 403, "Wrong code")
                } else {
                    respondJson(output, 200, """{"key":"$key"}""")
                }
            }
            request.method == "POST" && path == "/links" -> addLink(request, output)
            request.method == "POST" && path == "/forget" ->
                if (pairing.forget(bearerKey(request))) {
                    respond(output, 204, emptyMap(), null)
                } else {
                    respondText(output, 401, "Not paired")
                }
            (request.method == "GET" || request.method == "HEAD") && path.startsWith("/s/") ->
                relay(request, output)
            else -> respondText(output, 404, "Not found")
        }
    }

    private fun addLink(request: Request, output: OutputStream) {
        if (!pairing.isPaired(bearerKey(request))) return respondText(output, 401, "Not paired")
        val form = request.form()
        val target = webAddress(form["url"]) ?: return respondText(output, 400, "Bad address")
        val asked = form.filterKeys { it.startsWith("h.") }.mapKeys { it.key.removePrefix("h.") }
        val token = links.add(target, Protocol.requestHeaders(asked))
        respondJson(output, 200, """{"link":"${jsonEscape(linkPath(token, target))}"}""")
    }

    private fun bearerKey(request: Request): String? =
        request.headers["authorization"]?.removePrefix("Bearer ")?.trim()

    private fun relay(request: Request, output: OutputStream) {
        // /s/<token>/<address>[/<name>]: the name is only there for players that look at it.
        val parts = request.path.removePrefix("/s/").split('/')
        val link = links.use(parts.getOrNull(0) ?: "") ?: return respondText(output, 404, "Link expired")
        val decoded = parts.getOrNull(1)?.let(Base64Url::decode)?.toString(Charsets.UTF_8)
        val target = webAddress(decoded) ?: return respondText(output, 400, "Bad address")
        val token = parts[0]

        val connection = open(target, link.headers, request.headers["range"], request.method)
            ?: return respondText(output, 502, "Could not reach the stream")
        try {
            val status = connection.responseCode
            val finalUrl = connection.url.toURI()
            val type = connection.contentType
            if (status == 200 && Playlist.isPlaylist(type, finalUrl)) {
                val text = readLimited(connection.inputStream, MAX_PLAYLIST_BYTES)
                    ?: return respondText(output, 502, "Playlist too large")
                val body = Playlist.rewrite(text.toString(Charsets.UTF_8), finalUrl) { linkPath(token, it) }
                    .toByteArray(Charsets.UTF_8)
                val headers =
                    mapOf("Content-Type" to "application/vnd.apple.mpegurl", "Cache-Control" to "no-cache")
                respond(output, 200, headers, if (request.method == "HEAD") null else body, body.size.toLong())
                return
            }
            val headers = LinkedHashMap<String, String>()
            for (name in PASSED_HEADERS) connection.getHeaderField(name)?.let { headers[name] = it }
            val stream = if (status >= 400) connection.errorStream else connection.inputStream
            writeHead(output, status, headers, null)
            if (request.method != "HEAD" && stream != null) stream.use { it.copyTo(output, BUFFER_BYTES) }
            output.flush()
        } finally {
            connection.disconnect()
        }
    }

    /**
     * Opens the stream with the add-on's headers, following up to MAX_REDIRECTS redirects and
     * checking every address on the way. Null when an address is refused or unreachable.
     */
    private fun open(start: URI, headers: Map<String, String>, range: String?, method: String): HttpURLConnection? {
        var target = start
        repeat(MAX_REDIRECTS + 1) {
            if (!isAllowed(target)) return null
            val connection =
                try {
                    URL(target.toASCIIString()).openConnection() as HttpURLConnection
                } catch (e: Exception) {
                    return null
                }
            connection.instanceFollowRedirects = false
            connection.connectTimeout = CONNECT_TIMEOUT_MS
            connection.readTimeout = READ_TIMEOUT_MS
            connection.requestMethod = if (method == "HEAD") "HEAD" else "GET"
            connection.setRequestProperty("User-Agent", Protocol.userAgent(headers) ?: userAgent)
            // Identity, so playlists arrive as text the helper can rewrite.
            connection.setRequestProperty("Accept-Encoding", "identity")
            for ((name, value) in headers) {
                if (!name.equals("User-Agent", ignoreCase = true)) connection.setRequestProperty(name, value)
            }
            if (range != null && range.none { it == '\r' || it == '\n' }) connection.setRequestProperty("Range", range)
            val status =
                try {
                    connection.responseCode
                } catch (e: IOException) {
                    connection.disconnect()
                    return null
                }
            val location = connection.getHeaderField("Location")
            if (status !in REDIRECTS || location == null) return connection
            connection.disconnect()
            target = webAddress(resolveAgainst(target, location)) ?: return null
        }
        return null
    }

    private fun isAllowed(target: URI): Boolean {
        val host = target.host ?: return false
        val addresses =
            try {
                resolve(host)
            } catch (e: Exception) {
                return false
            }
        return addresses.isNotEmpty() && addresses.all(allowTarget)
    }

    private class Request(
        val method: String,
        val path: String,
        val headers: Map<String, String>,
        val body: ByteArray,
    ) {
        fun form(): Map<String, String> = parseForm(body.toString(Charsets.UTF_8))
    }

    private fun readRequest(input: InputStream): Request? {
        val head = readHead(input) ?: return null
        val lines = head.split("\r\n")
        val requestLine = lines.first().split(' ')
        if (requestLine.size != 3) return null
        val headers = HashMap<String, String>()
        for (line in lines.drop(1)) {
            val colon = line.indexOf(':')
            if (colon > 0) headers[line.substring(0, colon).trim().lowercase()] = line.substring(colon + 1).trim()
        }
        val length = headers["content-length"]?.toIntOrNull() ?: 0
        if (length < 0 || length > MAX_BODY_BYTES) return null
        val body = ByteArray(length)
        var read = 0
        while (read < length) {
            val n = input.read(body, read, length - read)
            if (n < 0) return null
            read += n
        }
        val path = requestLine[1].substringBefore('?')
        return Request(requestLine[0].uppercase(), path, headers, body)
    }

    /** The request line and headers, up to the blank line, or null if too long or cut off. */
    private fun readHead(input: InputStream): String? {
        val bytes = ByteArrayOutputStream()
        var matched = 0
        val end = byteArrayOf('\r'.code.toByte(), '\n'.code.toByte(), '\r'.code.toByte(), '\n'.code.toByte())
        while (matched < 4) {
            val b = input.read()
            if (b < 0 || bytes.size() >= MAX_HEAD_BYTES) return null
            bytes.write(b)
            matched = if (b.toByte() == end[matched]) matched + 1 else if (b.toByte() == end[0]) 1 else 0
        }
        return bytes.toString("ISO-8859-1").removeSuffix("\r\n\r\n")
    }

    private fun respondText(output: OutputStream, status: Int, text: String) {
        val body = text.toByteArray(Charsets.UTF_8)
        respond(output, status, mapOf("Content-Type" to "text/plain; charset=utf-8"), body)
    }

    private fun respondJson(output: OutputStream, status: Int, json: String) {
        val body = json.toByteArray(Charsets.UTF_8)
        respond(output, status, mapOf("Content-Type" to "application/json", "Cache-Control" to "no-store"), body)
    }

    private fun respond(
        output: OutputStream,
        status: Int,
        headers: Map<String, String>,
        body: ByteArray?,
        length: Long = body?.size?.toLong() ?: 0,
    ) {
        writeHead(output, status, headers, length)
        if (body != null) output.write(body)
        output.flush()
    }

    private fun writeHead(output: OutputStream, status: Int, headers: Map<String, String>, length: Long?) {
        val head = StringBuilder("HTTP/1.1 $status ${reason(status)}\r\n")
        // Any page may ask: the TV app runs from its own origin, and only paired TVs get links.
        head.append("Access-Control-Allow-Origin: *\r\n")
        head.append("Access-Control-Allow-Methods: GET, HEAD, POST, OPTIONS\r\n")
        head.append("Access-Control-Allow-Headers: Authorization, Content-Type, Range\r\n")
        head.append("Access-Control-Expose-Headers: Content-Length, Content-Range, Accept-Ranges\r\n")
        head.append("Connection: close\r\n")
        for ((name, value) in headers) head.append(name).append(": ").append(value).append("\r\n")
        if (length != null && headers.keys.none { it.equals("Content-Length", ignoreCase = true) }) {
            head.append("Content-Length: ").append(length).append("\r\n")
        }
        head.append("\r\n")
        output.write(head.toString().toByteArray(Charsets.ISO_8859_1))
    }

    companion object {
        const val PORT: Int = 47020
        const val VERSION: Int = 1
        private const val MAX_CONNECTIONS = 24
        private const val MAX_REDIRECTS = 5
        private const val CLIENT_TIMEOUT_MS = 30_000
        private const val CONNECT_TIMEOUT_MS = 10_000
        private const val READ_TIMEOUT_MS = 20_000
        private const val MAX_HEAD_BYTES = 16 * 1024
        private const val MAX_BODY_BYTES = 32 * 1024
        private const val MAX_PLAYLIST_BYTES = 8 * 1024 * 1024
        private const val BUFFER_BYTES = 64 * 1024
        private val REDIRECTS = setOf(301, 302, 303, 307, 308)
        private val PASSED_HEADERS =
            listOf("Content-Type", "Content-Length", "Content-Range", "Accept-Ranges", "Last-Modified", "ETag")

        /** The helper path for a stream address under a token. */
        fun linkPath(token: String, target: URI): String {
            val name = target.rawPath?.substringAfterLast('/')
                ?.filter { it.isLetterOrDigit() || it == '.' || it == '_' || it == '-' }
                ?.take(64)
                ?.ifEmpty { null } ?: "media"
            return "/s/$token/${Base64Url.encode(target.toString().toByteArray(Charsets.UTF_8))}/$name"
        }

        /** An absolute http or https address with a host, or null. */
        fun webAddress(text: String?): URI? {
            if (text == null) return null
            return try {
                val uri = URI(text.trim())
                val scheme = uri.scheme?.lowercase()
                if ((scheme == "http" || scheme == "https") && !uri.host.isNullOrEmpty()) uri else null
            } catch (e: Exception) {
                null
            }
        }

        fun parseForm(body: String): Map<String, String> =
            body.split('&').filter { it.isNotEmpty() }.associate { pair ->
                val name = pair.substringBefore('=')
                val value = pair.substringAfter('=', "")
                decode(name) to decode(value)
            }

        private fun decode(text: String): String =
            try {
                URLDecoder.decode(text, "UTF-8")
            } catch (e: Exception) {
                ""
            }

        private fun resolveAgainst(base: URI, location: String): String? =
            try {
                base.resolve(URI(location.trim())).toString()
            } catch (e: Exception) {
                null
            }

        private fun readLimited(input: InputStream, max: Int): ByteArray? {
            input.use {
                val out = ByteArrayOutputStream()
                val buffer = ByteArray(BUFFER_BYTES)
                while (true) {
                    val n = it.read(buffer)
                    if (n < 0) return out.toByteArray()
                    out.write(buffer, 0, n)
                    if (out.size() > max) return null
                }
            }
        }

        private fun jsonEscape(text: String): String =
            buildString {
                for (ch in text) {
                    when {
                        ch == '"' -> append("\\\"")
                        ch == '\\' -> append("\\\\")
                        ch < ' ' -> append(String.format("\\u%04x", ch.code))
                        else -> append(ch)
                    }
                }
            }

        private fun reason(status: Int): String =
            when (status) {
                200 -> "OK"
                204 -> "No Content"
                206 -> "Partial Content"
                400 -> "Bad Request"
                401 -> "Unauthorized"
                403 -> "Forbidden"
                404 -> "Not Found"
                416 -> "Range Not Satisfiable"
                502 -> "Bad Gateway"
                else -> "Status"
            }

        private fun closeQuietly(socket: Socket) {
            try {
                socket.close()
            } catch (e: IOException) {
                // Already gone.
            }
        }
    }
}
