# GARIS DEPAN — Rencana Game Strategi Peta

Nov 25, 2026 · @Lio

## 1. Ringkasan konsep

GARIS DEPAN adalah game strategi peta di mana pemain memimpin negara dengan cara **menggambar langsung di peta**: panah serangan, garis pertahanan, jalur rel, pabrik, dan kota. Mainnya giliran simultan (WEGO), bisa hot-seat 2–8 orang di satu HP/PC, dan tiap giliran "diputar" seperti video peta perang yang viral.

**Fantasi pemain:** jadi panglima sekaligus kepala negara di ruang perang, dengan peta besar dan spidol di tangan.

**Pilar desain**

1. **Gambar = perintah.** Hampir semua aksi dilakukan dengan menggambar, bukan klik menu berlapis.
2. **Dunia yang masuk akal.** Populasi, logistik, medan, dan ekonomi saling terkait; tentara tanpa suplai akan runtuh.
3. **Rahasia itu senjata.** Strategi lawan tidak pernah terlihat saat bergantian main di satu perangkat.
4. **Tiap giliran adalah tontonan.** Resolusi giliran dianimasikan sinematik, layak direkam dan diunggah.
5. **Menang tidak harus perang.** Ekonomi, diplomasi, dan aliansi sama sahnya dengan penaklukan.

**Target:** mobile (portrait & landscape) dan PC, satu basis kode, sesi 20–90 menit.

## 2. Bedah video referensi

Kelima video memakai bahasa visual yang sama: peta besar sebagai panggung, wilayah berwarna jenuh yang "tumbuh", dan angka besar yang berdetak. Yang diambil ke game ada di tabel ini.

| Video | Yang terlihat | Diambil ke GARIS DEPAN |
| --- | --- | --- |
| 1 — Skenario invasi pulau (satelit gelap) | Peta satelit gelap, zona merah/biru dengan pola titik-titik saat maju, ledakan berpendar, pesawat & kapal kecil, cap tanggal per hari, label "Landing Zone" | Tema **Satelit**, pola stipple untuk wilayah yang sedang direbut, ledakan bloom, cap tanggal per giliran, zona pendaratan amfibi |
| 2 — Front semenanjung | Dua blok warna (merah vs teal), angka pasukan raksasa berdetak, bendera kecil berderet di garis depan | **Counter pasukan besar** dengan animasi hitung naik/turun, bendera sebagai penanda divisi di garis depan |
| 3 — "Flag invasion" | Negara terisi merah, bendera menyerbu melintasi perbatasan, spotlight/vignette ke titik kontak, transisi isi warna | **Animasi aneksasi** (warna mengalir dari titik masuk), bendera-bendera maju sebagai unit, vignette fokus ke pertempuran |
| 4 — Peta kartun, timer | Peta datar ala kartun, unit bulat merah/biru, garis depan hitam tangan, panah tipis ke target, angka pasukan & korban di pojok | Tema **Kartun** untuk peta polos, **garis depan hitam bergaya tangan**, panah gambar, HUD statistik di pojok |
| 5 — Peta kartun berkontur | Medan berlapis (hutan, gunung abu, laut), unit melingkar, motion blur saat kamera menyapu, teks status besar | Lapisan medan bertingkat, **kamera sapu + motion blur** saat pindah fokus, teks besar saat momen penting ("GAGAL", "DIKEPUNG") |

Catatan orisinalitas: game mengambil *teknik* animasinya, bukan watermark, palet persis, atau tata letak HUD video-video tersebut.

## 3. Keputusan: giliran simultan (WEGO)

Pilihannya **WEGO**: semua pemain menyusun perintah diam-diam secara bergantian, lalu semua perintah dieksekusi **bersamaan** sebagai animasi real-time 10–20 detik. Satu giliran = 1 minggu waktu game.

| Opsi | Masalah untuk konsep ini | Hasil |
| --- | --- | --- |
| Real-time murni | Dua orang tidak bisa bergantian satu layar tanpa melihat strategi lawan; di HP terlalu sibuk | Ditolak |
| Turn-based biasa (aku dulu, lalu kamu) | Pemain kedua selalu bereaksi terhadap gerakan pertama; serangan serentak tidak mungkin | Ditolak |
| **WEGO** | Perencanaan tenang & rahasia, eksekusi tetap terasa real-time dan sinematik | **Dipakai** |

