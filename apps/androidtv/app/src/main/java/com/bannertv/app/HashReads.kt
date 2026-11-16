package com.bannertv.app

import android.os.Process
import org.json.JSONObject
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.ThreadFactory
import java.util.concurrent.atomic.AtomicInteger

/**
 * The page's hash reads, one at a time on a thread of their own at background priority, so the
 * video never waits on them. Only the newest play's read matters: a new request cancels the one
 * in flight. Each answer goes back as a hash event, never with the link. The worker never
 * touches the player, its data source or its headers.
 */
class HashReads(private val reader: StreamHashReader, private val emit: (JSONObject) -> Unit) {
    private val worker: ExecutorService =
        Executors.newSingleThreadExecutor(
            ThreadFactory { task ->
                Thread(
                    {
                        Process.setThreadPriority(Process.THREAD_PRIORITY_BACKGROUND)
                        task.run()
                    },
                    "hash-read",
                )
            },
        )
    private val generation = AtomicInteger(0)

    fun submit(request: HashRequest) {
        val mine = generation.incrementAndGet()
        try {
            worker.execute {
                if (generation.get() != mine) return@execute
                val result = reader.read(request) { generation.get() != mine }
                if (result !is HashResult.Cancelled) {
                    emit(JSONObject(hashEventFields(request.id, result)).put("type", "hash"))
                }
            }
        } catch (e: RejectedExecutionException) {
            // Closed: the activity is going away, and the page with it.
        }
    }

    fun close() {
        generation.incrementAndGet()
        worker.shutdownNow()
    }
}
