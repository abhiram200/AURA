<?php

namespace App\Interfaces;

interface RepositoryInterface
{
    public function findById(int $id): ?object;
    public function findAll(): array;
    public function save(object $entity): object;
}