# ECHO BROWSER

Website-mu, dengan caramu.

EchoBrowser adalah **browser mini berbasis website** dengan identitas visual sendiri (Neo-Brutalism) — bukan clone Google Chrome. Dibuka lewat browser utama (Chrome/Safari/dll), lalu kamu masukkan URL tujuan di dalam address bar EchoBrowser, dan situs tujuan tampil di dalam area viewer EchoBrowser lewat `<iframe>`.

## Fitur

- Homepage khusus dengan shortcut & bookmark cepat
- Address bar cerdas: deteksi otomatis URL vs kata kunci pencarian
- Multi-tab, navigasi back/forward/reload/home
- Bookmark & History tersimpan di `localStorage`
- Shortcut situs favorit yang bisa ditambah/hapus
- Panel Pengaturan (tema Terang/Gelap/Sistem, homepage, mesin pencari, perilaku tab baru)
- Loading state & error page bergaya Neo-Brutalism
- Keyboard shortcut: `Ctrl+L`, `Ctrl+T`, `Ctrl+W`, `Ctrl+R`, `Alt+←`, `Alt+→`
- Responsif penuh: mobile, tablet, desktop

## Struktur Proyek

```
EchoBrowser/
├── index.html      # struktur & markup utama
├── style.css        # desain Neo-Brutalism (CSS variables/token)
├── script.js         # seluruh logika: tab, navigasi, iframe, storage
├── package.json
├── vercel.json
└── README.md
```

Tidak ada folder `/api` — seluruh fitur berjalan 100% di sisi klien (frontend), tidak membutuhkan backend, database, API key, maupun environment variable.

## Batasan Penting: iframe & X-Frame-Options

Beberapa situs (Google, Instagram, X/Twitter, TikTok, situs perbankan, dll) **secara sengaja** menolak ditampilkan di dalam iframe pihak lain, lewat header `X-Frame-Options` atau `Content-Security-Policy: frame-ancestors`. Ini adalah keputusan dari server situs tujuan demi keamanan (mencegah clickjacking), dan **tidak bisa serta tidak boleh** dilewati (bypass) dari sisi JavaScript client. EchoBrowser akan menampilkan halaman error khusus ketika ini terjadi, lengkap dengan tombol "Buka di Browser Utama".

## Menjalankan secara lokal

Karena tidak ada proses build, cukup buka `index.html` langsung di browser, atau jalankan server statis:

```bash
npx serve .
```

## Deploy ke Vercel

1. Push folder ini ke repository GitHub/GitLab/Bitbucket.
2. Import project di [vercel.com/new](https://vercel.com/new).
3. Vercel akan otomatis mendeteksinya sebagai static site (tidak perlu build command) — langsung Deploy.

Atau lewat Vercel CLI:

```bash
npm i -g vercel
vercel
```

## Privasi

Seluruh data (bookmark, riwayat, shortcut, pengaturan) tersimpan di `localStorage` milik perangkatmu sendiri. Tidak ada data yang dikirim ke server manapun oleh EchoBrowser.
