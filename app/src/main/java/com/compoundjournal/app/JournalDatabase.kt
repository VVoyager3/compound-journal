package com.compoundjournal.app

import android.content.Context
import androidx.room.Dao
import androidx.room.Database
import androidx.room.Entity
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.PrimaryKey
import androidx.room.Query
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.room.Transaction
import kotlinx.coroutines.flow.Flow

@Entity(tableName = "entries")
data class JournalEntry(
    @PrimaryKey val id: String,
    val createdAt: String,
    val title: String,
    val digest: String,
    val inputText: String,
    val json: String,
)

@Entity(tableName = "habits")
data class Habit(@PrimaryKey val id: String, val name: String)

@Entity(tableName = "check_ins", primaryKeys = ["habitId", "date"])
data class CheckIn(val habitId: String, val date: String, val status: String = "completed")

@Entity(tableName = "weekly_reviews")
data class WeeklyReview(@PrimaryKey val entryIds: String, val createdAt: String, val json: String)

@Dao
interface JournalDao {
    @Query("SELECT * FROM entries ORDER BY createdAt DESC LIMIT 60")
    fun entries(): Flow<List<JournalEntry>>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun saveEntry(entry: JournalEntry)

    @Query("DELETE FROM entries WHERE id = :entryId")
    suspend fun removeEntry(entryId: String)

    @Query("DELETE FROM weekly_reviews")
    suspend fun clearReviews()

    @Transaction
    suspend fun deleteEntry(entryId: String) {
        removeEntry(entryId)
        clearReviews()
    }

    @Query("SELECT * FROM habits ORDER BY name")
    fun habits(): Flow<List<Habit>>

    @Query("INSERT OR IGNORE INTO habits (id, name) SELECT :id, :name WHERE NOT EXISTS (SELECT 1 FROM habits WHERE name = :name)")
    suspend fun saveHabit(id: String, name: String)

    @Query("DELETE FROM check_ins WHERE habitId = :habitId")
    suspend fun removeHabitCheckIns(habitId: String)

    @Query("DELETE FROM habits WHERE id = :habitId")
    suspend fun removeHabit(habitId: String)

    @Transaction
    suspend fun deleteHabit(habitId: String) {
        removeHabitCheckIns(habitId)
        removeHabit(habitId)
    }

    @Query("SELECT * FROM check_ins")
    fun checkIns(): Flow<List<CheckIn>>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun saveCheckIn(checkIn: CheckIn)

    @Query("DELETE FROM check_ins WHERE habitId = :habitId AND date = :date")
    suspend fun removeCheckIn(habitId: String, date: String)

    @Query("SELECT * FROM weekly_reviews WHERE entryIds = :entryIds LIMIT 1")
    suspend fun review(entryIds: String): WeeklyReview?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun saveReviewRecord(review: WeeklyReview)

    @Transaction
    suspend fun saveReview(review: WeeklyReview) {
        clearReviews()
        saveReviewRecord(review)
    }
}

@Database(
    entities = [JournalEntry::class, Habit::class, CheckIn::class, WeeklyReview::class],
    version = 1,
    exportSchema = false,
)
abstract class JournalDatabase : RoomDatabase() {
    abstract fun dao(): JournalDao

    companion object {
        @Volatile private var instance: JournalDatabase? = null

        fun get(context: Context): JournalDatabase = instance ?: synchronized(this) {
            instance ?: Room.databaseBuilder(
                context.applicationContext,
                JournalDatabase::class.java,
                "compound-journal.db",
            ).build().also { instance = it }
        }
    }
}