**Opsi tempo** (diatur saat lobi):

- **Santai:** tanpa batas waktu perencanaan.
- **Komando:** 90 detik per pemain, timer berjalan di layar.
- **Blitz:** 45 detik, resolusi dipercepat 2×.

Saat resolusi berjalan, pemain bisa **jeda, putar ulang, atau percepat**, dan memilih "kamera sutradara" yang otomatis menyorot pertempuran terbesar.

## 4. Core loop & alur hot-seat

Satu giliran selalu berjalan dalam enam tahap; tirai privasi muncul setiap kali perangkat berpindah tangan.

&#91;embedded content: siklus satu giliran · 6 tahap\]

Pemain 1 sampai N merencanakan bergantian, resolusi hanya terjadi sekali setelah semua menekan "Selesai".

**Tirai privasi (anti-ngintip)**

1. Pemain menekan **Selesai Rencana**. Peta langsung di-blur kuat (Gaussian 40 px + noise), semua angka & panah disembunyikan.
2. Layar menampilkan bendera & nama pemain berikutnya: "Serahkan ke PEMAIN 2". Pemain sebelumnya tidak bisa kembali.
3. Pemain berikutnya **menahan tombol 1 detik** untuk membuka, supaya tidak terbuka tak sengaja saat HP disodorkan.
4. Opsional: **PIN 4 digit** per pemain untuk grup yang kompetitif.
5. Peta terbuka hanya dengan **kabut perang milik pemain itu**: wilayah sendiri, wilayah tetangga, dan hasil intel. Panah lawan tidak pernah tersimpan di tampilan bersama.

**Yang boleh terlihat semua orang:** peta politik terakhir hasil resolusi, tanggal, dan pengumuman publik (deklarasi perang, perjanjian resmi). Yang dirahasiakan: perintah, kas, produksi, isi proposal diplomasi, dan kekuatan pasukan di luar jangkauan intel.

## 5. Sistem dunia realistis

Dunia dibagi menjadi **provinsi** (±600 di peta dunia, 80–300 di peta polos). Setiap provinsi punya data yang saling memengaruhi; tidak ada angka yang berdiri sendiri.

| Atribut provinsi | Isi | Memengaruhi |
| --- | --- | --- |
| Populasi | jumlah jiwa, % urban | pajak, tenaga kerja, rekrutmen, kerusuhan |
| Medan | dataran, hutan, gunung, gurun, rawa, hutan hujan, kota | kecepatan gerak, bonus bertahan, biaya bangun |
| Iklim & musim | tropis, sedang, dingin; hujan/salju per bulan | atrisi, kecepatan, hasil panen |
| Infrastruktur | level jalan 0–5, rel, pelabuhan, bandara | jangkauan suplai, kecepatan bangun & gerak |
| Sumber daya | pangan, baja, minyak, logam langka, energi | produksi pabrik, ekspor |
| Kontrol & loyalitas | pemilik, okupan, % dukungan | pajak efektif, pemberontakan, partisan |

**Aturan inti yang membuatnya terasa nyata**

- **Logistik:** pasukan menarik suplai dari depot lewat jalan/rel. Lewat jarak jangkau, kekuatan turun 10% per minggu dan atrisi naik. Pengepungan = suplai putus = moral runtuh dalam 2–3 giliran.
- **Tenaga kerja:** maksimal ±2% populasi bisa dimobilisasi tanpa gejolak; di atas itu ekonomi melambat dan stabilitas turun.
- **Medan & musim:** gunung memberi bertahan +50%, rawa memperlambat lapis baja 60%, musim salju menambah atrisi. Serangan musim hujan di tropis jadi pilihan berisiko.
- **Kelelahan perang:** korban dan wilayah yang hilang menaikkan *war weariness*; terlalu tinggi memicu demo, kudeta, atau tuntutan damai.
- **Pendudukan:** wilayah yang direbut tidak langsung produktif; butuh 4–10 giliran untuk integrasi, dan bisa memunculkan partisan.

Semua angka di atas adalah nilai awal untuk balancing, bukan data dunia nyata yang diklaim akurat.

