package com.compoundjournal.app

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.viewModels
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.getValue
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.compose.ui.Modifier
import androidx.compose.ui.Alignment
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.time.LocalDate
import java.time.OffsetDateTime
import java.time.format.DateTimeFormatter
import java.util.Locale
import java.util.UUID

private val Paper = Color(0xFFF2F2F7)
private val PaperDeep = Color(0xFFE5E5EA)
private val SurfaceWhite = Color(0xFFFFFFFF)
private val SurfaceSoft = Color(0xFFF7F7F9)
private val Ink = Color(0xFF1B1B1D)
private val Muted = Color(0xFF65656D)
private val Accent = Color(0xFFC6F66F)
private val AccentSoft = Color(0xFFE9FFC2)
private val Danger = Color(0xFFC73D4D)

@Composable
private fun BrutalSurface(
    modifier: Modifier = Modifier,
    padding: PaddingValues = PaddingValues(16.dp),
    onClick: (() -> Unit)? = null,
    content: @Composable ColumnScope.() -> Unit,
) {
    val shape = RoundedCornerShape(18.dp)
    Box(modifier.padding(end = 5.dp, bottom = 5.dp)) {
        Box(Modifier.matchParentSize().offset(5.dp, 5.dp).clip(shape).background(Ink))
        Column(
            Modifier.fillMaxWidth()
                .clip(shape)
                .background(SurfaceWhite)
                .border(2.dp, Ink, shape)
                .then(if (onClick == null) Modifier else Modifier.clickable(role = Role.Button, onClick = onClick))
                .padding(padding),
            content = content,
        )
    }
}

@Composable
private fun BrutalButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    primary: Boolean = true,
) {
    val interaction = remember { MutableInteractionSource() }
    val pressed by interaction.collectIsPressedAsState()
    val shape = RoundedCornerShape(14.dp)
    Box(modifier.heightIn(min = 51.dp).padding(end = 5.dp, bottom = 5.dp).alpha(if (enabled) 1f else .46f)) {
        if (enabled) Box(Modifier.matchParentSize().offset(5.dp, 5.dp).clip(shape).background(Ink))
        Box(
            Modifier.fillMaxWidth().heightIn(min = 46.dp)
                .offset {
                    val distance = if (pressed) 3.dp.roundToPx() else 0
                    IntOffset(distance, distance)
                }
                .clip(shape)
                .background(if (primary) Accent else SurfaceWhite)
                .border(2.dp, Ink, shape)
                .clickable(
                    enabled = enabled,
                    role = Role.Button,
                    interactionSource = interaction,
                    indication = null,
                    onClick = onClick,
                )
                .padding(horizontal = 16.dp, vertical = 10.dp),
            contentAlignment = Alignment.Center,
        ) {
            Text(text, color = Ink, fontSize = 15.sp, fontWeight = FontWeight.ExtraBold, textAlign = TextAlign.Center)
        }
    }
}

@Composable
private fun InlineButton(text: String, onClick: () -> Unit, enabled: Boolean = true) {
    val shape = RoundedCornerShape(10.dp)
    Box(
        Modifier.heightIn(min = 36.dp)
            .clip(shape)
            .background(SurfaceWhite)
            .border(2.dp, Ink, shape)
            .clickable(enabled = enabled, role = Role.Button, onClick = onClick)
            .alpha(if (enabled) 1f else .46f)
            .padding(horizontal = 10.dp, vertical = 7.dp),
        contentAlignment = Alignment.Center,
    ) { Text(text, color = Ink, fontSize = 12.sp, fontWeight = FontWeight.ExtraBold) }
}

@Composable
private fun BrutalTextField(
    value: String,
    onValueChange: (String) -> Unit,
    placeholder: String,
    modifier: Modifier = Modifier,
    singleLine: Boolean = false,
    fontSize: Int = 16,
) {
    val shape = RoundedCornerShape(if (singleLine) 10.dp else 14.dp)
    BasicTextField(
        value = value,
        onValueChange = onValueChange,
        singleLine = singleLine,
        textStyle = TextStyle(color = Ink, fontSize = fontSize.sp, lineHeight = (fontSize * 1.55).sp),
        cursorBrush = SolidColor(Ink),
        modifier = modifier.clip(shape).background(SurfaceSoft).border(2.dp, Ink, shape).padding(horizontal = 14.dp, vertical = 12.dp),
        decorationBox = { inner ->
            Box(contentAlignment = Alignment.CenterStart) {
                if (value.isEmpty()) Text(placeholder, color = Muted.copy(alpha = .78f), fontSize = fontSize.sp)
                inner()
            }
        },
    )
}

