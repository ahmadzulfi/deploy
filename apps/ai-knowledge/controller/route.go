package controller

import (
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"strings"
	"time"

	"go-pgvector-gemini/router"
)

// RouteController serves POST /route for claudewa's "Arahkan AI" node.
type RouteController struct {
	router *router.Router
}

func NewRouteController(r *router.Router) *RouteController {
	return &RouteController{router: r}
}

func (c *RouteController) RegisterRoutes(mux *http.ServeMux) {
	mux.HandleFunc("POST /route", c.HandleRoute)
}

type routeRequest struct {
	Question string `json:"question"`
	// Sent by claudewa as a cache key. Unused: the router derives its own key
	// from the destinations, so a wrong hash cannot mix two menus up.
	CatalogHash  string               `json:"catalog_hash"`
	Destinations []router.Destination `json:"destinations"`
	// Optional: questions an admin confirmed belong to a destination.
	Examples []router.Example `json:"examples"`
}

// HandleRoute answers which destination a question belongs to. Errors follow
// the contract's {"error": "..."} shape; claudewa sends the main menu on any.
func (c *RouteController) HandleRoute(w http.ResponseWriter, r *http.Request) {
	started := time.Now()

	// A few hundred destinations of at most 500 characters each.
	r.Body = http.MaxBytesReader(w, r.Body, 4<<20)
	var req routeRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		routeError(w, http.StatusBadRequest, "body bukan JSON yang valid atau lebih dari 4 MB")
		return
	}
	req.Question = strings.TrimSpace(req.Question)
	if err := router.Validate(req.Question, req.Destinations); err != nil {
		routeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if err := router.ValidateExamples(req.Examples); err != nil {
		routeError(w, http.StatusBadRequest, err.Error())
		return
	}

	res, err := c.router.Route(r.Context(), req.Question, req.Destinations, req.Examples)
	if err != nil {
		var limited interface{ RetryAfter() time.Duration }
		switch {
		case errors.Is(err, router.ErrNotReady):
			routeError(w, http.StatusServiceUnavailable, "daftar tujuan sedang disiapkan, coba lagi sebentar")
		case errors.As(err, &limited):
			log.Printf("[ROUTE] kuota Gemini habis untuk pertanyaan, %d tujuan", len(req.Destinations))
			routeError(w, http.StatusServiceUnavailable, "kuota Gemini sedang habis")
		default:
			log.Printf("[ROUTE] gagal, %d tujuan: %v", len(req.Destinations), err)
			routeError(w, http.StatusBadGateway, err.Error())
		}
		return
	}

	picked := "null"
	if res.DestinationID != nil {
		picked = *res.DestinationID
	}
	// The question is deliberately not logged: residents put names, addresses
	// and complaints into it.
	log.Printf("[ROUTE] %d tujuan, %d contoh -> %s (%.3f, %s) %d ms", len(req.Destinations), len(req.Examples), picked, res.Score, res.Via, time.Since(started).Milliseconds())
	WriteJSON(w, http.StatusOK, res)
}

func routeError(w http.ResponseWriter, status int, message string) {
	WriteJSON(w, status, map[string]string{"error": message})
}
