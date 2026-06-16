<?php

// A PHP file with require/include statements for testing

require_once __DIR__ . '/User.php';
require_once __DIR__ . '/UserRepository.php';
include_once __DIR__ . '/NotFoundException.php';

use App\Models\User;
use App\Models\UserRole;

function createUser(string $name, string $email): User
{
    return new User(null, $name, $email);
}

function formatUser(User $user): string
{
    return $user->render();
}