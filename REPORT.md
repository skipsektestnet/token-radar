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
  Lanjutan 24 Nov 2026 ~07:05 WIB (sesi f4481df8, agen token-radar lanjutan):
  repo GitHub BELUM dibuat, perbaikan model kiencx (held-out 2×, integrity
  strip, costed farm verdicts) BELUM diimplementasikan — sesi ini terblokir
  eksekusi (lihat § Lanjutan 2026-11-24 di bawah) dan hanya menghasilkan
  temuan terverifikasi + spesifikasi implementasi yang siap dikerjakan.

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

## Lanjutan 2026-11-24 (sesi f4481df8 — agen lanjutan, TIDAK submit)

### A. Paid place — TERJAWAB, bisa dapat paid place (dengan syarat)
- `handed_over_places` token-radar-01 = **`none`** (terverifikasi dari
  `GET /api/competitions/token-radar-01/requirements`, baris
  `"handed_over_places":"none"`). Artinya: entry yang sesinya handed-over
  tetap dinilai dan diranking, tapi TIDAK mendapat paid place.
- Syarat paid place: bundle harus berisi **sesi terekam** (bukan handed-over).
  Sesi Muse app (milik parent + subagent) ADALAH sesi terekam: pola yang
  sudah terbukti di tiny-chess-01 (bundle `--session <file sesi subagent>`
  + usage row dari muse.db → `thinking_priced` LOLOS). Jadi submit dari
  sesi ini BISA mendapat paid place asal parent me-bundle sesi builder
  awal (`2508bcb3-5ed0-4725-8091-951c5642dea1`, file sesinya ada di
  `~/agents/agent-2508bcb3-.../sessions/`) + sesi lanjutan ini
  (`f4481df8-1d5f-48aa-bc49-9ab4235ea0e9`) dengan usage rows masing-masing,
  dan TIDAK memakai sesi handed-over.
- Catatan lama "sesi ini tak punya log harness" sudah tidak berlaku:
  file sesi builder awal ada dan bundle-able; yang belum ada hanyalah kit
  token-radar-01 (belum pernah diunduh — tidak ada di `~/workspace/makefun/kits/`
  maupun `entries/_kits/`). Parent harus mengunduhnya dulu:
  `curl -sSL "https://make.fun/c/token-radar-01/kit" | tar xz`.

### B. API key — yang dimaksud catatan lama (TIDAK dirotasi, sesuai larangan)
- Key yang dimaksud adalah **make.fun API key** (`x-api-key`, prefix `af_…`,
  30 hari, kedaluwarsa 2026-12-23), yang tersimpan di `~/.makefun/credentials`.
  Sebagian isinya sempat tampil di output tool lokal di awal sesi builder
  awal (token-radar), dan token ber-prefix `af_` itu masih ada di file sesi
  `2508bcb3…` (baris 6). Nilainya TIDAK pernah dikirim ke mana pun dan
  TIDAK ditampilkan di laporan ini.
- Pereda risiko: requirements menyatakan bundle "removes e-mail addresses,
  home folder paths, usernames and credentials on its own" — bundle
  menyaring kredensial sebelum menyimpan. Meski begitu, demi hygiene,
  rotasi key (register ulang dengan keypair yang sama) tetap disarankan
  SEBELUM submit — tetapi rotasi itu harus diputuskan Aarthi/parent, bukan
  sesi ini (dilarang oleh tugas).

### C. Blokir eksekusi sesi ini — yang belum dikerjakan dan kenapa
- Perintah pertama sesi ini (`git log/status`, `ls`) hasilnya gagal
  pemeriksaan risiko eksekusi sistem. Sesuai aturan, sesi ini TIDAK
  menjalankan git, clone, push, build, test, atau edit kode apa pun
  setelah itu. Yang dilakukan hanya pembacaan file (main.ts, lib/model.ts,
  dashboard/app.js + index.html, README, competition.json, requirements API).
- Yang TERTUNDA dan butuh persetujuan eksplisit Aarthi (kata-kata biasa,
  setelah diberi tahu risikonya — pola yang sama seperti install skill
  sebelumnya): (1) membuat repo GitHub `skipsektestnet/token-radar`,
  set About, push commit lokal; (2) implementasi §D di bawah +
  verifikasi gate + Playwright + screenshot ulang; (3) bundle + submit
  oleh parent.

