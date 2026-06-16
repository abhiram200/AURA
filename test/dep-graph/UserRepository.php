<?php

namespace App\Models;

use App\Database\Connection;
use App\Exceptions\NotFoundException;
use App\Interfaces\RepositoryInterface;

class UserRepository implements RepositoryInterface
{
    private Connection $connection;
    protected string $tableName = 'users';

    public function __construct(Connection $connection)
    {
        $this->connection = $connection;
    }

    public function findById(int $id): ?User
    {
        $query = "SELECT * FROM {$this->tableName} WHERE id = :id";
        $result = $this->connection->query($query, ['id' => $id]);

        if (!$result) {
            throw new NotFoundException("User not found");
        }

        return $this->hydrate($result);
    }

    public function findAll(): array
    {
        $query = "SELECT * FROM {$this->tableName}";
        $results = $this->connection->query($query);

        return array_map([$this, 'hydrate'], $results);
    }

    public function save(User $user): User
    {
        if ($user->getId() !== null) {
            return $this->update($user);
        }

        $query = "INSERT INTO {$this->tableName} (name, email) VALUES (:name, :email)";
        $this->connection->execute($query, [
            'name' => $user->getName(),
            'email' => $user->getEmail(),
        ]);

        $user->setId($this->connection->lastInsertId());
        return $user;
    }

    private function hydrate(array $data): User
    {
        return new User(
            $data['id'],
            $data['name'],
            $data['email']
        );
    }

    private function update(User $user): User
    {
        $query = "UPDATE {$this->tableName} SET name = :name, email = :email WHERE id = :id";
        $this->connection->execute($query, [
            'id' => $user->getId(),
            'name' => $user->getName(),
            'email' => $user->getEmail(),
        ]);
        return $user;
    }
}