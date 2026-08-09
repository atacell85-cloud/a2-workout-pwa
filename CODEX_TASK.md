# Codex görevi — A2 Antrenman PWA v1'i bitir ve yayınla

Bu klasörde çalışan vanilla HTML/CSS/JS PWA iskeleti hazırdır. Amaç yeni özellik eklemek değil, mevcut v1'i sağlamlaştırıp iPhone'da kullanılabilir hale getirmektir.

## Değiştirilemez kapsam
1. Program verisi app.js içindeki PLAN nesnesidir; egzersiz/set/tekrar değerlerini kullanıcı açıkça istemedikçe değiştirme.
2. Upper/Lower/Push/Pull, scapula, core ve stretch yapısını koru.
3. Kayıt alanları: kg, tekrar, RIR.
4. Önceki performans egzersiz kartında görünmeli.
5. Set kaydında dinlenme sayacı başlamalı.
6. Antrenman bitince session kalıcı kaydedilmeli.
7. JSON yedek/geri yükleme ve CSV export çalışmalı.
8. Offline PWA çalışmalı.
9. iPhone Safari ve Home Screen standalone kullanımını test et.
10. V1 tamamlanmadan yeni özellik ekleme.

## Yapılacaklar
- Tüm JS hatalarını bul/düzelt.
- Refresh sırasında aktif antrenmanın kaybolmaması için draft session'ı localStorage'a kaydet.
- Set kaydında yalnız ilgili egzersizi rerender et veya input fokus kaybını azalt; kullanım hızını iyileştir.
- iPhone sayı klavyesi ve input ergonomisini doğrula.
- PWA manifest/service worker cache sürümünü düzgün yönet.
- Safari standalone safe-area ve keyboard davranışlarını düzelt.
- Geçmiş ekranında antrenmanları silebilmek için güvenli bir silme aksiyonu ekle.
- README'ye deployment adımlarını ekle.
- Mümkünse ücretsiz statik hosting hedefi olarak GitHub Pages için workflow ekle; repository yoksa sadece workflow/config oluştur.
- Basit manuel test senaryoları ve TEST_CHECKLIST.md oluştur.

## Kabul kriteri
Kullanıcı iPhone'da uygulamayı ana ekrandan açıp: gün seçebilmeli → setlerde kg/tekrar/RIR girebilmeli → önceki kaydı görebilmeli → dinlenme sayacını kullanabilmeli → antrenmanı kaydedebilmeli → geçmişi görebilmeli → JSON/CSV yedeği alabilmeli → internet kesilince uygulamayı açabilmeli.

Kapsam dışına çıkma. Büyük framework migration yapma. Vanilla yapı yeterli; stabiliteyi önceliklendir.
