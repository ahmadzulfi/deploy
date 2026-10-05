package db

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// InitRouteSchema creates the table that keeps menu embeddings for POST /route.
//
// The free Gemini tier embeds 100 texts a minute, fewer than one menu has, so
// embedding the whole menu again after every restart would leave routing dead
// for a minute and spend the quota the bot needs. Plain REAL[] works with or
// without pgvector; similarity is computed in Go anyway.
func InitRouteSchema(ctx context.Context, pool *pgxpool.Pool) error {
	_, err := pool.Exec(ctx, `
		CREATE TABLE IF NOT EXISTS route_embeddings (
			text_key   TEXT PRIMARY KEY,
			embedding  REAL[] NOT NULL,
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
		);`)
	if err != nil {
		return fmt.Errorf("failed creating route_embeddings: %w", err)
	}
	return nil
}

// RouteStore keeps embeddings by a key derived from the model and the exact
// text, so an edited menu entry gets a new row and the old one is simply
// never asked for again.
type RouteStore struct {
	Pool *pgxpool.Pool
}

func (s RouteStore) Load(ctx context.Context, keys []string) (map[string][]float32, error) {
	rows, err := s.Pool.Query(ctx, `SELECT text_key, embedding FROM route_embeddings WHERE text_key = ANY($1)`, keys)
	if err != nil {
		return nil, fmt.Errorf("failed loading route embeddings: %w", err)
	}
	defer rows.Close()

	out := make(map[string][]float32, len(keys))
	for rows.Next() {
		var key string
		var vec []float32
		if err := rows.Scan(&key, &vec); err != nil {
			return nil, fmt.Errorf("failed scanning route embedding: %w", err)
		}
		out[key] = vec
	}
	return out, rows.Err()
}

func (s RouteStore) Save(ctx context.Context, items map[string][]float32) error {
	batch := &pgx.Batch{}
	for key, vec := range items {
		batch.Queue(`INSERT INTO route_embeddings (text_key, embedding) VALUES ($1, $2) ON CONFLICT (text_key) DO NOTHING`, key, vec)
	}
	if err := s.Pool.SendBatch(ctx, batch).Close(); err != nil {
		return fmt.Errorf("failed saving route embeddings: %w", err)
	}
	return nil
}
