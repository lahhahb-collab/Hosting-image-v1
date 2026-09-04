# XCY Image Host — 100 MB

Arsitektur:

Browser -> Cloudflare Worker (streaming multipart) -> Catbox -> URL publik `/files/<token>.xcy`

## File
- `worker.js` — API upload + proxy URL `.xcy`
- `wrangler.toml` — konfigurasi Worker + Static Assets
- `public/index.html` — website
- `README.md` — dokumentasi

## Batas
Cloudflare Free membatasi request body Worker sampai 100 MB. Website juga membatasi setiap gambar ke 100 MB.

Worker tidak membuffer seluruh file ke memory. File diteruskan sebagai stream ke Catbox dengan format multipart yang diperlukan API Catbox.

## Deploy
1. Upload semua file/folder ini ke repository.
2. Deploy project sebagai Cloudflare Worker menggunakan Wrangler/Workers Builds.
3. Pastikan `wrangler.toml` menjadi konfigurasi project.
4. Setelah aktif, buka URL Worker. Upload gambar dan URL hasil akan berbentuk `/files/<token>.xcy`.

Penyimpanan file dilakukan oleh Catbox, bukan Cloudflare R2.
