package router

import "strings"

// words maps how residents type to what menu texts say. Abbreviations keep
// the original next to the expansion, since a menu may use either.
var words = map[string]string{
	// Everyday spelling
	"bikin":    "buat",
	"gimana":   "bagaimana",
	"gmn":      "bagaimana",
	"gmana":    "bagaimana",
	"ngurus":   "mengurus",
	"nyari":    "mencari",
	"gak":      "tidak",
	"ga":       "tidak",
	"nggak":    "tidak",
	"enggak":   "tidak",
	"ngga":     "tidak",
	"tdk":      "tidak",
	"yg":       "yang",
	"dgn":      "dengan",
	"utk":      "untuk",
	"untk":     "untuk",
	"sy":       "saya",
	"aja":      "saja",
	"udah":     "sudah",
	"udh":      "sudah",
	"sdh":      "sudah",
	"blm":      "belum",
	"dmn":      "di mana",
	"dimana":   "di mana",
	"kpn":      "kapan",
	"brp":      "berapa",
	"tlg":      "tolong",
	"bs":       "bisa",
	"akte":     "akta",
	"nyicil":   "mencicil",
	"bener":    "benar",
	"perpanjg": "perpanjang",

	// Abbreviations
	"ktp":   "ktp kartu tanda penduduk",
	"kk":    "kk kartu keluarga",
	"sktm":  "sktm surat keterangan tidak mampu",
	"skck":  "skck surat keterangan catatan kepolisian",
	"stnk":  "stnk surat tanda nomor kendaraan",
	"sim":   "sim surat izin mengemudi",
	"pbb":   "pbb pajak bumi dan bangunan",
	"nib":   "nib nomor induk berusaha",
	"mbg":   "mbg makan bergizi gratis",
	"mpp":   "mpp mal pelayanan publik",
	"bnn":   "bnn badan narkotika nasional",
	"bphtb": "bphtb bea perolehan hak atas tanah dan bangunan",
	"skhpn": "skhpn surat keterangan hasil pemeriksaan narkotika",
}

// Normalize lowercases a question and rewrites the words above, keeping
// punctuation where it was.
func Normalize(q string) string {
	fields := strings.Fields(strings.ToLower(q))
	for i, f := range fields {
		core := strings.Trim(f, ".,!?;:\"'()")
		if to, ok := words[core]; ok && core != "" {
			fields[i] = strings.Replace(f, core, to, 1)
		}
	}
	return strings.Join(fields, " ")
}
