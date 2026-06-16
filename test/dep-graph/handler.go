package handler

import (
	"net/http"
)

type Responder interface {
	Respond(code int)
}

type APIHandler struct {
	http.Handler
	Responder
}

func (h *APIHandler) HandleRequest() {
	h.Respond(200)
}

func NewHandler() *APIHandler {
	return &APIHandler{}
}

const DefaultPort = 8080