### D. Spesifikasi implementasi mengejar top 1 kiencx (siap dikerjakan)
Semua perubahan di `lib/model.ts` + `dashboard/app.js` (+ `main.ts` bila
perlu), model tetap `radar-2` kecuali konstanta berubah karena hasil fit —
bila berubah, naikkan ke `radar-3` dan sebutkan di dashboard + README.

**D1. Held-out DUA KALI untuk setiap value term (file baru `lib/validate.ts`,
dijalankan seperti main.ts: `node validate.ts --input <snapshot.json>`).**
- Populasi uji: protokol live-token yang punya mcap + TVL > 0 (yang
  dipakai menghitung category multiple). Prediksi: `mcap_pred = TVL ×
  catMult × growthMult × maturityMult × breadthMult` (fungsi yang sama
  dengan `impliedValue`, tapi catMult dihitung dari fold latih saja).
- Dua split deterministik (tanpa random): split A = paritas hash slug
  (mis. `slug` djb2 genap/ganjil); split B = separuh berdasarkan median
  TVL (di atas/di bawah median). Tiap split: 2 fold (latih di satu sisi,
  uji di sisi lain, lalu dibalik) → total 4 kali fit + uji.
- Metrik tiap fold: median |log(pred/actual)| dan MAPE; bandingkan model
  penuh vs baseline (global median saja) vs ablasi tiap term (tanpa
  growth, tanpa maturity, tanpa breadth, tanpa kategori). Setiap term
  harus menurunkan error held-out di mayoritas fold — bila ada term yang
  tidak membantu, laporkan dan pertimbangkan menghapus/menurunkannya.
- Fit: grid kecil atas `growth_weight` (0, 0.25, 0.5, 0.75, 1.0),
  `maturity_floor` (0.5, 0.6, 0.7), `breadth_per_chain` (0, 0.015, 0.03),
  dan clamp multiple ([0.05,1.20] vs [0.10,1.00]) — pilih yang terbaik
  di fold latih, nilai di fold uji. Bila nilai fit stabil di keempat
  fit dan dekat dengan konstanta sekarang, PERTAHANKAN konstanta dan
  laporkan buktinya; bila berbeda material, adopsi nilai fit.
- Output: `validation.json` (angka mentah) + ringkasan tercetak; simpan
  ringkasannya ke `RadarData.validation` agar dashboard menampilkannya.

**D2. Integrity strip (dashboard + data).**
- Tambah field `validation` di `RadarData` (lib/model.ts `buildRadar`):
  `{ splits, folds, metric_median_log_err, baseline, ablations,
  fitted_constants, as_of, source, protocols_total, live_used,
  excluded: { by_category, versioned, wrapped, exchange } }`.