@Composable
private fun BrandHeader(connected: ApiClient.ConnectionState?) {
    Row(
        Modifier.fillMaxWidth().padding(vertical = 12.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            val shape = RoundedCornerShape(13.dp)
            Box(Modifier.size(40.dp)) {
                Box(Modifier.size(36.dp).offset(4.dp, 4.dp).clip(shape).background(Ink))
                Box(
                    Modifier.size(36.dp).clip(shape).background(Accent).border(3.dp, Ink, shape),
                    contentAlignment = Alignment.Center,
                ) { Text("复", color = Ink, fontSize = 18.sp, fontWeight = FontWeight.Black) }
            }
            Text("复利日记", color = Ink, fontSize = 17.sp, fontWeight = FontWeight.ExtraBold)
        }
        val pill = RoundedCornerShape(999.dp)
        Text(
            when (connected) {
                ApiClient.ConnectionState.Connected -> "已连接"
                ApiClient.ConnectionState.Unconfigured -> "未配置"
                ApiClient.ConnectionState.Offline -> "离线"
                null -> "连接中"
            },
            Modifier.clip(pill).background(if (connected == ApiClient.ConnectionState.Connected) AccentSoft else SurfaceWhite).border(2.dp, Ink, pill).padding(horizontal = 11.dp, vertical = 7.dp),
            color = Ink,
            fontSize = 12.sp,
            fontWeight = FontWeight.Bold,
        )
    }
}

@Composable
private fun PageHeading(title: String, showDate: Boolean = false, today: LocalDate = LocalDate.now()) {
    Row(
        Modifier.fillMaxWidth().padding(horizontal = 2.dp, vertical = 14.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.Bottom,
    ) {
        Text(title, color = Ink, fontSize = 30.sp, lineHeight = 33.sp, fontWeight = FontWeight.Black)
        if (showDate) Text(
            today.format(DateTimeFormatter.ofPattern("yyyy年M月d日EEEE", Locale.CHINA)),
            color = Muted,
            fontSize = 13.sp,
            fontWeight = FontWeight.Bold,
        )
    }
}

@Composable
private fun ConfirmDeleteDialog(subject: String, onConfirm: () -> Unit, onDismiss: () -> Unit) {
    Dialog(onDismissRequest = onDismiss) {
        BrutalSurface(Modifier.fillMaxWidth(), padding = PaddingValues(20.dp)) {
            Text("确认删除？", color = Ink, fontSize = 23.sp, fontWeight = FontWeight.Black)
            Text(
                "删除${subject}后无法恢复。",
                Modifier.padding(top = 8.dp, bottom = 16.dp),
                color = Muted,
                fontSize = 14.sp,
                lineHeight = 21.sp,
            )
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Box(Modifier.weight(1f)) { BrutalButton("取消", onDismiss, Modifier.fillMaxWidth(), primary = false) }
                Box(Modifier.weight(1f)) { BrutalButton("删除", onConfirm, Modifier.fillMaxWidth()) }
            }
        }
    }
}

private fun entryTypeLabel(json: JSONObject): String = when (json.optString("type")) {
    "daily" -> "生活记录"
    "material" -> "资料感悟"
    "mixed" -> "混合整理"
    else -> "智能整理"
}

@Composable
private fun BrutalTabs(selected: Screen, onSelect: (Screen) -> Unit) {
    Box(Modifier.fillMaxWidth().background(Paper).navigationBarsPadding().padding(horizontal = 14.dp, vertical = 10.dp)) {
        val outer = RoundedCornerShape(19.dp)
        Box(Modifier.fillMaxWidth().height(66.dp).padding(end = 6.dp, bottom = 6.dp)) {
            Box(Modifier.matchParentSize().offset(6.dp, 6.dp).clip(outer).background(Ink))
            Row(Modifier.fillMaxSize().clip(outer).background(SurfaceWhite).border(3.dp, Ink, outer).padding(6.dp)) {
                Screen.entries.forEach { item ->
                    val active = selected == item
                    val shape = RoundedCornerShape(12.dp)
                    Box(Modifier.weight(1f).fillMaxSize().padding(end = if (active) 3.dp else 0.dp, bottom = if (active) 3.dp else 0.dp)) {
                        if (active) Box(Modifier.matchParentSize().offset(3.dp, 3.dp).clip(shape).background(Ink))
                        Box(
                            Modifier.fillMaxSize().clip(shape)
                                .background(if (active) Accent else Color.Transparent)
                                .then(if (active) Modifier.border(2.dp, Ink, shape) else Modifier)
                                .clickable(role = Role.Tab) { onSelect(item) },
                            contentAlignment = Alignment.Center,
                        ) { Text(item.label, color = if (active) Ink else Muted, fontSize = 15.sp, fontWeight = FontWeight.ExtraBold) }
                    }
                }
            }
        }
    }
}

