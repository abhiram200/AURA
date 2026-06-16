<?php

namespace App\Models;

use App\Interfaces\RenderableInterface;

enum UserRole: string
{
    case Admin = 'admin';
    case Editor = 'editor';
    case Viewer = 'viewer';
}

trait Timestampable
{
    protected ?string $createdAt = null;
    protected ?string $updatedAt = null;

    public function getCreatedAt(): ?string
    {
        return $this->createdAt;
    }

    public function setCreatedAt(string $createdAt): void
    {
        $this->createdAt = $createdAt;
    }

    public function markUpdated(): void
    {
        $this->updatedAt = date('Y-m-d H:i:s');
    }
}

class User implements RenderableInterface
{
    use Timestampable;

    protected ?int $id = null;
    protected string $name;
    protected string $email;
    protected UserRole $role;

    public function __construct(?int $id, string $name, string $email, UserRole $role = UserRole::Viewer)
    {
        $this->id = $id;
        $this->name = $name;
        $this->email = $email;
        $this->role = $role;
    }

    public function getId(): ?int
    {
        return $this->id;
    }

    public function setId(int $id): void
    {
        $this->id = $id;
    }

    public function getName(): string
    {
        return $this->name;
    }

    public function getEmail(): string
    {
        return $this->email;
    }

    public function getRole(): UserRole
    {
        return $this->role;
    }

    public function isAdmin(): bool
    {
        return $this->role === UserRole::Admin;
    }

    public function render(): string
    {
        return sprintf('User(%d, %s, %s)', $this->id, $this->name, $this->email);
    }
}