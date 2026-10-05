# 📲 Panduan Integrasi Custom WhatsApp Gateway (`wa_gateway.md`)

Dokumen ini menjelaskan cara menghubungkan WhatsApp Gateway milikmu sendiri (Node.js, Baileys, WPPConnect, Python, dsb.) ke sistem AI ini.

Aplikasi Go ini bertindak sebagai **AI Brain & Knowledge Engine**. Gateway kamu cukup menembak endpoint webhook ini saat ada chat masuk, dan langsung mendapatkan teks balasan yang sudah diformat rapi (*WhatsApp Markdown*).

---

## 📌 Endpoint Webhook WhatsApp

| Parameter | Keterangan |
| :--- | :--- |
| **Endpoint URL** | `POST http://localhost:8080/webhook/wa` *(Lokal)*<br>`POST https://nama-app-kamu.up.railway.app/webhook/wa` *(Railway)* |
| **Alias URL** | `POST /webhook` *(Bisa digunakan sebagai rute alternatif)* |
| **HTTP Method** | `POST` (Direkomendasikan) atau `GET` |
| **Content-Type** | `application/json` atau `application/x-www-form-urlencoded` |

---

## 📥 Format Request dari Gateway Kamu

Endpoint ini dirancang sangat fleksibel dan otomatis mengenali berbagai nama field umum:

### Contoh Request JSON (`POST`)
```json
{
  "sender": "628123456789",
  "message": "ktp saya hilang dompet kecopetan gimana ya"
}
```

> 💡 **Fleksibilitas Field Input:**
> * Untuk isi pesan, kamu bisa pakai key salah satu dari: `"message"`, `"text"`, `"query"`, `"body"`, atau `"msg"`.
> * Untuk nomor pengirim (opsional): `"sender"`, `"from"`, atau `"phone"`.

---

## 📤 Format Response ke Gateway Kamu

Endpoint mengembalikan JSON dengan field balasan yang siap langsung dikirim ke WhatsApp pengguna:

### 1. Respon JSON Default:
```json
{
  "status": "success",
  "reply": "🏛️ *LAYANAN PUBLIK & INFORMASI SOP*\n━━━━━━━━━━━━━━━━━━━━━\n\n📋 *Layanan Terkait:*\n*Penerbitan Surat Keterangan Pengganti KTP Hilang* (Kependudukan)\n\n💬 *Respon AI:*\nHalo, kami turut prihatin atas musibah yang Anda alami...",
  "message": "...", 
  "text": "...",
  "service": "Penerbitan Surat Keterangan Pengganti KTP Hilang",
  "category": "Kependudukan",
  "cache_hit": true,
  "cache_similarity": "99.14%",
  "source": "cache",
  "sender": "628123456789",
  "query": "ktp saya hilang dompet kecopetan gimana ya"
}
```

> **Keuntungan Format ini:**
> Di script WhatsApp bot kamu, kamu tinggal mengambil salah satu dari `res.data.reply`, `res.data.message`, atau `res.data.text` karena isinya sudah diformat dengan tanda `*bold*`, `_italic_`, dan pembatas rapi.

---

### 2. Opsi Plain Text Langsung (`?format=text`):
Jika gateway kamu hanya menerima teks mentah (bukan JSON), cukup tambahkan parameter `?format=text` atau header `Accept: text/plain`:
```text
POST http://localhost:8080/webhook/wa?format=text
```
*Output yang keluar langsung berupa teks:*
```text
🏛️ *LAYANAN PUBLIK & INFORMASI SOP*
━━━━━━━━━━━━━━━━━━━━━

📋 *Layanan Terkait:*
*Penerbitan Surat Keterangan Pengganti KTP Hilang* (Kependudukan)

💬 *Respon AI:*
Halo, kami turut prihatin atas musibah yang Anda alami. Anda dapat mengurus surat keterangan pengganti KTP hilang...

📖 *Panduan & Prosedur:*
Langkah pertama buat surat keterangan kehilangan dari Polsek terdekat, lalu bawa fotokopi KK ke kantor kelurahan...
━━━━━━━━━━━━━━━━━━━━━
_Semoga informasi ini membantu! Silakan tanyakan kembali jika ada kebutuhan lain._
```

---

## 💻 Contoh Integrasi di Script Gateway Kamu

### 1. Contoh di Node.js (Axios / Fetch)
```javascript
const axios = require('axios');

async function handleIncomingWhatsAppMessage(senderNumber, userMessage) {
    try {
        const response = await axios.post('https://nama-app-kamu.up.railway.app/webhook/wa', {
            sender: senderNumber,
            message: userMessage
        });

        const replyText = response.data.reply;

        // Kirim kembali ke WhatsApp user menggunakan gateway kamu
        // Contoh: await sock.sendMessage(senderNumber + '@s.whatsapp.net', { text: replyText });
        return replyText;
    } catch (error) {
        console.error("Gagal memanggil AI Webhook:", error.message);
    }
}
```

### 2. Contoh di Python (Requests)
```python
import requests

def get_ai_reply(sender, message):
    url = "https://nama-app-kamu.up.railway.app/webhook/wa"
    payload = {
        "sender": sender,
        "message": message
    }
    res = requests.post(url, json=payload)
    data = res.json()
    return data.get("reply")
```

### 3. Contoh Testing via cURL
```bash
curl -X POST http://localhost:8080/webhook/wa \
  -H "Content-Type: application/json" \
  -d '{"sender": "628123456789", "message": "ktp hilang dompet kecopetan gimana ya"}'
```