internal fun sharedText(action: String?, type: String?, text: CharSequence?): String =
    if (action == Intent.ACTION_SEND && type == "text/plain") text?.toString().orEmpty().take(12_000) else ""

class MainActivity : ComponentActivity() {
    private var incomingText by mutableStateOf("")
    private val model by viewModels<JournalViewModel>()

    override fun onCreate(state: Bundle?) {
        super.onCreate(state)
        if (state == null) acceptShare(intent)
        setContent { JournalApp(model, incomingText) { incomingText = "" } }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        acceptShare(intent)
    }

    private fun acceptShare(intent: Intent?) {
        @Suppress("DEPRECATION")
        val text = intent?.getCharSequenceExtra(Intent.EXTRA_TEXT)
        incomingText = sharedText(intent?.action, intent?.type, text)
    }
}

private enum class Screen(val label: String) { Today("今天"), History("记录"), Week("本周") }

@Composable
private fun JournalApp(model: JournalViewModel, incomingText: String, consumeShare: () -> Unit) {
    val dao = model.dao
    val entries by dao.entries().collectAsStateWithLifecycle(initialValue = emptyList())
    val habits by dao.habits().collectAsStateWithLifecycle(initialValue = emptyList())
    val checkIns by dao.checkIns().collectAsStateWithLifecycle(initialValue = emptyList())
    var screen by rememberSaveable { mutableStateOf(Screen.Today) }
    var text by rememberSaveable { mutableStateOf("") }
    var selectedEntryId by rememberSaveable { mutableStateOf<String?>(null) }
    var connected by remember { mutableStateOf<ApiClient.ConnectionState?>(null) }
    var today by remember { mutableStateOf(LocalDate.now()) }
    val completedEntry = model.completedAnalysis?.entry
    val selectedEntry = selectedEntryId?.let { id ->
        entries.firstOrNull { it.id == id } ?: completedEntry?.takeIf { it.id == id }
    }

    LaunchedEffect(Unit) {
        while (true) {
            delay(30_000)
            today = LocalDate.now()
        }
    }

    LaunchedEffect(Unit) {
        connected = withContext(Dispatchers.IO) { ApiClient.health() }
    }

    LaunchedEffect(incomingText) {
        if (incomingText.isNotBlank()) {
            text = listOf(text, incomingText).filter(String::isNotBlank).joinToString("\n").take(12_000)
            screen = Screen.Today
            selectedEntryId = null
            consumeShare()
        }
    }

    LaunchedEffect(completedEntry?.id, entries) {
        val completed = model.completedAnalysis ?: return@LaunchedEffect
        if (text == completed.submittedDraft) text = ""
        if (screen == Screen.Today) selectedEntryId = completed.entry.id
        if (entries.any { it.id == completed.entry.id }) model.acknowledgeAnalysis(completed.entry.id)
    }

    MaterialTheme(colorScheme = lightColorScheme(
        primary = Accent,
        onPrimary = Ink,
        background = Paper,
        onBackground = Ink,
        surface = SurfaceWhite,
        onSurface = Ink,
        error = Danger,
    )) {
        Scaffold(
            containerColor = Paper,
            bottomBar = { BrutalTabs(screen) { screen = it; selectedEntryId = null } },
        ) { padding ->
            Column(Modifier.fillMaxSize().background(Paper).padding(padding).padding(horizontal = 12.dp)) {
                BrandHeader(connected)
                Box(Modifier.weight(1f)) {
                    when {
                        selectedEntry != null -> EntryDetail(model, selectedEntry) { selectedEntryId = null }
                        screen == Screen.Today -> TodayScreen(model, dao, habits, checkIns, today, text) { text = it }
                        screen == Screen.History -> HistoryScreen(dao, entries) { selectedEntryId = it.id }
                        else -> WeekScreen(model, entries, habits, checkIns, today)
                    }
                }
            }
        }
    }
}

