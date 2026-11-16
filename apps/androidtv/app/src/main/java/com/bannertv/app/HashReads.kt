package com.bannertv.app

import android.os.Process
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.ThreadFactory
import java.util.concurrent.atomic.AtomicInteger

/**
 * The page's hash reads, one at a time on a thread of their own at background priority, so the
 * video never waits on them. Only the newest play's read matters: a new request cancels the one
 * in flight, and a read that ends after a newer request came never answers. Each answer goes
 * back as the hash event's fields (hashEventFields), never with the link. The worker never
 * touches the player, its data source or its headers.
 */
class HashReads(
    private val read: (HashRequest, () -> Boolean) -> HashResult,
    private val emit: (Map<String, Any>) -> Unit,
) {
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
                val result = read(request) { generation.get() != mine }
                // Past its last check when a newer request came: the page no longer waits for
                // it, and after a reload its id may be the new page's.
                if (result is HashResult.Cancelled || generation.get() != mine) return@execute
                emit(hashEventFields(request.id, result))
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
