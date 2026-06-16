package com.example.model;

public enum UserRole
{
    ADMIN("admin"),
    EDITOR("editor"),
    VIEWER("viewer");

    private final String value;

    UserRole(String value)
    {
        this.value = value;
    }

    public String getValue()
    {
        return value;
    }
}