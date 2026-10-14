package main

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"go-pgvector-gemini/controller"
	"go-pgvector-gemini/db"
	"go-pgvector-gemini/embedding"
	"go-pgvector-gemini/router"

	"github.com/joho/godotenv"
)

func enableCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Internal-API-Key, X-API-Key, X-Admin-Secret")

		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusOK)
			return
		}

		next.ServeHTTP(w, r)
	})
}

func authMiddleware(next http.Handler) http.Handler {
	internalKey := os.Getenv("INTERNAL_API_KEY")
	if internalKey == "" {
		internalKey = os.Getenv("AI_SERVICE_API_KEY")
	}

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Root "/" dipersilakan untuk health check tanpa API key
		if r.URL.Path == "/" {
			next.ServeHTTP(w, r)
			return
		}

		if internalKey != "" {
			reqKey := r.Header.Get("X-Internal-API-Key")
			if reqKey == "" {
				reqKey = r.Header.Get("X-API-Key")
			}
			if reqKey == "" {
				authHeader := r.Header.Get("Authorization")
				if strings.HasPrefix(authHeader, "Bearer ") {
					reqKey = strings.TrimPrefix(authHeader, "Bearer ")
				}
			}

			if reqKey != internalKey {
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusUnauthorized)
				_, _ = w.Write([]byte(`{"status":"error","message":"Akses ditolak: X-Internal-API-Key tidak valid atau tidak disertakan"}`))
				return
			}
		}

		next.ServeHTTP(w, r)
	})
}

// envFloat reads a number from the environment, falling back when it is unset
// or not a number.
func envFloat(name string, fallback float64) float64 {
	if v, err := strconv.ParseFloat(strings.TrimSpace(os.Getenv(name)), 64); err == nil {
		return v
	}
	return fallback
}

func main() {
	if err := godotenv.Load(); err != nil {
		log.Println("Peringatan: file .env tidak ditemukan, menggunakan environment variable sistem.")
	}

	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		log.Fatal("Error: DATABASE_URL tidak diatur di file .env")
	}

	geminiKey := os.Getenv("GEMINI_API_KEY")
	if geminiKey == "" {
		log.Fatal("Error: GEMINI_API_KEY tidak diatur di file .env")
	}

	modelName := os.Getenv("GEMINI_MODEL")
	if modelName == "" {
		modelName = "gemini-embedding-001"
	}

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	ctx := context.Background()

	fmt.Println(" Mengkoneksikan ke PostgreSQL...")
	pool, err := db.Connect(ctx, dbURL)
	if err != nil {
		log.Fatalf("Gagal konek ke database: %v", err)
	}
	defer pool.Close()
	fmt.Println(" Berhasil terkoneksi ke PostgreSQL!")

	fmt.Println(" Memverifikasi struktur tabel 'docs-gemini-001'...")
	if err := db.InitSchema(ctx, pool); err != nil {
		log.Fatalf("Gagal inisialisasi schema: %v", err)
	}
	fmt.Println(" Schema & ekstensi pgvector siap digunakan.")

	fmt.Printf(" Inisialisasi Gemini Embedding Client (%s)...\n", modelName)
	embedder, err := embedding.NewGeminiEmbedder(ctx, geminiKey, modelName)
	if err != nil {
		log.Fatalf("Gagal inisialisasi Gemini client: %v", err)
	}
	defer embedder.Close()
	fmt.Println(" Gemini Embedder siap!")

	mux := http.NewServeMux()

	// Inisialisasi DocumentController dan daftarkan endpoint routes
	docController := controller.NewDocumentController(pool, embedder)
	docController.RegisterRoutes(mux)

	// Router menu untuk node Arahkan AI di claudewa (kontrak POST /route).
	if err := db.InitRouteSchema(ctx, pool); err != nil {
		log.Fatalf("Gagal menyiapkan tabel route_embeddings: %v", err)
	}
	routeCfg := router.Config{
		MinScore:      envFloat("ROUTE_MIN_SCORE", 0.62),
		MinMargin:     envFloat("ROUTE_MIN_MARGIN", 0.02),
		ExampleMin:    envFloat("ROUTE_EXAMPLE_MIN", 0.9),
		ExampleHint:   envFloat("ROUTE_EXAMPLE_HINT", 0.8),
		Namespace:     modelName + "/768/RETRIEVAL_DOCUMENT",
		ChooseTimeout: time.Duration(envFloat("ROUTE_CHOOSER_TIMEOUT", 2.5) * float64(time.Second)),
	}
	// "off" mematikan pemilih AI; router lalu hanya memakai skor embedding.
	chooserModel := strings.TrimSpace(os.Getenv("ROUTE_CHOOSER_MODEL"))
	if chooserModel == "" {
		chooserModel = "gemini-flash-lite-latest"
	}
	if chooserModel != "off" {
		routeCfg.Chooser = embedder.Chooser(chooserModel)
	}
	rt := router.New(embedder, db.RouteStore{Pool: pool}, routeCfg)
	controller.NewRouteController(rt).RegisterRoutes(mux)

	addr := ":" + port
	fmt.Printf("\n [AI KNOWLEDGE SERVICE] REST API berjalan di http://localhost%s\n", addr)
	fmt.Println("-----------------------------------------------------------------")
	fmt.Printf(" [POST]   http://localhost%s/documents         -> Tambah data (Auto-embed vector)\n", addr)
	fmt.Printf(" [GET]    http://localhost%s/documents         -> Lihat semua data\n", addr)
	fmt.Printf(" [GET]    http://localhost%s/documents/{id}    -> Lihat data berdasarkan ID\n", addr)
	fmt.Printf(" [PUT]    http://localhost%s/documents/{id}    -> Update data\n", addr)
	fmt.Printf(" [DELETE] http://localhost%s/documents/{id}    -> Hapus data\n", addr)
	fmt.Printf(" [POST]   http://localhost%s/documents/reset   -> Hapus & reset bersih tabel database (Protected)\n", addr)
	fmt.Printf(" [POST]   http://localhost%s/documents/seed    -> Otomatis masukkan data dummy SOP Layanan Publik\n", addr)
	fmt.Printf(" [POST]   http://localhost%s/documents/search  -> Pencarian Semantik & AI Feedback Assistant\n", addr)
	fmt.Printf(" [POST]   http://localhost%s/route             -> Router menu Arahkan AI (skor min %.2f, contoh min %.2f, pemilih AI: %s)\n", addr, routeCfg.MinScore, routeCfg.ExampleMin, chooserModel)
	fmt.Println("-----------------------------------------------------------------")

	if os.Getenv("INTERNAL_API_KEY") != "" || os.Getenv("AI_SERVICE_API_KEY") != "" {
		fmt.Println(" 🔒 Proteksi API Aktif: Request internal wajib menyertakan 'X-Internal-API-Key'")
	} else {
		fmt.Println(" ⚠️  Perhatian: INTERNAL_API_KEY belum diatur di .env (Akses internal belum diproteksi)")
	}

	handler := enableCORS(authMiddleware(mux))
	if err := http.ListenAndServe(addr, handler); err != nil {
		log.Fatalf("Server gagal berjalan: %v", err)
	}
}
