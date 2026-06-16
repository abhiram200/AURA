package com.example.model;

import com.example.interfaces.Renderable;

public class User implements Renderable
{
    private Integer id;
    private String name;
    private String email;
    private UserRole role;

    public User(Integer id, String name, String email)
    {
        this.id = id;
        this.name = name;
        this.email = email;
        this.role = UserRole.VIEWER;
    }

    public Integer getId() { return id; }
    public String getName() { return name; }
    public String getEmail() { return email; }
    public UserRole getRole() { return role; }

    public void setId(int id) { this.id = id; }
    public void setName(String name) { this.name = name; }

    public boolean isAdmin()
    {
        return role == UserRole.ADMIN;
    }

    @Override
    public String render()
    {
        return String.format("User(%d, %s, %s)", id, name, email);
    }
}