package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"strings"
	"time"

	"go-pgvector-gemini/db"
	"go-pgvector-gemini/embedding"

	"github.com/joho/godotenv"
	"github.com/pgvector/pgvector-go"
)

type DocumentItem struct {
	ID        int       `json:"id"`
	Category  string    `json:"category"`
	Title     string    `json:"title"`
	Content   string    `json:"content"`
	CreatedAt time.Time `json:"created_at"`
}

func main() {
	if err := godotenv.Load(); err != nil {
		log.Println("Peringatan: file .env tidak ditemukan, menggunakan environment variable.")
	}

	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		log.Fatal("DATABASE_URL tidak diatur di .env")
	}

	geminiKey := os.Getenv("GEMINI_API_KEY")
	if geminiKey == "" {
		log.Fatal("GEMINI_API_KEY tidak diatur di .env")
	}

	modelName := os.Getenv("GEMINI_MODEL")
	if modelName == "" {
		modelName = "gemini-embedding-001"
	}

	ctx := context.Background()

	fmt.Println("1. Mengkoneksikan ke PostgreSQL...")
	pool, err := db.Connect(ctx, dbURL)
	if err != nil {
		log.Fatalf("Gagal konek DB: %v", err)
	}
	defer pool.Close()

	fmt.Println("2. Mengosongkan dan me-reset tabel database (ResetDatabase)...")
	if err := db.ResetDatabase(ctx, pool); err != nil {
		log.Fatalf("Gagal reset database: %v", err)
	}
	fmt.Println("   Database berhasil di-reset bersih. ID kembali ke 1.")

	fmt.Println("3. Membaca file dummy_data.json...")
	dataBytes, err := os.ReadFile("dummy_data.json")
	if err != nil {
		log.Fatalf("Gagal membaca dummy_data.json: %v", err)
	}

	var items []DocumentItem
	if err := json.Unmarshal(dataBytes, &items); err != nil {
		var wrapper struct {
			Data []DocumentItem `json:"data"`
		}
		if err2 := json.Unmarshal(dataBytes, &wrapper); err2 != nil {
			log.Fatalf("Gagal parse dummy_data.json: %v", err)
		}
		items = wrapper.Data
	}

	fmt.Printf("   Ditemukan %d item data untuk dimasukkan.\n", len(items))

	fmt.Println("4. Inisialisasi Gemini Embedding Client...")
	embedder, err := embedding.NewGeminiEmbedder(ctx, geminiKey, modelName)
	if err != nil {
		log.Fatalf("Gagal inisialisasi Gemini client: %v", err)
	}
	defer embedder.Close()

	fmt.Println("5. Memproses embedding dan menyimpan ke database (diberi jeda agar aman dari rate limit)...")
	successCount := 0
	for i, item := range items {
		titleWithCat := fmt.Sprintf("[%s] %s", item.Category, item.Title)

		var vec pgvector.Vector
		var err error

		// Retry logic with backoff for rate limiting
		for attempt := 1; attempt <= 5; attempt++ {
			vec, err = embedder.GenerateDocumentEmbedding(ctx, titleWithCat, item.Content)
			if err == nil {
				break
			}

			if strings.Contains(err.Error(), "429") || strings.Contains(err.Error(), "RESOURCE_EXHAUSTED") {
				log.Printf("[%d/%d] Rate limit hit (attempt %d). Menunggu 45 detik...", i+1, len(items), attempt)
				time.Sleep(45 * time.Second)
				continue
			}

			log.Printf("[%d/%d] Error embed '%s': %v (attempt %d). Retry dalam 2 detik...", i+1, len(items), item.Title, err, attempt)
			time.Sleep(2 * time.Second)
		}

		if err != nil {
			log.Fatalf("Gagal generate embedding '%s': %v", item.Title, err)
		}

		_, err = db.InsertDocument(ctx, pool, item.Category, item.Title, item.Content, vec)
		if err != nil {
			log.Fatalf("[%d/%d] Gagal simpan ke DB '%s': %v", i+1, len(items), item.Title, err)
		}

		successCount++
		if successCount%10 == 0 || successCount == len(items) {
			fmt.Printf("   Progress: %d/%d data berhasil di-embed & disimpan.\n", successCount, len(items))
		}

		// Jeda 650ms antara request agar laju rata-rata ~90 req/menit (di bawah batas 100 RPM)
		time.Sleep(650 * time.Millisecond)
	}

	total, _ := db.CountDocuments(ctx, pool)
	fmt.Println("==========================================================")
	fmt.Printf("SELESAI! Total data di tabel 'docs-gemini-001': %d dokumen.\n", total)
	fmt.Println("==========================================================")
}
