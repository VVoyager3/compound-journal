package com.compoundjournal.app

import android.util.Base64
import android.util.Base64OutputStream
import kotlinx.coroutines.Dispatchers
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.io.OutputStream
import java.net.HttpURLConnection
import java.net.URL
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import kotlinx.coroutines.suspendCancellableCoroutine

object ApiClient {
    enum class ConnectionState { Connected, Unconfigured, Offline }

    fun health(): ConnectionState {
        val connection = URL("${BuildConfig.API_BASE_URL}/api/health").openConnection() as HttpURLConnection
        return try {
            connection.connectTimeout = 3_000
            connection.readTimeout = 3_000
            if (connection.responseCode !in 200..299) ConnectionState.Offline else {
                val body = connection.inputStream.bufferedReader().use { it.readText() }
                if (JSONObject(body).optBoolean("configured")) ConnectionState.Connected else ConnectionState.Unconfigured
            }
        } catch (_: IOException) {
            ConnectionState.Offline
        } catch (_: RuntimeException) {
            ConnectionState.Offline
        } finally {
            connection.disconnect()
        }
    }

    internal suspend fun analyze(text: String, images: List<PendingImage>, habits: List<Habit>): JSONObject =
        request("/api/analyze") { output ->
            output.writeUtf8("{\"text\":")
            output.writeJsonString(text)
            output.writeUtf8(",\"images\":[")
            images.forEachIndexed { index, image ->
                if (index > 0) output.writeUtf8(",")
                output.writeUtf8("{\"name\":")
                output.writeJsonString(image.name)
                output.writeUtf8(",\"dataUrl\":\"data:image/jpeg;base64,")
                Base64OutputStream(output, Base64.NO_WRAP or Base64.NO_CLOSE).use { encoded ->
                    image.file.inputStream().use { it.copyTo(encoded) }
                }
                output.writeUtf8("\"}")
            }
            output.writeUtf8("],\"habits\":[")
            habits.forEachIndexed { index, habit ->
                if (index > 0) output.writeUtf8(",")
                output.writeJsonString(habit.name)
            }
            output.writeUtf8("]}")
        }.getJSONObject("entry")

    suspend fun review(entries: List<JournalEntry>): JSONObject = post("/api/review", JSONObject().apply {
        put("entries", JSONArray(entries.map { JSONObject(it.json) }))
    }).getJSONObject("review")

    suspend fun chat(entry: JSONObject, message: String): String = post("/api/chat", JSONObject().apply {
        put("entry", entry)
        put("history", entry.optJSONArray("chat") ?: JSONArray())
        put("message", message)
    }).getString("answer")

    private suspend fun post(path: String, body: JSONObject): JSONObject =
        request(path) { it.writeUtf8(body.toString()) }

    private suspend fun request(path: String, writeBody: (OutputStream) -> Unit): JSONObject =
        suspendCancellableCoroutine { continuation ->
        val connection = URL("${BuildConfig.API_BASE_URL}$path").openConnection() as HttpURLConnection
        continuation.invokeOnCancellation { connection.disconnect() }
        Dispatchers.IO.dispatch(continuation.context) {
            try {
                if (!continuation.isActive) return@dispatch
                connection.requestMethod = "POST"
                connection.connectTimeout = 15_000
                connection.readTimeout = 90_000
                connection.doOutput = true
                connection.setChunkedStreamingMode(8 * 1024)
                connection.setRequestProperty("Content-Type", "application/json")
                connection.connect()
                if (!continuation.isActive) return@dispatch
                connection.outputStream.buffered().use(writeBody)
                val code = connection.responseCode
                val stream = if (code in 200..299) connection.inputStream else connection.errorStream
                val response = stream?.bufferedReader()?.use { it.readText() }.orEmpty()
                val json = runCatching { JSONObject(response) }.getOrElse { JSONObject() }
                if (code !in 200..299) {
                    throw IOException(json.optString("error", "请求失败（$code）"))
                }
                if (continuation.isActive) continuation.resume(json)
            } catch (failure: Throwable) {
                if (continuation.isActive) continuation.resumeWithException(failure)
            } finally {
                connection.disconnect()
            }
        }
    }
}

private fun OutputStream.writeUtf8(value: String) {
    write(value.toByteArray(Charsets.UTF_8))
}

private fun OutputStream.writeJsonString(value: String) {
    writeUtf8(JSONObject.quote(value))
}
