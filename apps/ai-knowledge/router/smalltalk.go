package router

import (
	"strings"
	"unicode"
)

// smallTalk are words that make up a message which asks for nothing:
// thanks, okays, greetings. A message made only of these, or of no words at
// all (an emoji, a sticker caption), is answered null without spending an
// embedding - the contract wants null for these, and their scores would
// otherwise sit right among real questions.
var smallTalk = map[string]bool{
	"terima": true, "kasih": true, "makasih": true, "trims": true, "thanks": true,
	"thank": true, "you": true, "thx": true, "tq": true, "banyak": true,
	"ok": true, "oke": true, "okay": true, "okey": true, "okee": true, "sip": true,
	"siap": true, "baik": true, "ya": true, "iya": true, "y": true, "yaa": true,
	"halo": true, "hallo": true, "hai": true, "hi": true, "hello": true,
	"selamat": true, "pagi": true, "siang": true, "sore": true, "malam": true,
	"assalamualaikum": true, "wr": true, "wb": true, "permisi": true,
	"mantap": true, "mantab": true, "bagus": true, "sudah": true, "udah": true,
	"kak": true, "min": true, "admin": true, "pak": true, "bu": true,
}

func isSmallTalk(question string) bool {
	words := strings.FieldsFunc(strings.ToLower(question), func(r rune) bool {
		return !unicode.IsLetter(r) && !unicode.IsDigit(r)
	})
	for _, w := range words {
		if !smallTalk[w] {
			return false
		}
	}
	return true
}