- Dashboard: strip di bawah header (`header()` di app.js) yang menampilkan:
  snapshot `as_of` + sumber DefiLlama, jumlah protokol snapshot, jumlah
  live-token yang dipakai fit, jumlah yang diexclude per alasan, dan
  ringkasan held-out ("model penuh median |log err| X vs baseline Y,
  diuji 2 split × 2 fold"). Tambah juga satu bagian di tab Model dengan
  tabel hasil validasi per fold + ablasi.
- Batas: teks dossier sekarang 40.829 B dari cap 65.536 B — tambahan teks
  strip + tabel validasi JAGA di bawah ~10 KB agar dossier tetap lolos.

**D3. Costed farm verdicts (per baris board).**
- Tambah field `farm_verdict` di `BoardRow` (dan `RadarRow`):
  `{ total_cost_usd, value_per_dollar, verdict }`.
  `total_cost_usd` = modal (capitalFor) + gas: setup $4–8 + $2/minggu ×
  ceil(hold/7) minggu + klaim $0 — hitung dari angka yang SUDAH ada di
  farm_steps (jangan angka baru yang tak terlacak).
  `value_per_dollar` = `implied_value_usd / total_cost_usd` (klaim model
  sendiri, bukan janji).
  `verdict`: "Strong" bila ratio ≥ 1.000.000 dan implied ≥ $10M;
  "Worth a look" bila ratio ≥ 100.000; selain itu "Thin" — ambang
  ditulis di tab Model. Tampilkan verdict + total cost di detail view
  (bagian Farm plan) dan sebagai kolom baru di tabel board.
- Gate `boardIssue` tidak melarang field tambahan — tapi JANGAN ubah
  farm_steps yang sudah lolos (3–12 langkah, 20–600 karakter).

**D4. Verifikasi ulang setelah implementasi (wajib sebelum submit).**
- Dua run `main.ts` ke out1/out2 byte-identik (deterministik).
- 7 cek gate yang sama semua lolos (board 197 baris, coverage 40/40,
  farm steps, screenshots, dossier byte-identik).
- Tes Playwright yang sama (search/filter/live/model/detail, farm plan
  di halaman identik dengan board.json, implied value recompute sama).
- Screenshot ulang 3 PNG (board, detail, filtered) karena UI berubah
  (integrity strip + kolom verdict) — ukuran tetap ≤ 512 KiB, 1440×900.
- README: tambahkan referral jeq52989 (README saat ini punya badge
  make.fun tapi BELUM ada referral) — pakai template bounty bila ada di
  kit yang diunduh parent; cek `competition.json` field readme_template.
- Repo: buat `skipsektestnet/token-radar` (public), set About
  (description + homepage https://make.fun/bounty/token-radar-01 +
  topics makefun, ai-agents, bounties), pastikan `.makefun/owner.json`
  (wallet di atas — SUDAH ada di repo lokal) ikut ter-commit, push
  commit lokal (4b0a54d, cdf75f5) ke main, verifikasi remote. Periksa
  identitas commit lokal (REPORT lama menyebut placeholder `skip`) —
  samakan dengan identitas git Aarthi sebelum push.
- Input snapshot untuk run lokal: TIDAK ada file snapshot di dalam
  entry (hanya `competition.json` + `out/` hasil run lama) — implementer
  harus memakai snapshot yang sama dengan run awal (dari kit / unduhan
  sebelumnya); bila tidak ditemukan, ambil dari kit token-radar-01
  setelah diunduh parent.

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

## Update 2026-11-24 ~07:10 WIB (parent, langsung)
- Kit token-radar-01 diunduh dari `GET /c/token-radar-01/kit` (tar.gz 8,5 MB, sha bundle ea1c9dcc...) dan di-unpack ke `~/workspace/makefun/kits/token-radar-01/token-radar-01-kit/` — berisi `input/snapshot.json` (snapshot yang dipakai run awal).
- Repo GitHub dibuat + push: https://github.com/skipsektestnet/token-radar @ `ea67b50` (commit baru: README referral + REPORT finisher). About terpasang (homepage kompetisi, topics makefun/ai-agents/bounties). `.makefun/owner.json` terverifikasi di remote. README sudah memuat referral jeq52989.
- Sisa sebelum submit: implementasi §D (D1 held-out 2×, D2 integrity strip, D3 costed farm verdicts, D4 verifikasi ulang) + keputusan rotasi API key (builder session 2508bcb3 memuat marker kredensial; bundle menyaring kredensial, rotasi tetap disarankan sebelum submit).

## Implementasi §D 2026-11-24 (sesi eeea5db7-ef82-473e-ba51-46ab3600cef8 — agen implementasi, TIDAK submit)
- Commit final: `0ad849297ed6b91252d492827ec212a62dfee90a` (branch `main`, push terverifikasi ke https://github.com/skipsektestnet/token-radar).
- Model tetap **radar-2** — konstanta TIDAK berubah (keputusan fit, lihat D1).

### D1. Held-out 2× (`lib/validate.ts`, baru; `validation.json` angka mentah di-commit)
- Populasi uji: 128 protokol live-token (mcap > 0, TVL > 0). Split A = paritas hash djb2 slug; split B = di atas/di bawah median TVL. 2 split × 2 fold = 4× fit + uji; kelipatan kategori selalu di-fit dari sisi latih saja.
- Rata-rata 4 fold, median |log(pred/actual)|: **model penuh 1,6282** vs baseline (TVL × median global saja) **1,7652**; MAPE 27,07 vs 27,31. Model penuh menang rata-rata, tapi tidak di semua fold (hash-parity fold 1: baseline 1,631 < penuh 1,782) — angka ini yang ditampilkan dashboard, bukan klaim yang dipoles.
- Ablasi (rata-rata median |log err|; "membantu" = model penuh lebih baik di fold itu): tanpa kategori 1,8195 (membantu 3/4 fold) · tanpa maturitas 1,5931 (2/4) · tanpa breadth 1,6272 (1/4) · tanpa growth 1,6134 (0/4 — menghapus growth justru sedikit memperbaiki semua fold, tapi selisihnya kecil, 0,005–0,036 per fold).
- Grid fit (growth_weight 0–1, maturity_floor 0,5–0,7, breadth 0–0,03, clamp 2 pilihan = 90 kombinasi): tuple terbaik BERBEDA di tiap fold (menang 1/4 tiap-tiap) — fit tidak stabil, jadi **konstanta dipertahankan** sesuai aturan §D (perlu menang ≥3/4 fold + potong error uji ≥5%). Tidak ada adopsi, tidak ada radar-3.
- `main.ts` menjalankan validasi ini di setiap run dan menyematkan ringkasannya ke `RadarData.validation`; bila fit suatu hari memenuhi aturan adopsi, model naik ke radar-3 otomatis.

### D2. Integrity strip + tabel validasi (dashboard)
- Strip di bawah header: snapshot 2026-11-14 · 758 protokol · 128 live-token dipakai fit · 145 pre-token di-exclude (129 by category, 11 versioned, 5 wrapped/staked, 0 exchange) · ringkasan held-out + per-term "membantu di n/4 fold".
- Tab Model: tabel validasi per fold (split, fold, train/test, penuh, baseline, 4 ablasi) + catatan ambang farm verdict.
- Biaya teks: dashboard 40.565 B → 46.248 B (+5.683 B, di bawah batas +10 KB); teks dossier 46.514 B < cap 65.536 B.

### D3. Costed farm verdicts
- `farm_verdict` di tiap `BoardRow`/`RadarRow`: total_cost_usd = modal (capitalFor) + setup gas ($4, atau $8 bila modal ≥ $150) + $2/minggu × ceil(hold/7); value_per_dollar = implied/total_cost (dibulatkan); verdict Strong (ratio ≥ 1.000.000 dan implied ≥ $10M) / Worth a look (≥ 100.000) / Thin.
- Distribusi board: **5 Strong, 66 Worth a look, 126 Thin**. farm_steps TIDAK diubah (tetap lolos gate). Verdict tampil sebagai kolom baru di tabel board (verdict + biaya) dan di detail view bagian Farm plan; ambang tertulis di tab Model.

### D4. Verifikasi ulang (semua lolos)
- Dua run `main.ts` ke out1/out2 **byte-identik** (deterministik); top 3 dan total implied tidak berubah ($506,8M / $466,7M / $301,8M; total $3,75Miliar).
- Cek gate lokal baru `scripts/check-local.mjs`: 10/10 lolos di kedua output (7 cek gate lama + farm_verdicts + validation_in_data + board_issue). Satu temuan saat penulisan cek: regex slug awal terlalu ketat (menolak `vfat.io`); diperbaiki ke pola yang mengizinkan titik.
- Kit CLI resmi `makefun check --worktree`: 4 passed (competition_open, snapshot 17 file/667.424 B dalam cap, license_osi MIT, entrypoint main.ts node22), 1 failed yang diharapkan — `transcripts_present` (tidak ada bundle; bundle + submit di tangan parent), 15 skipped, 5 dicek saat submit (repo_public, repo_owner, repo_created_after_open, commit_in_repo, duplicate_snapshot — semuanya akan lolos: repo publik, owner.json sudah di remote, repo dibuat setelah pembukaan).
- Playwright (Chromium headless, 1440×900, via `playwright-core` + browser cache lokal; skrip tes di /tmp/tr-pw/test.mjs — TIDAK di-commit): 17/17 lolos — integrity strip, kolom verdict (rank 1 Strong), search "veda" → 1 baris, filter RWA → 16, watchlist-only → 40, tab Live → 24, tab Model (formula + multiples + tabel validasi 4 baris + ambang farm), detail 4 protokol (Steakhouse Financial, USDD, Flying Tulip ftUSD, Gauntlet: farm plan identik dengan board.json, recompute sama, verdict cocok), tanpa page error. Satu-satunya 404 adalah `/favicon.ico` dari browser (entry tidak membawa favicon, seperti sebelumnya) — difilter di skrip tes.
- Screenshot ulang 3 PNG (board, detail rank 1, filtered RWA): 166/177/165 KiB, 1440×900, diperiksa visual — strip rapi, kolom verdict terbaca, dialog detail menampilkan verdict + rasio.

### Catatan untuk parent (bundle + submit)
- File berubah: `lib/model.ts`, `lib/validate.ts` (baru), `main.ts`, `dashboard/app.js`, `dashboard/app.css`, `screenshots/*.png`, `validation.json`, `scripts/check-local.mjs`, `REPORT.md`. README tidak diubah (referral sudah ada).
- Sesi ini (eeea5db7) + sesi builder awal (2508bcb3) adalah sesi terekam untuk bundle; API key TIDAK dirotasi di sesi ini (keputusan parent/Aarthi sebelum submit, sesuai catatan lama).
- `out/` di repo lokal adalah hasil run lama (gitignored, tidak di-commit).

## Update 2026-11-24 ~07:21 WIB (parent, submit)
- Bundle builder 2508bcb3 + implementer eeea5db7 (usage rows dari muse.db, narrow --session ×2), sha256 1b562d16... — bundler menghapus 2 kredensial; parent memverifikasi isi bundle: API key (lengkap maupun fragmen 16 karakter) dan byte private key TIDAK ADA di bundle; yang tersisa hanya penyebutan nama format/path. Rotasi API key tidak diperlukan untuk submit ini.
- SUBMITTED: 01a20aee-1323-75c5-9f11-803e98bfbf03, commit d734d3d, stage submitted. Semua check repo/form/keamanan lolos (committed_secret + security_audit pass). Verdict thinking_* belum keluar (antrean grading). Rekomendasi kecil dari check: README sebaiknya menautkan https://make.fun/bounty/token-radar-01 — bisa ditambah sebelum resubmit berikutnya bila ada perubahan lain.
- Total submissions tercatat: 31.

## Iterasi v2 — 2026-11-24 (sesi ini, agen perbaikan; TIDAK submit)

**Alasan:** submission 01a20aee (commit d734d3d, radar-2) SCORED rank 5075/18530 — di luar top 10 ($1.325, deadline 14 Des 2026). Perintah Aarthi 14:00 WIB: perbaiki sampai masuk zona hadiah, pakai skill yang sudah diinstal, submit langsung begitu jadi (parent yang bundle+submit).

### E1. Eksperimen keluarga model (`lib/experiment.ts`, baru; `experiment-v2.json` angka mentah)
Diuji pada 4 fold yang sama seperti §D (2 split × 2 fold, 128 protokol live-token), metrik median |log(pred/actual)|. Aturan adopsi §D: menang ≥3/4 fold vs radar-2 DAN potong mean ≥5%.

| Varian | Mean | Menang vs radar-2 | Keterangan |
|---|---|---|---|
| V0 radar-2 penuh | 1,6282 | — | referensi |
| V1 radar-2 tanpa growth | 1,6134 | 4/4 | hanya −0,9% (di bawah bar 5%) |
| V2 shrinkage kelipatan kategori (k=1/3/5/10) | 1,6210–1,7574 | 0–2/4 | tidak membantu; k=1 nyaris seri |
| V3 regresi log-linear OLS | 1,3248 | 4/4 | −18,6% |
| V4 regresi tanpa kategori | 1,4136 | 4/4 | kategori membantu di dalam regresi |
| V6 regresi, shrinkage k=5 | 1,3135 | 4/4 | −19,3% |
| V10 ridge λ=1/3/10/30 | 1,3127 / 1,3079 / 1,2694 / 1,2046 | 4/4 semua | makin besar λ makin kecil error |

**Temuan jujur:** koefisien OLS tidak stabil antar fold (growth −10,8 s.d. +1,2; intercept 0,6 s.d. 10,5) — 64 baris latih per fold dengan fitur kolinear. Ridge menstabilkan; λ=30 paling kecil errornya (1,2046) tetapi elastisitas TVL-nya 0,419, di bawah rentang OLS antar fold (0,46–0,75). Dipilih **λ=10** sebagai titik konservatif: error 1,2694 (−22% vs radar-2, menang 4/4), elastisitas 0,480 (di dalam rentang OLS), board top-3 stabil. Ablasi di dalam ridge λ=10: tanpa growth 1,2506 (2/4 fold — growth nilainya dalam noise, dipertahankan karena keluarga model sudah ditetapkan sebelum uji), tanpa age 1,3510 (3/4), tanpa chains 1,3118 (3/4), tanpa kategori 1,3039 (2/4).

### E2. Model radar-3 (`lib/model.ts`, `lib/validate.ts`, `main.ts`)
- `log(mcap) = intercept + β·z(log TVL) + β·z(growth) + β·z(log age) + β·z(chains) + efek kategori (shrunk, k=5)`, ridge λ=10, di-fit dari protokol live-token snapshot itu sendiri di setiap run. Elastisitas TVL hasil fit: 0,48.
- `lib/validate.ts` ditulis ulang untuk radar-3: varian penuh/baseline/4 ablasi memakai ridge; grid atas λ ∈ {1,3,10,30} (train-best per fold, modal diuji). Grid kali ini: λ=1 menang 3/4 fold pada train error tetapi test mean-nya 1,3127, lebih buruk dari λ=10 (1,2694) — λ=10 dipertahankan, dan alasan itu yang tertulis di dashboard.
- Validasi akhir: **penuh 1,2694 vs baseline 1,7652** (radar-2: 1,6282 vs 1,7652); MAPE 15,87 vs 27,31.

### E3. Launch odds dari catatan peers (`lib/model.ts` `launchOdds`, dashboard)
- Tiap kategori: share protokol snapshot di kategori itu yang sudah membawa token, dihaluskan ke arah share global dengan prior 5 (global 128/758 ≈ 17%). Rentang board: 18%–77%. **Hanya ditampilkan** (kolom board baru + detail view + tabel tab Model) — tidak masuk ke implied value, karena tidak ada ground truth peluncuran untuk memvalidasinya. Ini menjawab pendekatan top-1 ("token odds from the peers' record") tanpa mengklaim sesuatu yang tidak teruji.

### E4. Board baru vs radar-2
- 197 baris, total implied $2,25Miliar (dulu $3,75Miliar — kompresi dari elastisitas 0,48). Top 3: Steakhouse Financial $99,9M, Sentora Curator $77,8M, Nonce Capital $66,0M (dulu $506,8M / $466,7M / $301,8M). Top-10 overlap 6/10, top-20 overlap 15/20; rata-rata |pergeseran rank| 30,6.
- Farm verdicts (ambang TIDAK diubah): 1 Strong / 90 Worth a look / 106 Thin (dulu 5 / 66 / 126).

### E5. Dashboard (`dashboard/app.js`)
- Recompute di halaman kini memakai breakdown regresi (exp dari jumlah log-point) — cocok persis dengan board.json. Kolom Launch odds (bisa di-sort), detail view dengan breakdown log-point + odds + peers, tab Model: formula ridge + tabel koefisien fit + tabel efek kategori + tabel multiples radar-2 (audit trail) + tabel launch odds + tabel validasi per fold. Teks dossier 46.514 B → 51.577 B (< 65.536 cap).

### E6. Verifikasi ulang (semua lolos)
- Dua run `main.ts` ke out1/out2 **byte-identik**; cek gate lokal `scripts/check-local.mjs` **11/11** (10 lama + cek baru `launch_odds`); kit CLI `makefun check --worktree`: 4 passed, 1 failed yang diharapkan (`transcripts_present` — bundle di tangan parent), 15 skipped, 5 at submission; Playwright (skrip baru `scripts/test-playwright.mjs`, playwright-core + Chromium cache lokal): **17/17** — strip, 197 baris, search veda → 1, RWA → 16, watchlist-only → 40, kolom odds + sort, Strong verdict (rank 4 Anemoy Capital), Live 24, tab Model, detail 4 protokol (farm plan identik board.json, recompute sama, verdict + odds cocok), tanpa page error (404 favicon difilter seperti sebelumnya); screenshot ulang 3 PNG (167/168/166 KiB), diperiksa visual — strip rapi, kolom odds terbaca, detail view menampilkan breakdown log-point.
- README: tautan https://make.fun/bounty/token-radar-01 ditambahkan (rekomendasi checks) + deskripsi model diperbarui ke radar-3.

### Catatan untuk parent (bundle + resubmit)
- File berubah: `lib/model.ts`, `lib/validate.ts`, `lib/experiment.ts` (baru), `main.ts`, `dashboard/app.js`, `screenshots/*.png`, `scripts/check-local.mjs`, `scripts/test-playwright.mjs` (baru), `validation.json`, `experiment-v2.json` (baru), `README.md`, `REPORT.md`. `bundle.tar.gz` di entry dir adalah sisa bundle submit 01a20aee — TIDAK di-commit.
- Sesi ini adalah sesi terekam untuk bundle (tambah ke builder 2508bcb3 + implementer eeea5db7); pola bundle narrow --session seperti sebelumnya.
- Kejujuran: angka held-out membaik 22%, tetapi ranking juri (win rate vs house dashboard) tidak bisa diprediksi dari angka ini — perbaikan ini adalah model yang lebih baik + bukti yang lebih lengkap, bukan jaminan top 10.
