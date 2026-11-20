# راهنمای ساخت و نصب فایل APK برنامه ToobitPulse (کاملاً مستقل و بدون سرور)

پروژه اندروید (**Capacitor Native Android**) به همراه موتور اختصاصی بدون سرور (`nativeToobitEngine`) روی این پروژه راه‌اندازی شده است. در نسخه APK، برنامه مستقیماً از داخل گوشی با استفاده از `CapacitorHttp` و `WebSocket` به API صرافی **Toobit** (`api.toobit.com` و `stream.toobit.com`) متصل می‌شود و هیچ نیازی به سرور یا Google AI Studio ندارد.

> **نکته شفاف:** محیط ابری فعلی دارای Android SDK / Gradle نصب‌شده نیست، بنابراین ساخت فایل باینری نهایی `.apk` از طریق یکی از دو روش زیر (پیشنهادی: **روش ۱ بدون نیاز به نصب هیچ برنامه‌ای روی کامپیوتر**) در ۲ دقیقه انجام می‌شود:

---

## روش ۱ (ساده‌ترین و سریع‌ترین): ساخت خودکار APK با GitHub Actions (بدون نیاز به سیستم یا Android Studio)

فایل ورک‌فلو در مسیر `.github/workflows/build-apk.yml` از قبل آماده شده است:

1. کل پوشه پروژه را در یک مخزن (Repository) جدید در **GitHub** (به صورت Public یا Private) آپلود/Push کنید.
2. وارد تب **Actions** در صفحه گیت‌هاب مخزن خود شوید.
3. اگر بیلد خودکار شروع نشد، روی **Build ToobitPulse Android APK** کلیک کرده و دکمه **Run workflow** را بزنید.
4. حدود ۲ تا ۳ دقیقه صبر کنید تا تیک سبز بگیرد.
5. وارد همان اجرا شوید و از پایین صفحه در بخش **Artifacts**، فایل **`ToobitPulse-Android-APK`** را دانلود و از حالت ZIP خارج کنید؛ فایل **`ToobitPulse-debug.apk`** آماده نصب روی گوشی اندروید شماست!

---

## روش ۲: ساخت APK با Android Studio روی کامپیوتر شخصی

اگر Android Studio روی کامپیوتر دارید:

1. پیش‌نیازها را نصب و پروژه اندروید را همگام‌سازی کنید:
   ```bash
   npm install
   npm run cap:sync
   ```
2. پوشه `/android` را در **Android Studio** باز کنید (`npx cap open android`).
3. از منوی بالا مسیر زیر را بزنید:
   `Build -> Build Bundle(s) / APK(s) -> Build APK(s)`
4. پس از اتمام ساخت، فایل APK در مسیر زیر تولید می‌شود:
   `android/app/build/outputs/apk/debug/app-debug.apk`

یا از خط فرمان داخل پوشه `android`:
```bash
cd android
./gradlew assembleDebug
```

---

## ویژگی‌های نسخه APK مستقل
- **بدون سرور واسط:** تمام درخواست‌های `api.toobit.com` از طریق `CapacitorHttp` در لایه بومی اندروید (بدون محدودیت CORS) انجام می‌شود.
- **وب‌سوکت زنده:** قیمت‌های لحظه‌ای از `wss://stream.toobit.com/quote/ws/v1` مستقیم روی گوشی دریافت می‌شوند.
- **اسکنر و ژورنال آفلاین/محلی:** تمام تحلیل‌های تکنیکال (MTF، TTM Squeeze، SMC، واگرایی CVD)، ژورنال معاملاتی و تنظیمات وبهوک روی حافظه گوشی (`localStorage`) ذخیره می‌شوند.
- **تست‌شده با `ToobitPulse`:** آیکون و نام اپلیکیشن (`com.toobitpulse.radar`) و مجوزهای شبکه در `AndroidManifest.xml` تنظیم شده‌اند.
