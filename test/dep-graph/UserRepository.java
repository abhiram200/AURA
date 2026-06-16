package com.example.repository;

import com.example.model.User;
import java.util.List;

public interface UserRepository
{
    User findById(int id);
    List<User> findAll();
    User save(User user);
    void delete(int id);
}