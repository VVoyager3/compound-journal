package com.compoundjournal.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.LocalDate
import java.time.ZoneId

class JournalLogicTest {
    private val today = LocalDate.of(2026, 8, 13)

    @Test
    fun streakIncludesTodayWhenCompleted() {
        assertEquals(
            3,
            habitStreak(setOf(today, today.minusDays(1), today.minusDays(2)), today),
        )
    }

    @Test
    fun streakStartsYesterdayWhenTodayIsNotCompleted() {
        assertEquals(
            2,
            habitStreak(setOf(today.minusDays(1), today.minusDays(2)), today),
        )
    }

    @Test
    fun streakStopsAtFirstGap() {
        assertEquals(
            1,
            habitStreak(setOf(today, today.minusDays(2)), today),
        )
    }

    @Test
    fun sevenDayWindowUsesCalendarDaysAndRejectsFutureDates() {
        assertTrue(isInSevenDayWindow(today, today))
        assertTrue(isInSevenDayWindow(today.minusDays(6), today))
        assertFalse(isInSevenDayWindow(today.minusDays(7), today))
        assertFalse(isInSevenDayWindow(today.plusDays(1), today))
    }

    @Test
    fun entryDateUsesTheDeviceTimeZone() {
        assertEquals(
            LocalDate.of(2026, 8, 13),
            entryLocalDate("2026-08-12T18:30:00Z", ZoneId.of("Asia/Shanghai")),
        )
        assertEquals(
            LocalDate.of(2026, 8, 12),
            entryLocalDate("2026-08-12T18:30:00Z", ZoneId.of("America/Los_Angeles")),
        )
    }

    @Test
    fun invalidEntryDateIsIgnored() {
        assertEquals(null, entryLocalDate("not-a-date"))
    }
}
