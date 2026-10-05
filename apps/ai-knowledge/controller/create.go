package controller

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strings"

	"go-pgvector-gemini/db"
)

func (c *DocumentController) HandleCreateDocument(w http.ResponseWriter, r *http.Request) {
	var req DocumentRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		WriteError(w, http.StatusBadRequest, "Invalid JSON body")
		return
	}

	req.Category = strings.TrimSpace(req.Category)
	req.Title = strings.TrimSpace(req.Title)
	req.Content = strings.TrimSpace(req.Content)

	if req.Category == "" {
		req.Category = "Umum"
	}
	if req.Title == "" || req.Content == "" {
		WriteError(w, http.StatusBadRequest, "Field 'title' dan 'content' tidak boleh kosong")
		return
	}

	titleWithCat := fmt.Sprintf("[%s] %s", req.Category, req.Title)
	vec, err := c.embedder.GenerateDocumentEmbedding(r.Context(), titleWithCat, req.Content)
	if err != nil {
		log.Printf("Error generate embedding: %v", err)
		WriteError(w, http.StatusInternalServerError, fmt.Sprintf("Gagal generate embedding dari Gemini: %v", err))
		return
	}

	id, err := db.InsertDocument(r.Context(), c.pool, req.Category, req.Title, req.Content, vec)
	if err != nil {
		log.Printf("Error insert document: %v", err)
		WriteError(w, http.StatusInternalServerError, fmt.Sprintf("Gagal menyimpan dokumen ke database: %v", err))
		return
	}
	c.forgetCachedAnswers(r.Context())

	WriteJSON(w, http.StatusCreated, map[string]any{
		"status":  "success",
		"message": "Dokumen berhasil disimpan ke 'docs-gemini-001' dan vector embedding otomatis dibuat",
		"data": map[string]any{
			"id":                  id,
			"category":            req.Category,
			"title":               req.Title,
			"content":             req.Content,
			"embedding_dimension": len(vec.Slice()),
		},
	})
}