@Composable
private fun TodayScreen(
    model: JournalViewModel,
    dao: JournalDao,
    habits: List<Habit>,
    checkIns: List<CheckIn>,
    today: LocalDate,
    text: String,
    setText: (String) -> Unit,
) {
    val scope = rememberCoroutineScope()
    var habitName by rememberSaveable { mutableStateOf("") }
    var pendingHabitDelete by remember { mutableStateOf<Habit?>(null) }
    val picker = rememberLauncherForActivityResult(ActivityResultContracts.GetMultipleContents()) { uris ->
        model.addImages(uris)
    }
    val todayText = today.toString()
    val images = model.images
    val error = listOf(model.imageError, model.analyzeError).filter(String::isNotBlank).joinToString("\n")

    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(bottom = 20.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        item { PageHeading("今天", showDate = true, today = today) }
        item {
            BrutalSurface(padding = PaddingValues(horizontal = 16.dp, vertical = 14.dp)) {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                    Text("习惯", color = Ink, fontSize = 17.sp, fontWeight = FontWeight.ExtraBold)
                    Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
                        BrutalTextField(habitName, { habitName = it.take(20) }, "添加习惯", Modifier.width(128.dp), singleLine = true, fontSize = 13)
                        InlineButton("添加", onClick = {
                            val name = habitName.trim()
                            if (name.isNotEmpty() && habits.none { it.name == name }) {
                                scope.launch { dao.saveHabit(UUID.randomUUID().toString(), name) }
                                habitName = ""
                            }
                        })
                    }
                }
                if (habits.isEmpty()) {
                    Text("添加一个每天想坚持的习惯", Modifier.padding(top = 12.dp, bottom = 2.dp), color = Muted, fontSize = 13.sp)
                } else {
                    Column(Modifier.padding(top = 10.dp)) {
                        habits.forEach { habit ->
                            val completedDates = checkIns.asSequence()
                                .filter { it.habitId == habit.id }
                                .mapNotNull { runCatching { LocalDate.parse(it.date) }.getOrNull() }
                                .toSet()
                            val done = today in completedDates
                            val streak = habitStreak(completedDates, today)
                            Row(
                                Modifier.fillMaxWidth().border(1.dp, PaperDeep).padding(vertical = 8.dp),
                                horizontalArrangement = Arrangement.spacedBy(10.dp),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                val checkShape = RoundedCornerShape(9.dp)
                                Box(
                                    Modifier.size(28.dp).clip(checkShape).background(if (done) Accent else SurfaceWhite)
                                        .border(2.dp, Ink, checkShape)
                                        .clickable(enabled = !model.analyzeBusy) { scope.launch {
                                            if (done) dao.removeCheckIn(habit.id, todayText) else dao.saveCheckIn(CheckIn(habit.id, todayText))
                                        } },
                                    contentAlignment = Alignment.Center,
                                ) { if (done) Text("✓", color = Ink, fontWeight = FontWeight.Black) }
                                Text(habit.name, Modifier.weight(1f), color = Ink, fontSize = 14.sp, fontWeight = FontWeight.Bold)
                                if (streak > 0) Text("$streak 天", color = Muted, fontSize = 12.sp, fontWeight = FontWeight.Bold)
                                Text(
                                    "删除",
                                    Modifier.clickable(enabled = !model.analyzeBusy) { pendingHabitDelete = habit }.padding(4.dp),
                                    color = Danger,
                                    fontSize = 12.sp,
                                    fontWeight = FontWeight.Bold,
                                )
                            }
                        }
                    }
                }
            }
        }
        item {
            BrutalSurface(padding = PaddingValues(18.dp)) {
                Text("记录", color = Ink, fontSize = 13.sp, fontWeight = FontWeight.ExtraBold)
                BrutalTextField(
                    value = text,
                    onValueChange = { setText(it.take(12_000)) },
                    placeholder = "写下今天的事，或粘贴微信文章链接",
                    modifier = Modifier.fillMaxWidth().height(190.dp).padding(top = 8.dp),
                )
                val dash = PathEffect.dashPathEffect(floatArrayOf(12f, 8f))
                Row(
                    Modifier.fillMaxWidth().heightIn(min = 50.dp).padding(top = 12.dp)
                        .clip(RoundedCornerShape(14.dp)).background(SurfaceSoft)
                        .drawBehind { drawRoundRect(Ink, cornerRadius = CornerRadius(14.dp.toPx()), style = Stroke(2.dp.toPx(), pathEffect = dash)) }
                        .clickable(enabled = !model.imageBusy && !model.analyzeBusy) { picker.launch("image/*") }
                        .padding(horizontal = 14.dp, vertical = 12.dp),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text("添加截图", color = Ink, fontSize = 14.sp, fontWeight = FontWeight.ExtraBold)
                    Text(
                        if (model.imageBusy) "正在处理" else if (images.isEmpty()) "最多 12 张" else "已选 ${images.size}/12 张",
                        color = Muted,
                        fontSize = 12.sp,
                    )
                }
                images.forEachIndexed { index, image ->
                    Row(
                        Modifier.fillMaxWidth().padding(top = 8.dp).clip(RoundedCornerShape(12.dp))
                            .background(AccentSoft).border(2.dp, Ink, RoundedCornerShape(12.dp)).padding(horizontal = 12.dp, vertical = 9.dp),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text("${index + 1}. ${image.name}", Modifier.weight(1f), color = Ink, fontSize = 12.sp, fontWeight = FontWeight.Bold)
                        Text(
                            "移除",
                            Modifier.clickable(enabled = !model.analyzeBusy) { model.removeImage(index) }.padding(4.dp),
                            color = Danger,
                            fontSize = 12.sp,
                            fontWeight = FontWeight.ExtraBold,
                        )
                    }
                }
                if (error.isNotBlank()) Text(error, Modifier.padding(top = 10.dp), color = Danger, fontSize = 13.sp)
                BrutalButton(
                    text = if (model.analyzeBusy) "正在整理" else "整理",
                    modifier = Modifier.fillMaxWidth().padding(top = 14.dp),
                    enabled = !model.analyzeBusy && !model.imageBusy && (text.isNotBlank() || images.isNotEmpty()),
                    onClick = { model.analyze(text, habits, today) },
                )
                Text("记录保存在本机；图片仅在整理时发送。", Modifier.fillMaxWidth().padding(top = 8.dp), color = Muted, fontSize = 12.sp, textAlign = TextAlign.Center)
            }
        }
    }
    pendingHabitDelete?.let { habit ->
        ConfirmDeleteDialog("习惯「${habit.name}」及其打卡记录", onConfirm = {
            scope.launch { dao.deleteHabit(habit.id) }
            pendingHabitDelete = null
        }, onDismiss = { pendingHabitDelete = null })
    }
}

