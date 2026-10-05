package controller

import (
	"net/http"

	"go-pgvector-gemini/embedding"

	"github.com/jackc/pgx/v5/pgxpool"
)

type DocumentController struct {
	pool     *pgxpool.Pool
	embedder *embedding.GeminiEmbedder
}

func NewDocumentController(pool *pgxpool.Pool, embedder *embedding.GeminiEmbedder) *DocumentController {
	return &DocumentController{
		pool:     pool,
		embedder: embedder,
	}
}

// DocumentRequest is the shared payload format for creating and updating documents.
type DocumentRequest struct {
	Category string `json:"category"`
	Title    string `json:"title"`
	Content  string `json:"content"`
}

// RegisterRoutes registers all document-related routes to the provided ServeMux.
func (c *DocumentController) RegisterRoutes(mux *http.ServeMux) {
	// Root API Info
	mux.HandleFunc("GET /", c.HandleRoot)

	// CRUD Documents
	mux.HandleFunc("GET /documents", c.HandleGetAllDocuments)
	mux.HandleFunc("GET /documents/{id}", c.HandleGetDocumentByID)
	mux.HandleFunc("POST /documents", c.HandleCreateDocument)
	mux.HandleFunc("PUT /documents/{id}", c.HandleUpdateDocument)
	mux.HandleFunc("DELETE /documents/{id}", c.HandleDeleteDocument)

	// Database Maintenance: Reset & Seed
	mux.HandleFunc("POST /documents/reset", c.HandleResetDatabase)
	mux.HandleFunc("POST /documents/seed", c.HandleSeedDatabase)

	// Semantic Vector Search
	mux.HandleFunc("POST /documents/search", c.HandleSemanticSearch)
	mux.HandleFunc("GET /documents/search", c.HandleSemanticSearch)
}

func (c *DocumentController) HandleRoot(w http.ResponseWriter, r *http.Request) {
	WriteJSON(w, http.StatusOK, map[string]any{
		"service": "Internal AI Knowledge Service (pgvector + Gemini RAG)",
		"status":  "running",
		"endpoints": map[string]string{
			"POST /documents":        "Tambah dokumen (embed vector otomatis diisi oleh Gemini)",
			"GET /documents":         "Ambil semua dokumen (?limit=50&offset=0)",
			"GET /documents/{id}":    "Ambil dokumen spesifik",
			"PUT /documents/{id}":    "Update dokumen (embed vector otomatis di-generate ulang)",
			"DELETE /documents/{id}": "Hapus dokumen",
			"POST /documents/reset":  "Kosongkan dan reset struktur tabel documents (membutuhkan X-Admin-Secret)",
			"POST /documents/seed":   "Otomatis isi data dummy SOP Layanan Publik",
			"POST /documents/search": "Pencarian kemiripan semantik & AI Feedback Assistant ({ \"query\": \"...\" })",
			"POST /route":            "Pilih tujuan menu untuk node Arahkan AI claudewa ({ question, catalog_hash, destinations })",
		},
	})
}