## 6. Ekonomi, kota & bangunan

Ekonomi adalah mesin perang: **PDB provinsi = populasi × produktivitas × faktor infrastruktur × stabilitas**. Kas negara diisi pajak setiap giliran, lalu dibagi lewat tiga slider anggaran: **Militer / Sipil / Riset**.

**Cara membangun:** pilih alat Bangun, lalu gambar atau ketuk di provinsi. Bangunan butuh uang, sumber daya, dan waktu (giliran), dan antre per provinsi.

| Bangunan | Cara digambar | Waktu | Fungsi |
| --- | --- | --- | --- |
| Pabrik sipil | ketuk provinsi | 4 giliran | +PDB, bisa diubah jadi militer saat perang (2 giliran) |
| Pabrik militer | ketuk provinsi | 5 giliran | produksi senjata, tank, amunisi |
| Perluasan kota | lingkari area di sekitar kota | 6 giliran | +populasi urban, +pajak, butuh pangan |
| Kota baru | ketuk lahan kosong | 10 giliran | pusat suplai & pajak baru |
| Jalan / rel | gambar garis antar-provinsi | 1 giliran per provinsi | jangkauan suplai, kecepatan gerak |
| Pelabuhan / bandara | ketuk provinsi pesisir/datar | 4 giliran | perdagangan laut, invasi amfibi, basis udara |
| Tambang / kilang / ladang | ketuk ikon sumber daya | 3 giliran | baja, minyak, pangan |
| Pembangkit listrik | ketuk provinsi | 4 giliran | syarat pabrik berlevel tinggi |
| Garis benteng | gambar garis di perbatasan | 1 giliran per segmen | bonus bertahan +25% sampai +75% |

**Rantai produksi sederhana:** pangan → populasi tumbuh; baja + energi → pabrik militer → peralatan divisi; minyak → lapis baja, pesawat, kapal. Kekurangan satu bahan menurunkan output, bukan menghentikannya total.

**Perdagangan:** gambar garis rute dagang ke negara lain (harus ada perjanjian). Rute laut bisa diblokade kapal musuh, sehingga perang ekonomi jadi strategi nyata.

## 7. Militer: menggambar perang

Pasukan adalah **tentara** (gabungan divisi) yang tampil sebagai bendera + angka besar, persis gaya counter di video referensi. Pemain tidak menggerakkan unit satu per satu; pemain **menggambar niat**, dan tentara menjalankannya selama resolusi.

**Bahasa gambar perintah**

| Gambar | Arti | Detail |
| --- | --- | --- |
| Panah dari tentara ke wilayah | Serang / maju | tebal panah = % pasukan yang dikerahkan (25/50/100%); panah melengkung = rute pilihan |
| Garis di sepanjang perbatasan | Garis depan bertahan | pasukan menyebar rata di garis itu; bisa ditambah benteng |
| Panah putus-putus | Bergerak tanpa menyerang | reposisi, mundur teratur |
| Lingkaran tertutup di wilayah musuh | Target pengepungan | dua panah yang bertemu di lingkaran = operasi jepit |
| Panah dari laut ke pantai | Invasi amfibi | butuh armada + pelabuhan; zona pendaratan ditandai seperti video 1 |
| Area yang diarsir | Zona udara | pesawat mengejar superioritas udara atau mengebom area itu |
| Tanda silang | Bumi hangus / hancurkan infrastruktur | menahan musuh, merugikan diri sendiri |

**Resolusi pertempuran** (dihitung per provinsi yang bersentuhan, lalu dianimasikan):

- Kekuatan efektif = jumlah pasukan × kualitas peralatan × pengubah medan × suplai × moral × superioritas udara.
- Korban memakai versi sederhana hukum kuadrat Lanchester, jadi keunggulan jumlah terasa tapi tidak mutlak.
- Penyerang butuh rasio kira-kira 1,5 : 1 untuk menang di dataran, 3 : 1 di gunung atau kota.
- Garis depan adalah **poligon kontrol yang bergeser halus**, bukan petak yang meloncat, sehingga terlihat seperti video 1 dan 2.
- Dua serangan yang bertemu di tengah sama-sama menjadi pertempuran berjalan (meeting engagement); inilah keunggulan WEGO.

