<?php

namespace App\Exceptions;

use RuntimeException;

class NotFoundException extends RuntimeException
{
    protected string $message = 'Resource not found';

    public function __construct(string $resource = '', int $code = 404)
    {
        parent::__construct($resource ?: $this->message, $code);
    }

    public function getResource(): string
    {
        return $this->getMessage();
    }
}