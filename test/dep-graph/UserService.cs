using System;
using MyApp.Models;

namespace MyApp.Services
{
    public class UserService : IUserService
    {
        private readonly IRepository<User> _repository;

        public UserService(IRepository<User> repository)
        {
            _repository = repository;
        }

        public User GetUser(int id)
        {
            return _repository.FindById(id);
        }

        public void SaveUser(User user)
        {
            _repository.Save(user);
        }
    }
}