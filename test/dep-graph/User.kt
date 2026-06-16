package com.example.models

import kotlin.collections.List
import com.example.utils.Logger

// Type alias
typealias UserCallback = (User) -> Unit

// Enum
enum class UserRole { ADMIN, USER, GUEST }

// Interface
interface Serializable {
    fun toJson(): String
    val id: String
}

// Data class (should be Struct)
data class User(
    val name: String,
    val role: UserRole,
    val email: String = ""
) : Serializable {

    companion object {
        fun create(name: String): User = User(name, UserRole.USER)
        val defaultRole: UserRole = UserRole.USER
    }

    override fun toJson(): String = """{"name": "$name"}"""
    override val id: String get() = name.lowercase()
}

// Object declaration
object DatabaseConfig {
    val host: String = "localhost"
    val port: Int = 5432

    fun connect(): Boolean {
        println("Connecting to $host:$port")
        return true
    }
}

// Top-level function
fun createUser(name: String): User {
    return User(name, UserRole.USER)
}

// Top-level variable
val maxRetries: Int = 3