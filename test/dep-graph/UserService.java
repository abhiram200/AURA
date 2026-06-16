package com.example.service;

import com.example.model.User;
import com.example.repository.UserRepository;
import com.example.exception.NotFoundException;
import java.util.List;
import java.util.ArrayList;
import java.util.Optional;

public class UserService
{
    private final UserRepository repository;
    protected static final int MAX_RESULTS = 100;

    public UserService(UserRepository repository)
    {
        this.repository = repository;
    }

    public Optional<User> findById(int id)
    {
        try {
            User user = repository.findById(id);
            return Optional.ofNullable(user);
        } catch (NotFoundException e) {
            e.printStackTrace();
            return Optional.empty();
        }
    }

    public List<User> findAll()
    {
        List<User> users = repository.findAll();
        if (users.size() > MAX_RESULTS) {
            return users.subList(0, MAX_RESULTS);
        }
        return users;
    }

    public User save(User user)
    {
        return repository.save(user);
    }

    private void logAction(String action, User user)
    {
        System.out.println(action + ": " + user.render());
    }
}