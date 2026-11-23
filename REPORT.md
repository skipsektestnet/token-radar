# REPORT — token-radar-01: Build the best token launch radar

- Kompetisi: `token-radar-01`, hadiah total $1.325 (1st $1.000, 2–5 @ $50, 6–10 @ $25)
- Deadline: 2026-12-14T10:00:00Z
- Akun make.fun: @brawijaya, wallet Solana `9K6KA14C3Uck65pqVYtsH2T4KnuW4WpJyySNHd9Rk8Rh`
- Akun GitHub Aarthi: **skipsektestnet** — https://github.com/skipsektestnet
- Repo yang direncanakan: **https://github.com/skipsektestnet/token-radar** (belum dibuat di GitHub)
- Repo lokal: `~/workspace/makefun/entries/token-radar-01/`, commit lokal `4b0a54d`
  (branch `main`, 1 commit; identitas commit lokal masih placeholder `skip`,
  ganti dengan identitas git Aarthi sebelum push)
- Status: **SIAP SUBMIT (kode + artefak lengkap), BELUM TER-SUBMIT** — terblokir
  karena belum ada repo GitHub dan belum ada akses GitHub di VM (lihat § Submit).

## Apa yang dibangun

Dashboard "Token Radar" (model `radar-2`), Node 22 stdlib-only, tanpa framework
dan tanpa network di halaman:

- `main.ts` — entrypoint: baca `/input/snapshot.json`, tulis `board.json`,
  `data.js`, salin `dashboard/` + `screenshots/`, tulis `dossier.json` via
  `vendor/makefun-board.ts` (file kit).
- `lib/model.ts` — model valuasi, farm plan, dan pembangun board (kode sendiri).
- `dashboard/` — `index.html` (448 B), `app.css` (9.299 B), `app.js`
  (30.618 B); total 40.565 B, di bawah batas teks dossier 65.536 B sehingga
  juri membaca seluruh source dashboard.
- `screenshots/` — 3 PNG 1440×900: `1-board.png` (148.868 B), `2-detail.png`
  (175.756 B), `3-filtered.png` (150.881 B), semuanya ≤ 512 KiB.
- `README.md` (dengan badge make.fun untuk repo yang direncanakan),
  `LICENSE` (MIT), `.makefun/owner.json` (wallet di atas).

Fitur dashboard: board yang bisa di-sort (implied value / TVL / 7d / umur /
nama) dan di-filter (pencarian, kategori, chain, watchlist-only); detail view
per protokol (breakdown nilai, komparabel live se-kategori, farm plan 6
langkah); tab Live token (24 protokol, market cap asli); tab Model (rumus +
tabel kelipatan kategori); deep-link lewat hash (`#p=<slug>`, `#q=`,
`#category=`, `#chain=`, `#wl=1`).

## Metodologi ranking (data snapshot saja, tanpa nama hardcode)

Snapshot DefiLlama 2026-11-14: 758 protokol, floor $50M, watchlist 40.

- **Board: 197 baris** — seluruh 40 watchlist + 157 protokol pre-token lain
  yang rankable (di bawah floor maupun di luar watchlist). Pre-token =
  `mcap_usd`, `gecko_id`, dan `symbol` semuanya null. Dikecualikan: kategori
  CEX / Bridge / Canonical Bridge / Cross Chain Bridge / Liquid (Re)Staking /
  Restaked BTC, nama ber-akhir penanda versi, nama mengandung kata
  wrapped/staked/staking, dan nama berawalan nama exchange. (Satu selisih
  hitungan awal: Circle Gateway adalah Cross Chain Bridge, benar
  dikecualikan.)
- **Implied value** = `TVL × kelipatan_kategori × pertumbuhan × maturitas × breadth`,
  dibulatkan ke dolar:
  - `kelipatan_kategori`: median rasio mcap/TVL protokol live-token di kategori
    yang sama (minimal 3 protokol live), atau median global 0,2049 bila
    kategori kekurangan data; di-clamp [0,05, 1,20]. Dihitung dari snapshot
    itu sendiri saat program jalan — mis. Basis Trading 0,654, Dexs 0,342,
    Lending 0,132, RWA 0,275.
  - pertumbuhan: `1 + clamp(change_7d, -60, 120)/100 × 0,5`.
  - maturitas: `0,6 + min(umur_hari, 1095)/1095 × 0,4` (umur tak diketahui: 365 hari).
  - breadth: `1 + min(jumlah_chain − 1, 6) × 0,015`.
- **Top 5:** 1. Steakhouse Financial $506,8M · 2. Sentora Curator $466,7M ·
  3. Gauntlet $301,8M · 4. Veda $290,2M · 5. USDD $148,9M.
  Total implied value board: $3,75Miliar.
