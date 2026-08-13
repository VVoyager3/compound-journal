package com.compoundjournal.app

import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL

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

    fun analyze(text: String, images: List<Pair<String, String>>, habits: List<Habit>): JSONObject =
        post("/api/analyze", JSONObject().apply {
            put("text", text)
            put("images", JSONArray(images.map { (name, dataUrl) ->
                JSONObject().put("name", name).put("dataUrl", dataUrl)
            }))
            put("habits", JSONArray(habits.map(Habit::name)))
        }).getJSONObject("entry")

    fun review(entries: List<JournalEntry>): JSONObject = post("/api/review", JSONObject().apply {
        put("entries", JSONArray(entries.map { JSONObject(it.json) }))
    }).getJSONObject("review")

    fun chat(entry: JSONObject, message: String): String = post("/api/chat", JSONObject().apply {
        put("entry", entry)
        put("history", entry.optJSONArray("chat") ?: JSONArray())
        put("message", message)
    }).getString("answer")

    private fun post(path: String, body: JSONObject): JSONObject {
        val connection = URL("${BuildConfig.API_BASE_URL}$path").openConnection() as HttpURLConnection
        return try {
            connection.requestMethod = "POST"
            connection.connectTimeout = 15_000
            connection.readTimeout = 90_000
            connection.doOutput = true
            connection.setRequestProperty("Content-Type", "application/json")
            connection.outputStream.use { it.write(body.toString().toByteArray()) }
            val stream = if (connection.responseCode in 200..299) connection.inputStream else connection.errorStream
            val response = stream?.bufferedReader()?.use { it.readText() }.orEmpty()
            val json = runCatching { JSONObject(response) }.getOrElse { JSONObject() }
            if (connection.responseCode !in 200..299) {
                throw IOException(json.optString("error", "请求失败（${connection.responseCode}）"))
            }
            json
        } finally {
            connection.disconnect()
        }
    }
}
