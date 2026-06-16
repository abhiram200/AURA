using System;
using System.Collections.Generic;
using MyApp.Services;

namespace MyApp.Models
{
    public interface IRepository<T>
    {
        T FindById(int id);
        void Save(T entity);
    }

    public enum UserRole
    {
        Admin,
        User,
        Guest
    }

    public class User : IEntity
    {
        public int Id { get; set; }
        public string Name { get; set; }

        public User(int id, string name)
        {
            Id = id;
            Name = name;
        }

        public void Display()
        {
            Console.WriteLine($"User: {Name}");
        }
    }

    public delegate void NotifyHandler(string message);
}