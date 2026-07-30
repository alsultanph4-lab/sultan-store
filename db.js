/* =========================================================
   db.js — منطق مشترك بين لوحة التحكم (admin.html) والمتجر (index.html)
   ========================================================= */

// ---------- إعدادات عامة (يمكن تعديلها هنا) ----------
const STORE_NAME    = "صيدلية السلطان";
const WHATSAPP_NUMBER = "966552933233"; // بالصيغة الدولية بدون +
const MAX_PRODUCTS  = 500;
const CODE_PREFIX   = "SLT";

// الفئات الست المعتمدة
const CATEGORIES = [
  { key: "skin",     label: "عناية بالبشرة" },
  { key: "hair",     label: "عناية بالشعر" },
  { key: "beauty",   label: "عناية بالجمال" },
  { key: "personal", label: "عناية شخصية" },
  { key: "baby",     label: "عناية بالطفل" },
  { key: "meds",     label: "الأدوية والمكملات الغذائية" }
];

function categoryLabel(key) {
  const c = CATEGORIES.find(c => c.key === key);
  return c ? c.label : key;
}

/* =========================================================
   IndexedDB — تخزين محلي (مسودة عمل داخل نفس المتصفح)
   ========================================================= */
const IDB_NAME = "sultan_store_db";
const IDB_VERSION = 1;
const IDB_STORE = "products";

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, IDB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        const store = db.createObjectStore(IDB_STORE, { keyPath: "code" });
        store.createIndex("category", "category", { unique: false });
        store.createIndex("name", "name", { unique: false });
      }
    };
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = (e) => reject(e.target.error);
  });
}

async function dbGetAll() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readonly");
    const store = tx.objectStore(IDB_STORE);
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = (e) => reject(e.target.error);
  });
}

async function dbPut(product) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readwrite");
    tx.objectStore(IDB_STORE).put(product);
    tx.oncomplete = () => resolve(product);
    tx.onerror = (e) => reject(e.target.error);
  });
}

async function dbDelete(code) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readwrite");
    tx.objectStore(IDB_STORE).delete(code);
    tx.oncomplete = () => resolve();
    tx.onerror = (e) => reject(e.target.error);
  });
}

async function dbClearAll() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readwrite");
    tx.objectStore(IDB_STORE).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = (e) => reject(e.target.error);
  });
}

async function dbBulkReplace(products) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readwrite");
    const store = tx.objectStore(IDB_STORE);
    store.clear();
    products.forEach(p => store.put(p));
    tx.oncomplete = () => resolve();
    tx.onerror = (e) => reject(e.target.error);
  });
}

/* =========================================================
   توليد كود فريد للمنتج
   ========================================================= */
function generateCode(existingCodes) {
  const used = new Set(existingCodes || []);
  let n = used.size + 1;
  let code;
  do {
    code = `${CODE_PREFIX}-${String(n).padStart(4, "0")}`;
    n++;
  } while (used.has(code));
  return code;
}

/* =========================================================
   تصغير/ضغط الصور قبل الحفظ (Canvas)
   حتى تبقى قاعدة البيانات خفيفة مع 500 صنف
   ========================================================= */
function resizeImageFile(file, maxDim = 1000, quality = 0.82) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("تعذر قراءة الملف"));
    reader.onload = (e) => {
      const img = new Image();
      img.onerror = () => reject(new Error("تعذر تحميل الصورة"));
      img.onload = () => {
        let { width, height } = img;
        if (width > maxDim || height > maxDim) {
          if (width >= height) {
            height = Math.round(height * (maxDim / width));
            width = maxDim;
          } else {
            width = Math.round(width * (maxDim / height));
            height = maxDim;
          }
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);
        const dataUrl = canvas.toDataURL("image/jpeg", quality);
        resolve({ dataUrl, width, height });
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

/* =========================================================
   تشفير كلمة مرور لوحة التحكم (SHA-256)
   ========================================================= */
async function sha256(text) {
  const enc = new TextEncoder().encode(text);
  const buf = await crypto.subtle.digest("SHA-256", enc);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

/* =========================================================
   رابط واتساب لطلب منتج
   ========================================================= */
function whatsappOrderLink(product, pageUrl) {
  const lines = [
    `مرحباً، أرغب بطلب المنتج التالي:`,
    `الاسم: ${product.name}`,
    `الكود: ${product.code}`,
    product.price ? `السعر: ${product.price} ريال` : null,
    pageUrl ? `رابط المنتج: ${pageUrl}` : null
  ].filter(Boolean);
  const text = encodeURIComponent(lines.join("\n"));
  return `https://wa.me/${WHATSAPP_NUMBER}?text=${text}`;
}
