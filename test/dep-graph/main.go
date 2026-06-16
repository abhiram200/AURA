package main

import (
	"fmt"
	"os"
	"myproject/internal/handler"
)

type Handler interface {
	ServeHTTP() error
}

type Server struct {
	Name    string
	Handler
}

type Config = map[string]string

func main() {
	s := &Server{Name: "test"}
	s.ServeHTTP()
	fmt.Println("hello")
}

func (s *Server) Start() error {
	return nil
}

func (s *Server) Stop() {
}

var Version = "1.0"

const MaxRetries = 3