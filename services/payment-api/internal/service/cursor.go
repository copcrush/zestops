package service

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"time"

	"github.com/google/uuid"
)

// PageCursor marks the last row of a page for keyset pagination.
// It is sent to clients as an opaque base64url string.
type PageCursor struct {
	CreatedAt time.Time `json:"created_at"`
	ID        uuid.UUID `json:"id"`
}

// ErrInvalidCursor means the client sent a cursor we did not create.
var ErrInvalidCursor = errors.New("invalid pagination cursor")

// Encode returns the opaque cursor string.
func (cursor PageCursor) Encode() string {
	encodedJSON, _ := json.Marshal(cursor)
	return base64.RawURLEncoding.EncodeToString(encodedJSON)
}

// DecodePageCursor parses a cursor produced by Encode.
func DecodePageCursor(encodedCursor string) (PageCursor, error) {
	if len(encodedCursor) > 200 {
		return PageCursor{}, ErrInvalidCursor
	}
	decodedJSON, err := base64.RawURLEncoding.DecodeString(encodedCursor)
	if err != nil {
		return PageCursor{}, ErrInvalidCursor
	}
	var cursor PageCursor
	if err := json.Unmarshal(decodedJSON, &cursor); err != nil || cursor.ID == uuid.Nil || cursor.CreatedAt.IsZero() {
		return PageCursor{}, ErrInvalidCursor
	}
	return cursor, nil
}