**Jenis kekuatan:** infanteri, lapis baja, artileri, pasukan gunung/marinir, sayap udara, armada laut, dan rudal (late game). Senjata nuklir tidak dimasukkan di versi awal agar fokus tetap pada strategi konvensional.

## 8. Diplomasi & politik dalam negeri

Berteman sama pentingnya dengan berperang. Setiap pasangan negara punya nilai **hubungan −100 sampai +100** yang naik lewat dagang dan bantuan, turun lewat ancaman, mata-mata, dan perang.

**Perjanjian yang tersedia:** pakta non-agresi, akses militer, perjanjian dagang, aliansi pertahanan, aliansi penuh, gencatan senjata, perjanjian damai (dengan penyerahan wilayah, ganti rugi, atau zona demiliterisasi), dan status negara satelit.

**Diplomasi di mode hot-seat**

1. Pemain A menyusun proposal di fase rencananya (misalnya: "Aliansi + akses militer, aku bayar 200/giliran").
2. Proposal masuk ke **kotak masuk rahasia** pemain B dan baru terlihat saat giliran B terbuka di balik tirai.
3. B menerima, menolak, atau membuat tawaran balik. Hasil yang diterima diumumkan publik setelah resolusi; yang ditolak hanya diketahui kedua pihak.
4. **Pengkhianatan diizinkan**: melanggar perjanjian memberi penalti reputasi global dan kelelahan perang lebih cepat.

**Negara non-pemain (AI):** negara kecil tetap hidup dengan kepribadian sederhana (netral, oportunis, agresif, pasifis). Mereka bisa dirangkul, dibeli, atau diancam.

**Politik dalam negeri**

- **Stabilitas (0–100%)** turun karena pajak tinggi, korban perang, dan kekurangan pangan.
- **Bentuk pemerintahan** generik: demokrasi (pemilu tiap 4 tahun game, kelelahan perang lebih sensitif) atau otoriter (stabil, tapi rawan kudeta dan produktivitas riset lebih rendah). Tidak memakai ideologi atau partai dunia nyata.
- **Event acak berbasis kondisi:** krisis pangan, demo besar, skandal, terobosan riset, bencana alam. Pemain memilih respons dengan konsekuensi.
- **Intel & spionase:** agen bisa mencuri info rencana lawan untuk satu giliran, satu-satunya cara "mengintip" yang sah.

## 9. Kondisi menang

Tuan rumah memilih satu atau lebih kondisi di lobi; yang pertama tercapai menang. Default: semua aktif, batas 200 giliran (±4 tahun game).

| Kondisi | Syarat | Gaya bermain |
| --- | --- | --- |
| Dominasi | kuasai 60% populasi dunia atau semua ibu kota pemain lain | penakluk |
| Ekonomi | pegang 40% PDB dunia selama 12 giliran berturut-turut | pedagang, industrialis |
| Diplomasi | pimpin blok aliansi yang menguasai mayoritas suara Dewan Dunia selama 8 giliran | negosiator |
| Skor | skor tertinggi saat batas giliran (wilayah, PDB, stabilitas, prestise) | seimbang |
| Skenario | tujuan khusus, misalnya "pertahankan pulau 30 giliran" | tantangan |

Pemain yang ibu kotanya jatuh tidak langsung kalah: ia bisa pindah ibu kota dan bertahan sebagai **pemerintahan pengasingan** selama masih punya satu provinsi atau sekutu yang menampung. Ini menjaga pemain hot-seat tetap ikut sampai akhir.

## 10. Kontrol menggambar

Kontrol dirancang untuk jari dulu, lalu dipetakan ke mouse. Gambar selalu bisa dibatalkan sebelum "Selesai Rencana".

| Aksi | Mobile | PC |
| --- | --- | --- |
| Geser peta | dua jari geser | klik kanan tahan / WASD |
| Zoom | cubit | scroll |
| Pilih tentara | ketuk bendera | klik kiri |
| Gambar panah | tarik dari tentara ke tujuan | klik kiri tahan + tarik |
| Atur kekuatan panah | angkat jari, slider 25/50/100% muncul di ujung panah | scroll saat menggambar |
| Gambar garis/area | pilih alat di dock, lalu gores | tombol 2 / 3, lalu gores |
| Menu konteks | tekan lama | klik kanan |
| Batal / ulang | geser tiga jari ke kiri/kanan, atau tombol | Ctrl+Z / Ctrl+Y |
| Hapus perintah | ketuk panah, pilih ikon tong sampah | klik panah, Delete |

