package com.compoundjournal.app

import android.app.Application
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.provider.OpenableColumns
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.File
import java.time.LocalDate
import java.time.OffsetDateTime
import java.time.ZoneId
import java.util.UUID

internal data class PendingImage(val name: String, val file: File)

internal data class CompletedAnalysis(
    val entry: JournalEntry,
    val submittedDraft: String,
)

class JournalViewModel(application: Application) : AndroidViewModel(application) {
    val dao: JournalDao = JournalDatabase.get(application).dao()
    private val imageDir = File(application.cacheDir, "pending-journal-images")
    private var reviewLoadJob: Job? = null

    internal var images by mutableStateOf<List<PendingImage>>(emptyList())
        private set
    var imageBusy by mutableStateOf(false)
        private set
    var imageError by mutableStateOf("")
        private set

    var analyzeBusy by mutableStateOf(false)
        private set
    var analyzeError by mutableStateOf("")
        private set
    internal var completedAnalysis by mutableStateOf<CompletedAnalysis?>(null)
        private set

    var chatBusyEntryId by mutableStateOf<String?>(null)
        private set
    var chatErrorEntryId by mutableStateOf<String?>(null)
        private set
    var chatError by mutableStateOf("")
        private set
    var chatDraftEntryId by mutableStateOf<String?>(null)
        private set
    var chatDraft by mutableStateOf("")
        private set

    var reviewEntryIds by mutableStateOf("")
        private set
    var reviewJson by mutableStateOf<String?>(null)
        private set
    var reviewBusyEntryIds by mutableStateOf<String?>(null)
        private set
    var reviewErrorEntryIds by mutableStateOf<String?>(null)
        private set
    var reviewError by mutableStateOf("")
        private set

    init {
        imageDir.mkdirs()
        imageDir.listFiles()?.forEach(File::delete)
    }

    fun addImages(uris: List<Uri>) {
        if (imageBusy || analyzeBusy || images.size >= 12) return
        val selected = uris.take(12 - images.size)
        if (selected.isEmpty()) return
        imageBusy = true
        imageError = ""
        viewModelScope.launch {
            try {
                val added = withContext(Dispatchers.IO) {
                    selected.mapNotNull { uri -> createPendingImage(getApplication(), uri, imageDir) }
                }
                images = images + added
                if (added.size < selected.size) {
                    imageError = "部分图片无法读取、超过 20MB 或压缩失败。"
                }
            } finally {
                imageBusy = false
            }
        }
    }

    fun removeImage(index: Int) {
        if (imageBusy || analyzeBusy) return
        val image = images.getOrNull(index) ?: return
        images = images - image
        viewModelScope.launch(Dispatchers.IO) { image.file.delete() }
    }

