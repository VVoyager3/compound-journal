package com.compoundjournal.app

import java.time.LocalDate
import java.time.OffsetDateTime
import java.time.ZoneId

internal fun habitStreak(completedDates: Set<LocalDate>, today: LocalDate): Int {
    var cursor = if (today in completedDates) today else today.minusDays(1)
    var count = 0
    while (cursor in completedDates) {
        count += 1
        cursor = cursor.minusDays(1)
    }
    return count
}

internal fun isInSevenDayWindow(date: LocalDate, today: LocalDate): Boolean =
    !date.isBefore(today.minusDays(6)) && !date.isAfter(today)

internal fun entryLocalDate(createdAt: String, zoneId: ZoneId = ZoneId.systemDefault()): LocalDate? =
    runCatching { OffsetDateTime.parse(createdAt).atZoneSameInstant(zoneId).toLocalDate() }.getOrNull()
