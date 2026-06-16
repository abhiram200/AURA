import 'dart:async';
import 'user.dart';

// Interface
abstract class Serializable {
  String toJson();
}

// Class extending another
class UserService {
  final List<User> _users = [];

  void addUser(User user) {
    _users.add(user);
  }

  User? findUser(String name) {
    for (final user in _users) {
      if (user.name == name) return user;
    }
    return null;
  }

  Future<void> saveAll() async {
    for (final user in _users) {
      print(user.toJson());
    }
  }
}