import 'dart:core';
import 'package:flutter/material.dart';
import 'src/models/user.dart';

// Top-level variable
const String appName = 'MyApp';

// Typedef
typedef Callback = void Function(String);

// Enum
enum UserRole { admin, user, guest }

// Mixin
mixin Logger {
  void log(String message) {
    print(message);
  }
}

// Extension
extension StringExtension on String {
  String capitalize() {
    if (isEmpty) return this;
    return this[0].toUpperCase() + substring(1);
  }
}

// Class implementing interface
class User implements Serializable {
  final String name;
  final UserRole role;

  User(this.name, this.role);

  String greet() => 'Hello, $name';

  // Getter
  int get nameLength => name.length;

  // Setter
  set displayName(String value) {
    print('Setting display name: $value');
  }

  @override
  String toJson() => '{"name": "$name"}';
}

// Class with mixin
class AdminUser extends User with Logger {
  AdminUser(String name) : super(name, UserRole.admin);

  void promote() {
    log('Promoting $name');
  }
}

// Top-level function
void createUser(String name) {
  final user = User(name, UserRole.user);
  user.greet();
  print(user.toJson());
}