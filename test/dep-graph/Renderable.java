package com.example.interfaces;

public interface Renderable
{
    String render();
    default String renderWithPrefix(String prefix)
    {
        return prefix + render();
    }
}