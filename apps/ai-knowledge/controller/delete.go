package controller

import (
	"fmt"
	"net/http"
	"strconv"

	"go-pgvector-gemini/db"
)

func (c *DocumentController) HandleDeleteDocument(w http.ResponseWriter, r *http.Request) {
	idStr := r.PathValue("id")
	id, err := strconv.Atoi(idStr)
	if err != nil {
		WriteError(w, http.StatusBadRequest, "ID dokumen harus berupa angka")
		return
	}

	if err := db.DeleteDocument(r.Context(), c.pool, id); err != nil {
		WriteError(w, http.StatusNotFound, err.Error())
		return
	}
	c.forgetCachedAnswers(r.Context())

	WriteJSON(w, http.StatusOK, map[string]any{
		"status":  "success",
		"message": fmt.Sprintf("Dokumen dengan ID %d berhasil dihapus", id),
	})
}