**Pengenalan goresan (agar gambar kasar tetap rapi):**

1. Titik goresan dihaluskan (Douglas–Peucker lalu spline Catmull–Rom).
2. Bentuk dikenali: garis terbuka = panah/garis, goresan tertutup = lingkaran/area, X = hancurkan.
3. Ujung goresan di-*snap* ke pusat provinsi atau perbatasan terdekat, lalu digambar ulang sebagai panah bergaya spidol.
4. Perintah tidak valid (misalnya lewat laut tanpa armada) langsung berwarna merah bergaris dengan alasan singkat.

Semua target sentuh minimal 44 × 44 pt, dan ada mode **kidal** yang membalik posisi dock.

## 11. UI/UX mobile-first

Peta selalu menjadi 70–80% layar; semua panel lain melayang dan bisa disembunyikan dengan satu ketukan.

&#91;embedded content: wireframe layar perencanaan · portrait\]

Di landscape (PC dan tablet), dock pindah ke sisi kiri dan lembar provinsi menjadi panel kanan, sehingga peta tetap lebar.

**Layar-layar utama**

1. **Lobi:** pilih peta, jumlah pemain (2–8), slot manusia/AI, warna & bendera, kondisi menang, tempo.
2. **Perencanaan:** wireframe di atas; tab lembar bawah berisi Provinsi, Negara, Produksi, Riset.
3. **Tirai privasi:** layar blur penuh, bendera pemain berikutnya, tombol tahan untuk buka.
4. **Resolusi:** HUD minimal (tanggal, tombol jeda/percepat/putar ulang), kamera otomatis.
5. **Laporan giliran:** kartu yang bisa digeser: wilayah direbut, korban, kas, event, proposal masuk.
6. **Diplomasi:** daftar negara dengan meter hubungan, tombol Usul, kotak masuk rahasia.

**Prinsip:** angka besar & tebal, ikon + label (bukan ikon saja), warna negara tidak boleh jadi satu-satunya pembeda (tambahkan pola dan bendera untuk buta warna), dan tidak ada aksi penting yang butuh dua tangan.

## 12. Art direction & animasi

Dua tema visual memakai satu sistem animasi yang sama: **Satelit** (peta dunia, gelap & dramatis, ala video 1–3) dan **Kartun** (peta polos, flat & cerah, ala video 4–5).

**Lapisan peta (bawah ke atas):** dasar medan (satelit atau flat) → isi warna negara semi-transparan 45–60% → pola arsir/stipple wilayah sengketa → perbatasan bercahaya → garis depan hitam bergaya spidol → unit (bendera + angka) → efek (ledakan, pesawat, kapal) → kabut perang → HUD.

**Palet:** latar laut biru tua kehitaman (tema Satelit) atau biru cerah (Kartun); 8 warna negara jenuh yang tetap terbedakan untuk buta warna (setiap negara juga punya pola arsir). Tipografi: sans tebal kondensed untuk angka besar dengan outline gelap 3 px, sans biasa untuk label.

**Spesifikasi animasi**

