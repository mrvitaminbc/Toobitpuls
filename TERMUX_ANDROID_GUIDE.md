# اجرای مستقل توبیت‌پالس روی گوشی اندروید (بدون سرور و بدون Google AI Studio)

این راهنما برای اجرای ۱۰۰٪ محلی اپلیکیشن و نصب آن به‌صورت **PWA مستقل** روی گوشی اندروید از طریق **Termux** آماده شده است.

---

## ۱. پیش‌نیازها روی گوشی اندروید
1. برنامه **Termux** را از **F-Droid** یا صفحه رسمی GitHub Termux نصب کنید (نسخه قدیمی گوگل‌پلی آپدیت نمی‌شود).
2. فایل پروژه را از AI Studio دانلود (`Download ZIP`) و در حافظه گوشی (مثلاً پوشه `Download/toobitpulse`) استخراج کنید.

---

## ۲. اجرا با یک دستور در Termux
وارد Termux شوید و دستورات زیر را به‌ترتیب بزنید:

```bash
termux-setup-storage
cd ~/storage/downloads/toobitpulse
bash android-termux.sh
```

اسکریپت `android-termux.sh` به‌صورت خودکار این کارها را انجام می‌دهد:
1. در صورت نبود Node.js، پکیج `nodejs-lts` را داخل Termux نصب می‌کند.
2. وابستگی‌های پروژه (`node_modules`) را نصب می‌کند.
3. نسخه نهایی PWA (شامل Service Worker و Manifest) و باندل سرور بهینه (`dist-server/server.mjs`) را می‌سازد.
4. سرور محلی را روی `http://localhost:3000` بالا می‌آورد و مرورگر گوشی را باز می‌کند.

---

## ۳. نصب به‌عنوان اپلیکیشن مستقل (PWA) روی صفحه اصلی گوشی
1. وقتی آدرس **`http://localhost:3000`** در مرورگر **Chrome** گوشی باز شد (محدودیت HTTPS روی `localhost` وجود ندارد):
2. روی دکمه **«نصب نسخه موبایل»** داخل برنامه یا از منوی سه نقطه کروم روی **Add to Home screen / Install app** بزنید.
3. آیکون **ToobitPulse** به صفحه اصلی گوشی اضافه می‌شود و مانند یک اپلیکیشن بومی (تمام‌صفحه، بدون نوار آدرس مرورگر) اجرا می‌گردد.

---

## ۴. اجرای سریع یک‌لمسی با Termux:Widget (اختیاری)
اگر افزونه رایگان **Termux:Widget** را از F-Droid نصب کنید، می‌توانید یک میانبر روی صفحه اصلی گوشی بگذارید که با یک لمس سرور را روشن کند:

```bash
mkdir -p ~/.shortcuts
cat <<'EOF' > ~/.shortcuts/ToobitPulse.sh
#!/data/data/com.termux/files/usr/bin/bash
cd ~/storage/downloads/toobitpulse && bash android-termux.sh
EOF
chmod +x ~/.shortcuts/ToobitPulse.sh
```

> برای بیلد مجدد پس از دریافت آپدیت جدید کد: `bash android-termux.sh --rebuild`
