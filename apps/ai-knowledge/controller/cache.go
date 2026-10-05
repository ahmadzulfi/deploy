package controller

import (
	"context"
	"log"

	"go-pgvector-gemini/db"
)

// forgetCachedAnswers drops every cached answer after the documents change.
// Without it, a question asked before the change keeps getting the old answer.
//
// Runs even if the caller has gone away: by then the document is already
// saved, and a cache left behind would contradict it. A failure is only
// logged, because the document change itself succeeded.
func (c *DocumentController) forgetCachedAnswers(ctx context.Context) {
	if err := db.ClearQueryCache(context.WithoutCancel(ctx), c.pool); err != nil {
		log.Printf("Peringatan: gagal mengosongkan query cache: %v", err)
	}
}
