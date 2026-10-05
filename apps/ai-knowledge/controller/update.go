package controller

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"strings"

	"go-pgvector-gemini/db"
)

func (c *DocumentController) HandleUpdateDocument(w http.ResponseWriter, r *http.Request) {
	idStr := r.PathValue("id")
	id, err := strconv.Atoi(idStr)
	if err != nil {
		WriteError(w, http.StatusBadRequest, "ID dokumen harus berupa angka")
		return
	}

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

	if err := db.UpdateDocument(r.Context(), c.pool, id, req.Category, req.Title, req.Content, vec); err != nil {
		WriteError(w, http.StatusNotFound, err.Error())
		return
	}
	c.forgetCachedAnswers(r.Context())

	WriteJSON(w, http.StatusOK, map[string]any{
		"status":  "success",
		"message": "Dokumen dan vector embedding berhasil diperbarui di 'docs-gemini-001'",
		"data": map[string]any{
			"id":                  id,
			"category":            req.Category,
			"title":               req.Title,
			"content":             req.Content,
			"embedding_dimension": len(vec.Slice()),
		},
	})
}