    fun analyze(text: String, habits: List<Habit>, today: LocalDate) {
        if (analyzeBusy || imageBusy || (text.isBlank() && images.isEmpty())) return
        val submittedDraft = text
        val submittedText = text.trim()
        val submittedImages = images
        val submittedHabits = habits.toList()
        analyzeBusy = true
        analyzeError = ""
        completedAnalysis = null
        viewModelScope.launch {
            try {
                val json = ApiClient.analyze(submittedText, submittedImages, submittedHabits)
                val entry = json.toEntry()
                val entryDate = entryLocalDate(entry.createdAt, ZoneId.systemDefault()) ?: today
                val automaticCheckIns = json.optJSONArray("checkIns").toCheckIns(submittedHabits, entryDate)
                dao.saveAnalysis(entry, automaticCheckIns)
                images = images.filterNot { it in submittedImages }
                withContext(Dispatchers.IO) { submittedImages.forEach { it.file.delete() } }
                completedAnalysis = CompletedAnalysis(entry, submittedDraft)
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (failure: Throwable) {
                analyzeError = failure.message ?: "整理失败"
            } finally {
                analyzeBusy = false
            }
        }
    }

    fun acknowledgeAnalysis(entryId: String) {
        if (completedAnalysis?.entry?.id == entryId) completedAnalysis = null
    }

    fun chat(entry: JournalEntry, message: String) {
        if (chatBusyEntryId != null || message.isBlank()) return
        val entryId = entry.id
        chatBusyEntryId = entryId
        chatErrorEntryId = null
        chatError = ""
        viewModelScope.launch {
            try {
                val json = JSONObject(entry.json)
                val answer = ApiClient.chat(json, message)
                val chat = json.optJSONArray("chat") ?: JSONArray().also { json.put("chat", it) }
                chat.put(JSONObject().put("role", "user").put("content", message))
                chat.put(JSONObject().put("role", "assistant").put("content", answer))
                if (dao.updateEntry(json.toEntry()) > 0 && chatDraftEntryId == entryId && chatDraft.trim() == message) {
                    chatDraft = ""
                }
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (failure: Throwable) {
                chatErrorEntryId = entryId
                chatError = failure.message ?: "追问失败"
            } finally {
                chatBusyEntryId = null
            }
        }
    }

    fun setChatDraft(entryId: String, value: String) {
        chatDraftEntryId = entryId
        chatDraft = value.take(2_000)
    }

    fun loadReview(entryIds: String) {
        if (entryIds.isBlank()) {
            reviewLoadJob?.cancel()
            reviewEntryIds = ""
            reviewJson = null
            return
        }
        if (reviewEntryIds == entryIds) return
        reviewLoadJob?.cancel()
        reviewEntryIds = entryIds
        reviewJson = null
        reviewErrorEntryIds = null
        reviewError = ""
        reviewLoadJob = viewModelScope.launch {
            val cached = dao.review(entryIds)?.json
            if (reviewEntryIds == entryIds) reviewJson = cached
        }
    }

    fun generateReview(entries: List<JournalEntry>) {
        val entryIds = entries.joinToString("|") { it.id }
        if (entryIds.isBlank() || reviewBusyEntryIds != null) return
        reviewLoadJob?.cancel()
        reviewEntryIds = entryIds
        reviewBusyEntryIds = entryIds
        reviewErrorEntryIds = null
        reviewError = ""
        viewModelScope.launch {
            try {
                val value = ApiClient.review(entries)
                if (reviewEntryIds == entryIds) {
                    dao.saveReview(WeeklyReview(entryIds, OffsetDateTime.now().toString(), value.toString()))
                    reviewJson = value.toString()
                }
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (failure: Throwable) {
                reviewErrorEntryIds = entryIds
                reviewError = failure.message ?: "复盘失败"
            } finally {
                reviewBusyEntryIds = null
            }
        }
    }

    override fun onCleared() {
        imageDir.listFiles()?.forEach(File::delete)
        super.onCleared()
    }
}

private fun JSONArray?.toCheckIns(habits: List<Habit>, today: LocalDate): List<CheckIn> {
    if (this == null) return emptyList()
    return habits.mapNotNull { habit ->
        val completed = (0 until length()).any { index ->
            val item = optJSONObject(index)
            item?.optString("name") == habit.name && item.optString("status") == "completed"
        }
        if (completed) CheckIn(habit.id, today.toString()) else null
    }
}

private fun createPendingImage(application: Application, uri: Uri, imageDir: File): PendingImage? = runCatching {
    val resolver = application.contentResolver
    val size = resolver.query(uri, arrayOf(OpenableColumns.SIZE), null, null, null)?.use { cursor ->
        if (cursor.moveToFirst() && !cursor.isNull(0)) cursor.getLong(0) else null
    }
    require(size == null || size <= 20L * 1024 * 1024) { "图片超过 20MB" }

    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    resolver.openInputStream(uri)!!.use { BitmapFactory.decodeStream(it, null, bounds) }
    require(bounds.outWidth > 0 && bounds.outHeight > 0) { "无法读取图片" }
    var sample = 1
    while (bounds.outWidth / sample > 3_200 || bounds.outHeight / sample > 3_200) sample *= 2
    val decoded = resolver.openInputStream(uri)!!.use {
        BitmapFactory.decodeStream(it, null, BitmapFactory.Options().apply { inSampleSize = sample })
    } ?: error("无法解码图片")
    val scale = minOf(1f, 1_600f / maxOf(decoded.width, decoded.height))
    val bitmap = if (scale < 1f) {
        Bitmap.createScaledBitmap(decoded, (decoded.width * scale).toInt(), (decoded.height * scale).toInt(), true)
            .also { decoded.recycle() }
    } else decoded

    val output = ByteArrayOutputStream()
    var quality = 82
    do {
        output.reset()
        bitmap.compress(Bitmap.CompressFormat.JPEG, quality, output)
        quality -= 8
    } while (output.size() > 850_000 && quality >= 42)
    bitmap.recycle()
    require(output.size() <= 1_100_000) { "图片压缩后仍过大" }

    val name = resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { cursor ->
        if (cursor.moveToFirst()) cursor.getString(0)?.takeLast(120) else null
    } ?: uri.lastPathSegment?.takeLast(120) ?: "screenshot.jpg"
    val file = File(imageDir, "${UUID.randomUUID()}.jpg")
    file.outputStream().use(output::writeTo)
    PendingImage(name, file)
}.getOrNull()
