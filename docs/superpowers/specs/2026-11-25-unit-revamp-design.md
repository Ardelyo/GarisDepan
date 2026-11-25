# Revamp: unit militer, perluasan wilayah mengalir, UI Satelit Sinematik modern

Tanggal: 25 Nov 2026 · Diminta oleh pemilik proyek; arah visual dipilih lewat mockup (C · Satelit Sinematik, versi modern).

## Maksud
GARIS DEPAN harus terasa seperti peta operasi militer sungguhan, bukan game generik buatan AI:
pasukan berupa **unit** (divisi) dengan simbol militer, bisa digerakkan per unit atau per grup;
wilayah **meluas perlahan mengikuti gerak unit dan goresan panah pemain**; UI yang bersih dan tidak menutupi peta.

## Keputusan pemilik
- Unit **tetap di provinsi** (gaya Hearts of Iron), bukan posisi bebas.
- **Empat jenis unit**: Infanteri, Lapis Baja, Artileri (memperkuat serangan dari provinsi tetangga), Marinir (tanpa penalti amfibi).
- Unit bisa dipilih satu per satu atau dikelompokkan menjadi grup.
- Pergerakan panah mengikuti goresan pemain.
- Perbatasan meluas sesuai pergerakan unit, tidak berganti seketika.
- Arah visual: **Satelit Sinematik modern**. Panel tidak boleh mengganggu peta, tidak boleh terasa "AI slop".

## Pendekatan yang dipertimbangkan
1. **Unit tetap di provinsi** (dipilih). Cocok dengan graf provinsi, simulasi, dan logistik yang ada; risiko sedang.
2. Unit bebas di peta dengan garis depan poligon kontinu. Paling sinematik, tapi menulis ulang simulasi/AI/logistik dan berat di HP.

## Desain
### Simulasi
- `GameState.units: Unit[]` (`id, owner, type, prov, str, org, group, name`), `groups: Group[]`. `ProvState.troops` tetap ada sebagai jumlah turunan dari unit (dipakai AI, kabut, logistik, kapasitas).
- Jenis unit (`UNIT_INFO`): kekuatan maks, biaya, kecepatan, serang/bertahan. Lapis baja kuat di medan terbuka, lemah di gunung/hutan/kota. Artileri: bonus serang untuk serangan ke provinsi yang bertetangga dengan artileri sendiri, dan bonus bertahan. Marinir: penalti amfibi dihapus sesuai porsi marinir dalam kolom.
- **Organisasi** (0–1) turun saat bertempur, pulih saat istirahat; ikut menentukan kekuatan efektif dan kapan penyerang mundur.
- Perintah `serang`/`gerak` membawa daftar `units` (bukan persentase). `rekrut` membawa `type` dan membuat divisi baru.
- Penguatan otomatis mengisi kembali divisi yang kurang; sisa tenaga kerja menjadi cadangan yang membentuk divisi infanteri baru di ibu kota.
- Simpanan versi 1 dimigrasikan otomatis (pasukan per provinsi → divisi infanteri).

### Visual
- Simbol unit gaya NATO: kotak berwarna negara, tanda X (infanteri), oval (lapis baja), titik (artileri), X + gelombang (marinir), eselon "XX". Saat zoom jauh, satu provinsi digabung jadi satu simbol "XXX" + jumlah divisi.
- Panah yang digambar pemain disimpan sebagai goresan; saat resolusi, kolom unit berjalan **di sepanjang goresan itu** (dipetakan ke urutan provinsi). Rute otomatis hanya dipakai bila goresan menyimpang jauh dari rute.
- **Perluasan wilayah**: saat provinsi direbut, warna penyerang menjalar dari titik masuk di sepanjang jalur kolom, melebar sampai menutupi provinsi. Garis perbatasan nasional baru berpindah setelah perluasan selesai.
- Bendera di garis depan dan angka di setiap provinsi diganti tumpukan simbol unit.

### UI
- Permukaan solid gelap (tanpa efek kaca), garis tipis, satu aksen (warna pemain) hanya untuk aksi utama, angka Barlow Condensed, teks Inter, ikon garis SVG (tanpa emoji).
- Kiri atas: tanggal besar + status giliran langsung di atas peta. Kanan atas: satu pil statistik (kas, divisi, stabilitas, timer, info, menu).
- Bawah: dock 4 alat (Serang, Gerak, Garis, Lainnya → Udara/Bangun/Hangus), batal, SELESAI.
- Kartu unit di atas dock saat unit dipilih (simbol, nama, kekuatan, organisasi, grup, tombol Jadikan Grup / Lepas Grup).
- Lembar info tersembunyi sepenuhnya sampai dibuka (tidak ada strip yang menutupi peta).

## Bukan tujuan
Unit udara/laut sebagai unit, pohon riset, posisi unit kontinu, perubahan ekonomi (Putaran 2).

## Diserahkan ke pembangun
Angka balancing awal per jenis unit, tata letak tumpukan simbol, kurva lebar perluasan.