@Composable
private fun HistoryScreen(dao: JournalDao, entries: List<JournalEntry>, open: (JournalEntry) -> Unit) {
    val scope = rememberCoroutineScope()
    var pendingDelete by remember { mutableStateOf<JournalEntry?>(null) }
    LazyColumn(
        Modifier.fillMaxSize(),
        contentPadding = PaddingValues(bottom = 20.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        item { PageHeading("记录") }
        if (entries.isEmpty()) item {
            BrutalSurface(padding = PaddingValues(horizontal = 24.dp, vertical = 44.dp)) {
                Text(
                    "暂无记录",
                    Modifier.fillMaxWidth(),
                    color = Ink,
                    fontSize = 22.sp,
                    fontWeight = FontWeight.Black,
                    textAlign = TextAlign.Center,
                )
                Text(
                    "先在「今天」写下第一条日记。",
                    Modifier.fillMaxWidth().padding(top = 8.dp),
                    color = Muted,
                    fontSize = 13.sp,
                    textAlign = TextAlign.Center,
                )
            }
        }
        items(entries, key = JournalEntry::id) { entry ->
            BrutalSurface(onClick = { open(entry) }, padding = PaddingValues(18.dp)) {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(14.dp), verticalAlignment = Alignment.Top) {
                    Column(Modifier.weight(1f)) {
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                            Text(entry.createdAt.take(10), color = Muted, fontSize = 11.sp, fontWeight = FontWeight.Bold)
                            Text(entryTypeLabel(JSONObject(entry.json)), color = Muted, fontSize = 11.sp, fontWeight = FontWeight.Bold)
                        }
                        Text(
                            entry.title,
                            Modifier.padding(top = 9.dp),
                            color = Ink,
                            fontSize = 21.sp,
                            lineHeight = 25.sp,
                            fontWeight = FontWeight.Black,
                        )
                        if (entry.digest.isNotBlank()) Text(
                            entry.digest,
                            Modifier.padding(top = 7.dp),
                            color = Muted,
                            fontSize = 14.sp,
                            lineHeight = 21.sp,
                        )
                    }
                    val shape = RoundedCornerShape(13.dp)
                    Box(
                        Modifier.size(44.dp).clip(shape).background(SurfaceWhite).border(2.dp, Ink, shape)
                            .clickable(role = Role.Button) { pendingDelete = entry },
                        contentAlignment = Alignment.Center,
                    ) { Text("删", color = Danger, fontSize = 13.sp, fontWeight = FontWeight.ExtraBold) }
                }
            }
        }
    }
    pendingDelete?.let { entry ->
        ConfirmDeleteDialog("这条日记", onConfirm = {
            scope.launch { dao.deleteEntry(entry.id) }
            pendingDelete = null
        }, onDismiss = { pendingDelete = null })
    }
}

