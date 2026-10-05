package controller

import (
	"fmt"
	"log"
	"net/http"
	"strconv"

	"go-pgvector-gemini/db"
)

func (c *DocumentController) HandleGetAllDocuments(w http.ResponseWriter, r *http.Request) {
	limitStr := r.URL.Query().Get("limit")
	offsetStr := r.URL.Query().Get("offset")

	limit := 50
	offset := 0

	if l, err := strconv.Atoi(limitStr); err == nil && l > 0 {
		limit = l
	}
	if o, err := strconv.Atoi(offsetStr); err == nil && o >= 0 {
		offset = o
	}

	docs, err := db.GetAllDocuments(r.Context(), c.pool, limit, offset)
	if err != nil {
		log.Printf("Error fetch documents: %v", err)
		WriteError(w, http.StatusInternalServerError, "Gagal mengambil data dokumen")
		return
	}

	total, _ := db.CountDocuments(r.Context(), c.pool)

	WriteJSON(w, http.StatusOK, map[string]any{
		"status": "success",
		"table":  "docs-gemini-001",
		"total":  total,
		"limit":  limit,
		"offset": offset,
		"data":   docs,
	})
}

func (c *DocumentController) HandleGetDocumentByID(w http.ResponseWriter, r *http.Request) {
	idStr := r.PathValue("id")
	id, err := strconv.Atoi(idStr)
	if err != nil {
		WriteError(w, http.StatusBadRequest, "ID dokumen harus berupa angka")
		return
	}

	doc, err := db.GetDocumentByID(r.Context(), c.pool, id)
	if err != nil {
		WriteError(w, http.StatusNotFound, fmt.Sprintf("Dokumen dengan ID %d tidak ditemukan", id))
		return
	}

	WriteJSON(w, http.StatusOK, map[string]any{
		"status": "success",
		"data":   doc,
	})
}