| Animasi | Pemicu | Durasi | Detail |
| --- | --- | --- | --- |
| Aliran aneksasi | provinsi berpindah tangan | 600–900 ms | warna mengalir dari titik masuk (radial wipe + noise), lalu perbatasan berdenyut sekali |
| Garis depan bergeser | setiap tick resolusi | kontinu | poligon di-*morph* halus, tepi depan berstipple titik-titik seperti video 1 |
| Barisan bendera | tentara maju | mengikuti panah | 3–8 bendera kecil berderet melaju di sepanjang panah, berguncang saat kontak |
| Counter berdetak | jumlah pasukan berubah | 400 ms | angka hitung naik/turun, berkedip merah saat turun tajam, skala 1,15× lalu kembali |
| Ledakan | pertempuran besar / bom | 500 ms | flash putih + bloom, cincin asap, guncangan kamera kecil (2 px) |
| Pesawat & kapal | misi udara/laut | kontinu | ikon kecil bergerak dengan jejak putih tipis, berbelok halus |
| Gambar panah | pemain menggambar | real-time | goresan spidol muncul di bawah jari, lalu "tersnap" dengan efek pop 150 ms |
| Kamera sapu | fokus pindah ke front lain | 450 ms | pan cepat + motion blur arah gerak (video 5), ease in-out |
| Spotlight | pertempuran penentu | 1,2 s | vignette menggelap di luar area, zoom 1,3× (video 3) |
| Teks momen | dikepung, ibu kota jatuh, gagal | 1 s | teks besar tebal muncul dengan hentakan, warna negara pelaku |
| Cap tanggal | awal setiap tick | 200 ms | tanggal di HUD berganti dengan efek ketik/flip |
| Tirai privasi | ganti pemain | 350 ms | blur naik dari 0 ke 40 px + fade gelap, bendera pemain berikutnya slide-in |

**Audio:** dentum artileri jauh, deru pesawat, coretan spidol saat menggambar, dan musik orkestra minimalis yang naik intensitasnya mengikuti jumlah pertempuran aktif.

**Mode rekam:** tombol "Rekam Resolusi" mengekspor giliran sebagai video vertikal 9:16 dengan cap tanggal dan statistik, siap diunggah ke TikTok/Reels.

## 13. Peta: dunia nyata, peta polos, editor

Tiga sumber peta, satu format data internal (provinsi + graf ketetanggaan + atribut).

**A. Peta dunia nyata**

- Batas dari **Natural Earth admin-1** (domain publik), disederhanakan dengan mapshaper sampai ±600 provinsi yang enak dimainkan.
- Populasi, medan, dan sumber daya diisi dari data terbuka lalu dibulatkan untuk balancing; game memberi label "terinspirasi dunia nyata", bukan simulasi akurat.
- Skenario awal: **Dunia 2027** (fiksi dekat, semua negara netral di awal) dan **Benua Terbagi** (2–4 blok besar). Negara memakai nama dan bendera generik bisa diganti pemain, sehingga game tidak memihak konflik nyata mana pun.

**B. Peta polos prosedural**

1. Heightmap dari noise (simplex + domain warp) → garis pantai benua dan pulau.
2. Iklim dari lintang + jarak ke laut → bioma (hutan, gurun, tundra, hutan hujan).
3. Provinsi dari Voronoi berbobot (lebih kecil di dataran subur, lebih besar di gurun/gunung).
4. Kota awal ditempatkan di pesisir & sungai, negara dibagi adil berdasarkan populasi.
5. Seed bisa dibagikan, jadi grup bisa main peta yang sama lagi.

**C. Editor peta ("Kanvas Kosong")**

Pemain menggambar daratan dengan kuas, mengecat medan, menarik sungai, menaruh kota, lalu menekan **Bagi Provinsi** untuk Voronoi otomatis. Cocok untuk skenario buatan sendiri, peta dunia fiksi, atau peta kelas/sekolah. Peta disimpan sebagai file `.gdmap` (JSON terkompresi) yang bisa dibagikan.

## 14. Mode permainan & multiplayer lokal

Fokus rilis pertama adalah **hot-seat satu perangkat**; semua mode lain memakai mesin giliran yang sama.

| Mode | Pemain | Catatan |
| --- | --- | --- |
| Hot-seat | 2–8 manusia, satu HP/PC | tirai privasi, PIN opsional, simpan & lanjut kapan saja |
| Campuran | manusia + AI | AI merencanakan instan tanpa tirai, kesulitan Rekrut → Jenderal |
| Tim | 2 vs 2, 3 vs 3 | anggota tim melihat panah rekan (warna lebih pudar) tapi tetap bergiliran |
| Skenario | 1–4 | tujuan khusus, peta buatan, tutorial interaktif 5 misi |
| Sandbox | 1+ | tanpa kondisi menang, untuk membuat "video peta" sendiri |
| LAN / online asinkron | 2–8, beda perangkat | **pasca-rilis**; karena perintah berbentuk data, cukup kirim file perintah per giliran |

**Aturan hot-seat yang penting**