@Composable
private fun EntryDetail(model: JournalViewModel, entry: JournalEntry, back: () -> Unit) {
    val json = remember(entry.json) { JSONObject(entry.json) }
    val question = if (model.chatDraftEntryId == entry.id) model.chatDraft else ""
    val busy = model.chatBusyEntryId == entry.id
    val error = if (model.chatErrorEntryId == entry.id) model.chatError else ""
    BackHandler(onBack = back)
    LazyColumn(
        Modifier.fillMaxSize(),
        contentPadding = PaddingValues(bottom = 20.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        item { Row(Modifier.padding(top = 14.dp)) { InlineButton("← 返回", back) } }
        item {
            BrutalSurface(padding = PaddingValues(20.dp)) {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.Top) {
                    Column(Modifier.weight(1f)) {
                        Text(entry.title, color = Ink, fontSize = 27.sp, lineHeight = 31.sp, fontWeight = FontWeight.Black)
                        Text(entry.createdAt.take(10), Modifier.padding(top = 7.dp), color = Muted, fontSize = 12.sp)
                    }
                    val chip = RoundedCornerShape(999.dp)
                    Text(
                        entryTypeLabel(json),
                        Modifier.padding(start = 10.dp).clip(chip).background(Accent).border(2.dp, Ink, chip).padding(horizontal = 9.dp, vertical = 5.dp),
                        color = Ink,
                        fontSize = 11.sp,
                        fontWeight = FontWeight.ExtraBold,
                    )
                }
                if (entry.digest.isNotBlank()) Text(
                    entry.digest,
                    Modifier.padding(vertical = 20.dp),
                    color = Ink,
                    fontSize = 17.sp,
                    lineHeight = 27.sp,
                    fontWeight = FontWeight.Bold,
                )

                json.optJSONArray("scores")?.takeIf { it.length() > 0 }?.let { scores ->
                    val scoreShape = RoundedCornerShape(14.dp)
                    Column(Modifier.fillMaxWidth().clip(scoreShape).border(2.dp, Ink, scoreShape)) {
                        repeat(scores.length()) { index ->
                            val score = scores.getJSONObject(index)
                            Row(
                                Modifier.fillMaxWidth().background(SurfaceSoft).padding(horizontal = 12.dp, vertical = 12.dp),
                                horizontalArrangement = Arrangement.SpaceBetween,
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Text(score.optString("label"), color = Ink, fontSize = 13.sp, fontWeight = FontWeight.ExtraBold)
                                Column(horizontalAlignment = Alignment.End) {
                                    Text("${score.optInt("value")}/5", color = Ink, fontSize = 15.sp, fontWeight = FontWeight.Black)
                                    score.optString("reason").takeIf(String::isNotBlank)?.let {
                                        Text(it, color = Muted, fontSize = 11.sp, textAlign = TextAlign.End)
                                    }
                                }
                            }
                        }
                    }
                }

                json.optJSONArray("sections")?.let { sections ->
                    repeat(sections.length()) { index ->
                        val section = sections.getJSONObject(index)
                        val values = section.optJSONArray("items")
                        DetailBlock(section.optString("label")) {
                            repeat(values?.length() ?: 0) { itemIndex ->
                                Text("• ${values!!.optString(itemIndex)}", color = Ink, fontSize = 14.sp, lineHeight = 21.sp)
                            }
                        }
                    }
                }
                listOf(
                    "自动打卡" to "checkIns",
                    "问题与待办" to "issues",
                    "感悟" to "insights",
                ).forEach { (title, key) ->
                    json.optJSONArray(key)?.takeIf { it.length() > 0 }?.let { values ->
                        DetailBlock(title) {
                            repeat(values.length()) { index ->
                                val value = values.get(index)
                                Text(
                                    if (value is JSONObject) "• ${value.optString("name")}：${value.optString("evidence")}" else "• $value",
                                    color = Ink,
                                    fontSize = 14.sp,
                                    lineHeight = 21.sp,
                                )
                            }
                        }
                    }
                }
                ReflectionBlock("肯定", json.optString("highlight"))
                ReflectionBlock("发现", json.optString("pattern"))
                ReflectionBlock("下一步", json.optString("nextAction"), accent = true)

                json.optJSONArray("tags")?.takeIf { it.length() > 0 }?.let { tags ->
                    Row(Modifier.fillMaxWidth().padding(top = 14.dp), horizontalArrangement = Arrangement.spacedBy(7.dp)) {
                        repeat(tags.length()) { index ->
                            val chip = RoundedCornerShape(999.dp)
                            Text(
                                tags.optString(index),
                                Modifier.clip(chip).background(Accent).border(2.dp, Ink, chip).padding(horizontal = 9.dp, vertical = 5.dp),
                                color = Ink,
                                fontSize = 11.sp,
                                fontWeight = FontWeight.ExtraBold,
                            )
                        }
                    }
                }

                json.optJSONArray("sourceWarnings")?.takeIf { it.length() > 0 }?.let { warnings ->
                    DetailBlock("来源提醒") {
                        repeat(warnings.length()) { index ->
                            Text("• ${warnings.optString(index)}", color = Danger, fontSize = 14.sp, lineHeight = 21.sp)
                        }
                    }
                }

                json.optJSONArray("chat")?.let { chat ->
                    if (chat.length() > 0) Text("追问记录", Modifier.padding(top = 20.dp), color = Ink, fontSize = 14.sp, fontWeight = FontWeight.ExtraBold)
                    repeat(chat.length()) { index ->
                        val message = chat.getJSONObject(index)
                        val mine = message.optString("role") == "user"
                        val bubble = RoundedCornerShape(14.dp)
                        Text(
                            "${if (mine) "我" else "AI"}：${message.optString("content")}",
                            Modifier.fillMaxWidth().padding(top = 8.dp).clip(bubble)
                                .background(if (mine) AccentSoft else SurfaceSoft).border(2.dp, Ink, bubble).padding(12.dp),
                            color = Ink,
                            fontSize = 14.sp,
                            lineHeight = 21.sp,
                        )
                    }
                }

                Text("继续追问", Modifier.padding(top = 20.dp, bottom = 8.dp), color = Ink, fontSize = 13.sp, fontWeight = FontWeight.ExtraBold)
                BrutalTextField(question, { model.setChatDraft(entry.id, it) }, "追问这条记录", Modifier.fillMaxWidth().heightIn(min = 54.dp))
                BrutalButton(
                    text = if (busy) "发送中" else "发送",
                    modifier = Modifier.fillMaxWidth().padding(top = 10.dp),
                    enabled = !busy && question.isNotBlank(),
                    onClick = { model.chat(entry, question.trim()) },
                )
                if (error.isNotBlank()) Text(error, Modifier.padding(top = 8.dp), color = Danger, fontSize = 13.sp)
            }
        }
    }
}

