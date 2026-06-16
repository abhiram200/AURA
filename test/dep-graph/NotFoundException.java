package com.example.exception;

public class NotFoundException extends RuntimeException
{
    private String resource;
    private int statusCode;

    public NotFoundException(String resource)
    {
        super(resource);
        this.resource = resource;
        this.statusCode = 404;
    }

    public String getResource()
    {
        return resource;
    }

    public int getStatusCode()
    {
        return statusCode;
    }
}