- **Farm plan:** 6 langkah per protokol, diturunkan dari kategori (aksi),
  tier TVL (modal $50–$250), dan umur (hold 30–60 hari); tiap langkah
  menyebut biaya dan waktu. Tidak pernah menjanjikan token dan tidak pernah
  meminta bayaran untuk klaim.
- **Kejujuran data:** dashboard menulis "records no token" (bukan "tidak punya
  token"), dan bahwa implied value adalah klaim entry ini, bukan harga dan
  bukan prediksi peluncuran token.

## Hasil tes (lokal, 2026-11-24)

Jalankan: `MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>`
(dua run ke `out1`/`out2` byte-identik — deterministik, sesuai syarat grader).

Verifikasi terhadap 7 baris gate (skrip cek lokal, semua lolos):

| Check | Hasil |
|---|---|
| dashboard_files | index.html + css + js, 40.565 B, tanpa `http(s)://` di source |
| board_file | 197 baris (100–4000), 299.343 B, semua slug valid, farm_steps 3–12 langkah @ 20–600 karakter |
| sorted_by_value | rank persis 1..197, implied value tidak naik, tidak semua sama |
| coverage | watchlist 40/40 tercakup |
| farm_steps | semua baris lolos panjang langkah |
| screenshots | 3 PNG 1440×900, 148–176 KB (≤ 512 KiB) |
| dossier_matches | `dossier.json` byte-identik dengan `buildDossier` (676.026 B < 1,5 MiB); teks dossier 40.829 B < 65.536 B |

Tes interaksi (Playwright + Chromium headless, viewport 1440×900):

- Pencarian "veda" → 1 baris; filter kategori RWA → 16 baris; filter
  watchlist-only → 40 baris; tab Live token → 24 baris; tab Model menampilkan
  rumus dan tabel kelipatan.
- Detail view 4 protokol (Steakhouse Financial, USDD, Flying Tulip ftUSD,
  Gauntlet): farm plan di halaman **identik** dengan `board.json`, dan
  perhitungan ulang implied value di halaman sama dengan angka board
  ("the same number board.json carries"). Tanpa page error.
- Screenshot diperiksa visual: board rapi; dua bug CSS ditemukan dan diperbaiki
  (tombol sort header tampil sebagai kotak putih; checkbox "Watchlist only"
  terpisah jauh dari label karena `min-width: 170px`).

## Status submit: SIAP, BELUM TER-SUBMIT

**Blocker 1 — GitHub (utama).** VM belum login GitHub (`gh auth status`:
not logged in, tidak ada token). Yang dibutuhkan dari Aarthi: akses GitHub
(PAT atau login) untuk membuat repo publik `skipsektestnet/token-radar`,
push commit lokal `4b0a54d`, lalu set GitHub About (website make.fun + topik
`makefun`) sebelum submit. Tidak ada repo/SHA yang dikarang.

**Blocker 2 — transkrip.** Submit butuh bundle transkrip sesi agen yang
membangun entry (`node cli/makefun.mjs bundle`). Sesi Muse ini tidak
menyimpan log harness yang bisa dibaca `bundle` (tidak ada session file
dengan token usage). Pilihan saat submit nanti:
(a) bangun ulang / lanjutkan build di harness yang sesinya terekam
(Claude Code / Superbot — gratis, sesi terekam dan dibaca bundle), atau
(b) serahkan sesi sebagai `handed_over` — entry tetap dinilai tapi **tidak
bisa menempati paid place** (`handed_over_places: none`). Untuk mengejar
TOP 10 berbayar, opsi (a) yang benar. Perintah submit (setelah kedua
blocker selesai):
`node cli/makefun.mjs submit --competition token-radar-01 --repo-url https://github.com/skipsektestnet/token-radar --commit <sha> --title "Token Radar" --bundle transcripts.tar.gz --keypair <wallet.json>`

**Catatan keamanan:** di awal sesi ini saya sempat menjalankan perintah yang
menampilkan sebagian isi file kredensial make.fun di output tool lokal.
API key tidak pernah dikirim ke mana pun, tapi demi hygiene sebaiknya
**rotasi API key make.fun** (register ulang) sebelum submit.

## Rencana lanjutan untuk mengejar TOP 10

1. Aarthi memberi akses GitHub → buat repo `skipsektestnet/token-radar`,
   push, set About + badge README (sudah disiapkan di `README.md`).
2. Selesaikan soal transkrip (opsi (a) di atas) — idealnya sebelum 1 Des agar
   ada waktu dev-heat (entry dinilai vs 4 house dashboard selama development).
3. Submit awal (dev grade memberi provisional rate) → iterasi berdasarkan
   rate: bila kalah vs house dashboard kuat, perkuat model (mis. bobot
   pertumbuhan kategori-spesifik) atau tampilan detail view.
4. Jangan submit ulang tanpa perubahan berarti (kuota 5/hari, 10 total;
   submission terakhir sebelum deadline adalah final).
5. Pantau `node cli/makefun.mjs status` setelah submit.