@Composable
private fun DetailBlock(title: String, content: @Composable ColumnScope.() -> Unit) {
    val shape = RoundedCornerShape(14.dp)
    Column(
        Modifier.fillMaxWidth().padding(top = 14.dp).clip(shape).background(SurfaceSoft).border(2.dp, Ink, shape).padding(14.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Text(title, color = Ink, fontSize = 14.sp, fontWeight = FontWeight.ExtraBold)
        content()
    }
}

@Composable
private fun ReflectionBlock(title: String, value: String, accent: Boolean = false) {
    if (value.isBlank()) return
    Column(
        Modifier.fillMaxWidth().padding(top = 16.dp)
            .background(if (accent) AccentSoft else Color.Transparent)
            .then(if (accent) Modifier.border(2.dp, Ink, RoundedCornerShape(14.dp)).padding(14.dp) else Modifier),
    ) {
        Text(title, color = Ink, fontSize = 13.sp, fontWeight = FontWeight.ExtraBold)
        Text(value, Modifier.padding(top = 6.dp), color = Ink, fontSize = 15.sp, lineHeight = 23.sp)
    }
}

@Composable
private fun WeekScreen(
    model: JournalViewModel,
    entries: List<JournalEntry>,
    habits: List<Habit>,
    checkIns: List<CheckIn>,
    today: LocalDate,
) {
    val recent = entries.filter { entry ->
        entryLocalDate(entry.createdAt)?.let { isInSevenDayWindow(it, today) } == true
    }
    val ids = recent.joinToString("|") { it.id }
    val review = if (model.reviewEntryIds == ids) model.reviewJson?.let(::JSONObject) else null
    val busy = model.reviewBusyEntryIds == ids
    val error = if (model.reviewErrorEntryIds == ids) model.reviewError else ""

    LaunchedEffect(ids) {
        model.loadReview(ids)
    }

    LazyColumn(
        Modifier.fillMaxSize(),
        contentPadding = PaddingValues(bottom = 20.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        item { PageHeading("本周") }
        if (recent.isEmpty() && habits.isEmpty()) {
            item {
                BrutalSurface(padding = PaddingValues(horizontal = 24.dp, vertical = 44.dp)) {
                    Text("本周暂无记录", Modifier.fillMaxWidth(), color = Ink, fontSize = 22.sp, fontWeight = FontWeight.Black, textAlign = TextAlign.Center)
                    Text("连续记录后，这里会出现习惯进度和 AI 周复盘。", Modifier.fillMaxWidth().padding(top = 8.dp), color = Muted, fontSize = 13.sp, lineHeight = 20.sp, textAlign = TextAlign.Center)
                }
            }
        } else item {
            BrutalSurface(padding = PaddingValues(18.dp)) {
                Text("本周数据", color = Ink, fontSize = 18.sp, fontWeight = FontWeight.Black)
                Row(
                    Modifier.fillMaxWidth().padding(vertical = 15.dp),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text("记录次数", color = Muted, fontSize = 13.sp, fontWeight = FontWeight.Bold)
                    Text(recent.size.toString(), color = Ink, fontSize = 25.sp, fontWeight = FontWeight.Black)
                }
                habits.forEach { habit ->
                    val count = checkIns.count {
                        it.habitId == habit.id && runCatching {
                            isInSevenDayWindow(LocalDate.parse(it.date), today)
                        }.getOrDefault(false)
                    }
                    Row(
                        Modifier.fillMaxWidth().border(1.dp, PaperDeep).padding(vertical = 10.dp),
                        horizontalArrangement = Arrangement.SpaceBetween,
                    ) {
                        Text(habit.name, color = Muted, fontSize = 13.sp, fontWeight = FontWeight.Bold)
                        Text("$count/7", color = Ink, fontSize = 14.sp, fontWeight = FontWeight.Black)
                    }
                }
                if (recent.isNotEmpty()) {
                    listOf("状态均分" to "state", "行动均分" to "action", "复利均分" to "compound").forEach { (label, key) ->
                        val values = recent.flatMap { entry ->
                            val scores = JSONObject(entry.json).optJSONArray("scores") ?: JSONArray()
                            (0 until scores.length()).mapNotNull { index ->
                                scores.optJSONObject(index)?.takeIf { it.optString("key") == key }?.optDouble("value")
                            }
                        }
                        Row(Modifier.fillMaxWidth().border(1.dp, PaperDeep).padding(vertical = 10.dp), horizontalArrangement = Arrangement.SpaceBetween) {
                            Text(label, color = Muted, fontSize = 13.sp, fontWeight = FontWeight.Bold)
                            Text(if (values.isEmpty()) "暂无" else "%.1f".format(Locale.US, values.average()), color = Ink, fontSize = 14.sp, fontWeight = FontWeight.Black)
                        }
                    }
                }
                if (recent.isNotEmpty()) BrutalButton(
                    text = if (busy) "正在复盘" else if (review == null) "生成 AI 周复盘" else "重新生成复盘",
                    modifier = Modifier.fillMaxWidth().padding(top = 14.dp),
                    enabled = !busy,
                    onClick = { model.generateReview(recent) },
                )
            }
        }
        if (error.isNotBlank()) item { Text(error, color = MaterialTheme.colorScheme.error) }
        review?.let { value -> item {
            BrutalSurface(padding = PaddingValues(20.dp)) {
                Text("本周总结", color = Ink, fontSize = 25.sp, fontWeight = FontWeight.Black)
                Text(value.optString("summary"), Modifier.padding(top = 10.dp), color = Ink, fontSize = 16.sp, lineHeight = 25.sp, fontWeight = FontWeight.Bold)
                value.optJSONArray("wins")?.takeIf { it.length() > 0 }?.let { values ->
                    DetailBlock("有效积累") { repeat(values.length()) { Text("• ${values.optString(it)}", color = Ink, fontSize = 15.sp, lineHeight = 23.sp) } }
                }
                value.optJSONArray("patterns")?.takeIf { it.length() > 0 }?.let { values ->
                    DetailBlock("可验证的规律") { repeat(values.length()) { Text("• ${values.optString(it)}", color = Ink, fontSize = 15.sp, lineHeight = 23.sp) } }
                }
                DetailBlock("下周唯一重点") { Text(value.optString("focus"), color = Ink, fontSize = 15.sp, lineHeight = 23.sp) }
                DetailBlock("七天小实验") { Text(value.optString("experiment"), color = Ink, fontSize = 15.sp, lineHeight = 23.sp) }
            }
        } }
    }
}

internal fun JSONObject.toEntry() = JournalEntry(
    id = optString("id", UUID.randomUUID().toString()),
    createdAt = optString("createdAt", OffsetDateTime.now().toString()),
    title = optString("title", "今天的整理"),
    digest = optString("digest"),
    inputText = optString("inputText"),
    json = toString(),
)
