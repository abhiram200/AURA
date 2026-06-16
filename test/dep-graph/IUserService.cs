using MyApp.Models;

namespace MyApp.Services
{
    public interface IUserService
    {
        User GetUser(int id);
        void SaveUser(User user);
    }
}