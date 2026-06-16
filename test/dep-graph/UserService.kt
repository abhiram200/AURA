package com.example.service

import com.example.models.User
import com.example.models.UserRole
import com.example.repository.UserRepository

// Interface
interface IUserService {
    fun getUser(id: String): User?
    fun saveUser(user: User)
}

// Class implementing interface
class UserService(
    private val repository: UserRepository
) : IUserService {

    override fun getUser(id: String): User? {
        val users = listOf<User>()
        return users.find { it.id == id }
    }

    override fun saveUser(user: User) {
        repository.save(user)
    }
}