- Urutan perencanaan diacak tiap giliran agar tidak ada yang selalu terakhir.
- Simpan otomatis setelah tiap resolusi; game bisa dilanjut besok di perangkat yang sama.
- **Mode Wasit**: satu orang bisa jadi tuan rumah yang mengatur jeda, mengulang resolusi, dan menampilkan replay ke layar TV via cast.

## 15. Tech stack & arsitektur

Rekomendasi: **TypeScript + PixiJS (WebGL/WebGPU)**, dibungkus **Capacitor** untuk Android/iOS dan **Tauri** untuk PC. Satu basis kode web, ringan, dan cocok dengan alur kerja AI-agent. Alternatif kalau ingin engine penuh: Godot 4 (ekspor mobile/PC bawaan, tapi rendering peta vektor besar butuh kerja ekstra).

**Lapisan arsitektur (atas ke bawah)**

1. **UI** (Svelte atau React ringan): lobi, dock, lembar bawah, tirai privasi.
2. **Input & pengenal goresan:** gesture → bentuk → perintah ter-*snap*.
3. **Renderer peta** (PixiJS): mesh provinsi pra-triangulasi, shader isi warna + arsir + kabut, partikel efek.
4. **Sutradara resolusi:** memutar hasil simulasi per tick sebagai animasi, mengatur kamera otomatis.
5. **Simulasi deterministik** (TypeScript murni, tanpa akses render): `state + semua perintah → state baru + log event`. Seed acak tetap, jadi hasil bisa diputar ulang dan nanti disinkronkan online.
6. **Data:** state JSON, simpan ke IndexedDB/berkas; peta `.gdmap`.

**Kenapa simulasi dipisah dari animasi:** resolusi dihitung dulu dalam milidetik, lalu animasi hanya "membacakan" log event. Akibatnya replay, rekam video, mode cepat, dan multiplayer online jadi murah.

**Target performa:** 60 fps di Android kelas menengah (misalnya RAM 4 GB), resolusi giliran ≤ 200 ms untuk 600 provinsi & 8 negara, ukuran unduhan < 150 MB.

**AI lawan:** utility AI per negara (skor kebutuhan: aman, ekonomi, ekspansi) + perencana front sederhana yang menghasilkan perintah dalam format yang sama dengan pemain.

## 16. Roadmap

Prioritasnya membuktikan keseruan inti (gambar + tirai + resolusi) di minggu ke-2, sebelum membangun dunia besar.

&#91;embedded content: roadmap · 6 fase, ±20 minggu, tidak berskala\]

Durasi adalah estimasi untuk 1–2 developer dibantu AI agent; setiap fase baru dimulai setelah gate-nya lolos.

## 17. Risiko & pertanyaan terbuka

| Risiko | Dampak | Penanganan |
| --- | --- | --- |
| Sistem terlalu rumit untuk sesi hot-seat santai | pemain lelah menunggu giliran orang lain | preset "Ringkas" (ekonomi otomatis, hanya militer & diplomasi), timer Komando |
| Gambar di layar kecil tidak presisi | perintah salah sasaran | snap ke provinsi, preview sebelum dilepas, undo tiga jari |
| Performa peta dunia di HP murah | lag, baterai boros | mesh pra-triangulasi, LOD perbatasan, batasi efek partikel |
| Isu sensitif peta & konflik nyata | kontroversi, penolakan toko aplikasi | nama & bendera negara generik, skenario fiksi, tidak ada senjata pemusnah massal |
| Pemain "ngintip" tetap terjadi | strategi bocor | tirai + PIN, panah lawan tak pernah dirender di layar bersama, intel sebagai jalur resmi |
| Balancing sulit | satu strategi mendominasi | log simulasi otomatis, ribuan game AI vs AI headless untuk uji |

**Pertanyaan terbuka untuk diputuskan**

- [ ] Nama final: GARIS DEPAN, atau nama lain?
- [ ] Tema visual rilis pertama: Satelit, Kartun, atau keduanya sekaligus?
- [ ] Engine: TypeScript + PixiJS (rekomendasi) atau Godot 4?
- [ ] Seberapa dalam ekonomi di versi awal: rantai produksi penuh atau preset Ringkas dulu?
- [ ] Monetisasi: premium sekali beli, atau gratis dengan paket peta/skenario?
