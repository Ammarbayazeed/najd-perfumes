const path = require('path');
const fs = require('fs');

// Built-in .env file loader
try {
  const envFile = path.join(__dirname, '.env');
  if (fs.existsSync(envFile)) {
    fs.readFileSync(envFile, 'utf8').split('\n').forEach(line => {
      const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
      if (match && !process.env[match[1]]) {
        let value = (match[2] || '').trim();
        if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
        if (value.startsWith("'") && value.endsWith("'")) value = value.slice(1, -1);
        process.env[match[1]] = value;
      }
    });
  }
} catch (e) {}

const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const multer = require('multer');
const ExcelJS = require('exceljs');
const nodemailer = require('nodemailer');
const { getDb } = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;
const WHATSAPP_NUMBER = process.env.ADMIN_WHATSAPP || '966500000000';
const JWT_SECRET = process.env.JWT_SECRET || 'najd-perfumes-super-secure-secret-key-2026';
const JWT_EXPIRES = '7d';

// In-memory store for real-time admin WhatsApp notifications
let latestAdminNotification = null;

// Dynamic Mail Settings & Transporter (reads from database settings or .env)
function getMailSettings() {
  const db = getDb();
  let rows = [];
  try {
    rows = db.prepare('SELECT key, value FROM settings WHERE key LIKE "smtp_%"').all();
  } catch (e) {}

  const settings = {};
  rows.forEach(r => { settings[r.key] = r.value; });

  return {
    service: settings['smtp_service'] || process.env.EMAIL_SERVICE || 'gmail',
    host: settings['smtp_host'] || process.env.SMTP_HOST || 'smtp.gmail.com',
    port: Number(settings['smtp_port'] || process.env.SMTP_PORT) || 465,
    user: settings['smtp_user'] || process.env.EMAIL_USER || process.env.GMAIL_USER || '',
    pass: settings['smtp_pass'] || process.env.EMAIL_PASS || process.env.GMAIL_PASS || '',
    from: settings['smtp_from'] || process.env.EMAIL_FROM || '"متجر نجد للعطور" <no-reply@najd-perfumes.com>'
  };
}

function createMailTransporter() {
  const s = getMailSettings();
  if (!s.user || !s.pass) {
    return null;
  }
  try {
    if (s.service === 'gmail') {
      return nodemailer.createTransport({
        service: 'gmail',
        auth: { user: s.user, pass: s.pass }
      });
    } else {
      return nodemailer.createTransport({
        host: s.host,
        port: s.port,
        secure: s.port === 465,
        auth: { user: s.user, pass: s.pass }
      });
    }
  } catch (err) {
    console.error('Transporter creation error:', err.message);
    return null;
  }
}

// Ensure uploads folder exists
const UPLOADS_DIR = path.join(__dirname, 'public/uploads');
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

// ─── Multer Setup for Image Uploads from Device ──────────────────────────────
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, UPLOADS_DIR);
  },
  filename: function (req, file, cb) {
    const ext = path.extname(file.originalname).toLowerCase();
    const cleanExt = ['.jpg', '.jpeg', '.png', '.webp', '.gif'].includes(ext) ? ext : '.jpg';
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'perfume-' + uniqueSuffix + cleanExt);
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 8 * 1024 * 1024 }, // 8 MB
  fileFilter: function (req, file, cb) {
    const allowed = /jpeg|jpg|png|webp|gif/;
    const ext = allowed.test(path.extname(file.originalname).toLowerCase());
    const mime = allowed.test(file.mimetype);
    if (ext || mime) {
      cb(null, true);
    } else {
      cb(new Error('يرجى رفع ملف صورة صالح (JPG, PNG, WEBP, GIF)'));
    }
  }
});

// Security: Rate Limiting
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 500,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'طلبات كثيرة جداً، يرجى المحاولة بعد قليل' }
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'تم تجاوز عدد محاولات الدخول/التسجيل المسموحة، يرجى المحاولة بعد 15 دقيقة' }
});

app.use(cors());
app.use(express.json());
app.use('/api/', apiLimiter);
app.use(express.static(path.join(__dirname, 'public')));

// ─── Authentication Middleware ────────────────────────────────────────────────

function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'يجب تسجيل الدخول أولاً' });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.customer = decoded;
    next();
  } catch (err) {
    return res.status(403).json({ error: 'الجلسة منتهية، يرجى تسجيل الدخول مجدداً' });
  }
}

function optionalAuth(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (token) {
    try {
      req.customer = jwt.verify(token, JWT_SECRET);
    } catch (e) {
      // Ignored for guests
    }
  }
  next();
}

// ─── Data Validation Helpers (Saudi & Yemen Phone + Email) ──────────────────

function normalizePhone(raw) {
  if (!raw) return '';
  const arabicDigits = ['٠','١','٢','٣','٤','٥','٦','٧','٨','٩'];
  let str = String(raw).trim();
  for (let i = 0; i < 10; i++) {
    str = str.split(arabicDigits[i]).join(String(i));
  }
  return str.replace(/[\s\-\(\)\.]/g, '');
}

/**
 * Validates and normalizes phone number according to country code:
 * - Saudi (+966): starts with 05 (10 digits) or 5 (9 digits)
 * - Yemen (+967): starts with 7 (9 digits) or 07 (10 digits) - e.g. 77, 78, 73, 71, 70
 */
function validateAndFormatPhone(rawPhone, countryCode = '+966') {
  let clean = normalizePhone(rawPhone);
  if (!clean) return { valid: false, error: 'رقم الجوال مطلوب' };

  if (countryCode === '+967') {
    // Yemen
    if (clean.startsWith('+967')) clean = clean.slice(4);
    else if (clean.startsWith('00967')) clean = clean.slice(5);
    else if (clean.startsWith('967')) clean = clean.slice(3);

    if (clean.startsWith('0')) clean = clean.slice(1);

    // Yemen mobile numbers are 9 digits starting with 7
    if (/^7\d{8}$/.test(clean)) {
      return {
        valid: true,
        country: '+967',
        formatted: '+967' + clean,
        display: clean
      };
    }
    return {
      valid: false,
      error: 'رقم الجوال اليمني غير صحيح، يجب أن يتكون من 9 أرقام ويبدأ بـ 7 (مثال: 771234567)'
    };
  } else {
    // Saudi (+966) by default
    if (clean.startsWith('+966')) clean = clean.slice(4);
    else if (clean.startsWith('00966')) clean = clean.slice(5);
    else if (clean.startsWith('966')) clean = clean.slice(3);

    if (clean.startsWith('05') && clean.length === 10) clean = clean.slice(1); // keep 9 digits starting with 5

    if (/^5\d{8}$/.test(clean)) {
      return {
        valid: true,
        country: '+966',
        formatted: '+966' + clean,
        display: '0' + clean
      };
    }
    return {
      valid: false,
      error: 'رقم الجوال السعودي غير صحيح، يجب أن يبدأ بـ 05 ويتكون من 10 أرقام (مثال: 0501234567)'
    };
  }
}

function isValidEmail(email) {
  if (!email || typeof email !== 'string') return false;
  const clean = email.trim().toLowerCase();
  const emailRegex = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;
  if (!emailRegex.test(clean)) return false;

  const parts = clean.split('@');
  if (parts.length !== 2) return false;
  const [local, domain] = parts;
  if (local.length < 2) return false;

  const domainParts = domain.split('.');
  if (domainParts.length < 2) return false;
  const tld = domainParts[domainParts.length - 1];
  if (tld.length < 2 || !/^[a-zA-Z]+$/.test(tld)) return false;
  if (domainParts[0].length < 2) return false;

  return true;
}

function isValidName(name) {
  if (!name || typeof name !== 'string') return false;
  const clean = name.trim();
  if (clean.length < 3) return false;
  return /[\p{L}]/u.test(clean);
}

// ─── Customer Auth Routes (With Email Verification) ───────────────────────────

// POST /api/auth/register — Initiates registration and sends verification code
app.post('/api/auth/register', authLimiter, async (req, res) => {
  const { name, email, phone, country_code, password } = req.body;

  if (!name || !email || !password || !phone) {
    return res.status(400).json({ error: 'الاسم الكامل، البريد الإلكتروني، رقم الجوال، وكلمة المرور كلها مطلوبة' });
  }

  const cleanEmail = String(email).trim().toLowerCase();
  const cleanName = String(name).trim();

  if (!isValidName(cleanName)) {
    return res.status(400).json({ error: 'الاسم الكامل غير صحيح، يجب أن يتكون من 3 أحرف على الأقل' });
  }

  if (!isValidEmail(cleanEmail)) {
    return res.status(400).json({ error: 'البريد الإلكتروني غير صحيح، يرجى إدخال بريد صالح (مثال: name@gmail.com)' });
  }

  const phoneValidation = validateAndFormatPhone(phone, country_code || '+966');
  if (!phoneValidation.valid) {
    return res.status(400).json({ error: phoneValidation.error });
  }

  if (String(password).length < 8) {
    return res.status(400).json({ error: 'كلمة المرور ضعيفة، يجب أن لا تقل عن 8 خانات' });
  }

  const db = getDb();
  // Check if customer already registered and active
  const existing = db.prepare('SELECT id FROM customers WHERE email = ?').get(cleanEmail);
  if (existing) {
    return res.status(409).json({ error: 'هذا البريد الإلكتروني مسجل ومفعل بالفعل، يمكنك تسجيل الدخول مباشرة' });
  }

  // Generate 6-digit verification code AND secure 64-char activation link token
  const code = Math.floor(100000 + Math.random() * 900000).toString();
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(); // 24 hours
  const hash = bcrypt.hashSync(password, 12);

  // Store in pending email verifications (replaces older request if registered again)
  db.prepare(`
    INSERT INTO email_verifications (email, code, token, name, phone, password_hash, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(email) DO UPDATE SET
      code = excluded.code,
      token = excluded.token,
      name = excluded.name,
      phone = excluded.phone,
      password_hash = excluded.password_hash,
      expires_at = excluded.expires_at
  `).run(cleanEmail, code, token, cleanName, phoneValidation.formatted, hash, expiresAt);

  const protocol = req.headers['x-forwarded-proto'] || req.protocol;
  const host = req.get('host');
  const activationUrl = `${protocol}://${host}/api/auth/verify-link?token=${token}`;

  console.log(`\n======================================================`);
  console.log(`✉️ [تفعيل حساب لـ ${cleanEmail}]:`);
  console.log(`🔗 رابط التفعيل المباشر: ${activationUrl}`);
  console.log(`🔢 رمز التحقق (OTP): ${code}`);
  console.log(`======================================================\n`);

  // Attempt to send real email if mail transporter is available
  const transporter = createMailTransporter();
  let emailSent = false;
  if (transporter) {
    try {
      const s = getMailSettings();
      await transporter.sendMail({
        from: s.from || `"متجر نجد للعطور" <${s.user}>`,
        to: cleanEmail,
        subject: `تفعيل حسابك في متجر نجد للعطور الفاخرة`,
        text: `أهلاً ${cleanName}،\n\nاضغط على الرابط التالي لتفعيل حسابك في متجر نجد والبدء بالتسوق:\n${activationUrl}\n\nأو يمكنك استخدام رمز التحقق: ${code}\nالرابط صالح لمدة 24 ساعة.`,
        html: `
          <div dir="rtl" style="font-family:'Segoe UI',Tahoma,Arial,sans-serif;background:#FAF7F2;padding:32px 20px;color:#2C241E;text-align:center;">
            <div style="max-width:540px;margin:0 auto;background:#ffffff;border-radius:16px;padding:36px 24px;border:1px solid #E8DFD5;box-shadow:0 8px 24px rgba(139,98,64,0.08);">
              <h1 style="color:#8B6240;font-size:24px;margin-bottom:12px;font-weight:900;">متجر نجد للعطور الفاخرة</h1>
              <p style="font-size:16px;color:#55483F;margin-bottom:24px;">أهلاً بك يا <strong>${cleanName}</strong> في عالم العطور الأصيلة.</p>
              <p style="font-size:14px;color:#78685C;line-height:1.7;margin-bottom:28px;">لتأكيد بريدك الإلكتروني وتفعيل حسابك والبدء بإضافة العطور إلى سلتك، يرجى الضغط على زر التفعيل التالي:</p>
              
              <a href="${activationUrl}" style="display:inline-block;background:linear-gradient(135deg,#8B6240,#6E472B);color:#ffffff;text-decoration:none;padding:16px 36px;border-radius:10px;font-weight:bold;font-size:16px;box-shadow:0 6px 18px rgba(139,98,64,0.25);">
                تفعيل الحساب والبدء بالتسوق 🌟
              </a>

              <div style="margin-top:32px;padding-top:24px;border-top:1px dashed #E8DFD5;">
                <p style="font-size:13px;color:#8A7B70;margin-bottom:8px;">أو يمكنك إدخال رمز التحقق التالي يدوياً في المتجر:</p>
                <div style="font-size:28px;letter-spacing:6px;font-weight:bold;color:#8B6240;background:#F9F5F0;padding:12px 24px;border-radius:8px;display:inline-block;border:1px solid #E8DFD5;">
                  ${code}
                </div>
              </div>

              <p style="font-size:12px;color:#A99B90;margin-top:28px;line-height:1.6;">
                رابط التفعيل صالح لمدة 24 ساعة. تم إرسال هذه الرسالة للتحقق من ملكية البريد وتجنب الحسابات الوهمية.
              </p>
            </div>
          </div>
        `
      });
      emailSent = true;
      console.log(`✅ [تم إرسال بريد التفعيل بنجاح إلى ${cleanEmail}]`);
    } catch (err) {
      console.log('⚠️ تعذر إرسال الإيميل الفعلي عبر السيرفر:', err.message);
    }
  } else {
    console.log(`ℹ️ [ملاحظة]: لم يتم ضبط بيانات البريد الإلكتروني في لوحة التحكم بعد. تم طباعة الرابط في الكونسول.`);
  }

  res.status(200).json({
    pending_verification: true,
    email: cleanEmail,
    email_sent: emailSent,
    message: emailSent
      ? 'تم إرسال رسالة التفعيل ورمز التحقق إلى بريدك الإلكتروني بنجاح.'
      : 'تم تسجيل طلب الحساب بنجاح.',
    dev_code: !emailSent ? code : null,
    dev_link: !emailSent ? activationUrl : null
  });
});

// GET /api/auth/verify-link — Direct click from customer email
app.get('/api/auth/verify-link', (req, res) => {
  try {
    const { token } = req.query;
    if (!token) {
      return res.status(400).send(renderActivationHtml({
        success: false,
        title: 'رابط غير صالح',
        message: 'رابط التفعيل غير صالح أو ناقص.'
      }));
    }

    const db = getDb();
    const pending = db.prepare('SELECT * FROM email_verifications WHERE token = ?').get(token);

    if (!pending) {
      return res.status(404).send(renderActivationHtml({
        success: false,
        title: 'الرابط منتهي أو تم تفعيله مسبقاً',
        message: 'يبدو أن هذا الحساب قد تم تفعيله مسبقاً أو أن الرابط غير صحيح. يمكنك التوجه للمتجر وتسجيل الدخول مباشرة.'
      }));
    }

    if (new Date() > new Date(pending.expires_at)) {
      return res.status(400).send(renderActivationHtml({
        success: false,
        title: 'انتهت صلاحية الرابط',
        message: 'انتهت صلاحية رابط التفعيل (صالح لمدة 24 ساعة). يرجى طلب رابط جديد من المتجر.'
      }));
    }

    // Insert customer permanently
    const insertCustomer = db.prepare(`
      INSERT INTO customers (name, email, phone, password_hash, is_verified)
      VALUES (?, ?, ?, ?, 1)
    `);
    const result = insertCustomer.run(pending.name, pending.email, pending.phone, pending.password_hash);

    // Delete pending record
    db.prepare('DELETE FROM email_verifications WHERE email = ?').run(pending.email);

    const customerPayload = {
      id: result.lastInsertRowid,
      name: pending.name,
      email: pending.email,
      phone: pending.phone
    };

    const jwtToken = jwt.sign(customerPayload, JWT_SECRET, { expiresIn: JWT_EXPIRES });

    res.send(renderActivationHtml({
      success: true,
      title: '🎉 تم تفعيل حسابك بنجاح!',
      message: `أهلاً بك يا <strong>${pending.name}</strong> في متجر نجد للعطور. تم تأكيد بريدك الإلكتروني، والآن يمكنك إضافة العطور الفاخرة إلى سلتك بكل سهولة.`,
      jwtToken,
      customer: customerPayload
    }));
  } catch (err) {
    console.error('Verify link error:', err);
    res.status(500).send(renderActivationHtml({
      success: false,
      title: 'حدث خطأ',
      message: 'حدث خطأ غير متوقع أثناء تفعيل الحساب: ' + err.message
    }));
  }
});

// Helper for rendering the activation confirmation page
function renderActivationHtml({ success, title, message, jwtToken, customer }) {
  const redirectScript = success && jwtToken ? `
    <script>
      try {
        localStorage.setItem('najd_token', ${JSON.stringify(jwtToken)});
        localStorage.setItem('najd_customer', ${JSON.stringify(JSON.stringify(customer))});
      } catch (e) {}
      setTimeout(() => { window.location.href = '/?welcome=true'; }, 3000);
    </script>
  ` : '';

  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} — نجد للعطور</title>
  <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;900&display=swap" rel="stylesheet">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: 'Cairo', sans-serif; }
    body {
      background: #FDFBF7;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
      color: #2C241E;
    }
    .card {
      background: #FFFFFF;
      max-width: 520px;
      width: 100%;
      border-radius: 20px;
      padding: 40px 32px;
      text-align: center;
      box-shadow: 0 16px 40px rgba(139,98,64,0.12);
      border: 1px solid rgba(197,160,89,0.3);
    }
    .icon {
      font-size: 64px;
      margin-bottom: 20px;
      display: inline-block;
    }
    h1 {
      font-size: 24px;
      color: #8B6240;
      font-weight: 900;
      margin-bottom: 14px;
    }
    p {
      font-size: 16px;
      line-height: 1.8;
      color: #55483F;
      margin-bottom: 28px;
    }
    .btn {
      display: inline-block;
      background: linear-gradient(135deg, #8B6240, #6E472B);
      color: #FFFFFF;
      text-decoration: none;
      padding: 15px 36px;
      border-radius: 10px;
      font-weight: 700;
      font-size: 16px;
      box-shadow: 0 6px 18px rgba(139,98,64,0.3);
      transition: all 0.2s ease;
    }
    .btn:hover {
      transform: translateY(-2px);
      box-shadow: 0 8px 22px rgba(139,98,64,0.4);
    }
    .hint {
      margin-top: 18px;
      font-size: 13px;
      color: #8A7B70;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">${success ? '✨' : '⚠️'}</div>
    <h1>${title}</h1>
    <p>${message}</p>
    <a href="/" class="btn">${success ? 'الذهاب إلى المتجر وإضافة العطور للسلة 🛒' : 'العودة للمتجر'}</a>
    ${success ? '<div class="hint">جاري تحويلك تلقائياً إلى المتجر خلال 3 ثوانٍ...</div>' : ''}
  </div>
  ${redirectScript}
</body>
</html>`;
}

// POST /api/auth/verify-code — Verifies OTP code and activates account
app.post('/api/auth/verify-code', authLimiter, (req, res) => {
  try {
    const { email, code } = req.body;

    if (!email || !code) {
      return res.status(400).json({ error: 'البريد الإلكتروني ورمز التحقق مطلوبان' });
    }

    const cleanEmail = String(email).trim().toLowerCase();
    const cleanCode = normalizePhone(code);

    const db = getDb();
    const pending = db.prepare('SELECT * FROM email_verifications WHERE email = ?').get(cleanEmail);

    if (!pending) {
      return res.status(404).json({ error: 'لا يوجد طلب تفعيل معلق لهذا البريد، يرجى التسجيل مجدداً' });
    }

    if (new Date() > new Date(pending.expires_at)) {
      return res.status(400).json({ error: 'انتهت صلاحية رمز التفعيل، يرجى طلب رمز جديد' });
    }

    if (pending.code !== cleanCode) {
      return res.status(400).json({ error: 'رمز التحقق غير صحيح، يرجى التأكد وإعادة المحاولة' });
    }

    // Code is valid! Save permanently to customers table
    const insertCustomer = db.prepare(`
      INSERT INTO customers (name, email, phone, password_hash, is_verified)
      VALUES (?, ?, ?, ?, 1)
    `);
    const result = insertCustomer.run(pending.name, pending.email, pending.phone, pending.password_hash);

    // Remove pending verification
    db.prepare('DELETE FROM email_verifications WHERE email = ?').run(cleanEmail);

    const customerPayload = {
      id: result.lastInsertRowid,
      name: pending.name,
      email: pending.email,
      phone: pending.phone
    };

    const token = jwt.sign(customerPayload, JWT_SECRET, { expiresIn: JWT_EXPIRES });

    res.status(201).json({
      message: 'تم تفعيل حسابك بنجاح! مرحباً بك في متجر نجد',
      token,
      customer: customerPayload
    });
  } catch (err) {
    console.error('Verify error:', err);
    res.status(500).json({ error: 'حدث خطأ أثناء تفعيل الحساب: ' + err.message });
  }
});

// POST /api/auth/resend-code — Resends a fresh verification code and link
app.post('/api/auth/resend-code', authLimiter, async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'البريد الإلكتروني مطلوب' });

  const cleanEmail = String(email).trim().toLowerCase();
  const db = getDb();
  const pending = db.prepare('SELECT * FROM email_verifications WHERE email = ?').get(cleanEmail);

  if (!pending) {
    return res.status(404).json({ error: 'لا يوجد طلب تفعيل لهذا البريد' });
  }

  const newCode = Math.floor(100000 + Math.random() * 900000).toString();
  const newToken = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  db.prepare('UPDATE email_verifications SET code = ?, token = ?, expires_at = ? WHERE email = ?')
    .run(newCode, newToken, expiresAt, cleanEmail);

  const protocol = req.headers['x-forwarded-proto'] || req.protocol;
  const host = req.get('host');
  const activationUrl = `${protocol}://${host}/api/auth/verify-link?token=${newToken}`;

  console.log(`\n======================================================`);
  console.log(`✉️ [إعادة إرسال تفعيل لـ ${cleanEmail}]:`);
  console.log(`🔗 رابط التفعيل: ${activationUrl}`);
  console.log(`🔢 رمز التحقق: ${newCode}`);
  console.log(`======================================================\n`);

  // Send real email if transporter is available
  const transporter = createMailTransporter();
  if (transporter) {
    try {
      const s = getMailSettings();
      await transporter.sendMail({
        from: s.from || `"متجر نجد للعطور" <${s.user}>`,
        to: cleanEmail,
        subject: `تأكيد بريدك الإلكتروني - متجر نجد`,
        text: `أهلاً بك، رمز التفعيل الجديد هو: ${newCode}\nأو اضغط على الرابط:\n${activationUrl}`,
        html: `
          <div dir="rtl" style="font-family:'Segoe UI',Arial,sans-serif;background:#FAF7F2;padding:28px;text-align:center;">
            <h2 style="color:#8B6240;">رمز ورابط تفعيل حسابك في متجر نجد</h2>
            <p>اضغط على زر التفعيل التالي لتأكيد حسابك مباشرة:</p>
            <a href="${activationUrl}" style="display:inline-block;background:#8B6240;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:bold;margin:16px 0;">
              تفعيل الحساب والبدء بالتسوق 🌟
            </a>
            <p style="font-size:13px;color:#78685C;">أو أدخل رمز التحقق: <strong style="font-size:22px;letter-spacing:4px;color:#8B6240;">${newCode}</strong></p>
          </div>
        `
      });
      console.log(`✅ [تم إعادة إرسال البريد بنجاح إلى ${cleanEmail}]`);
      emailSent = true;
    } catch (err) {
      console.log('⚠️ خطأ أثناء إعادة إرسال الإيميل:', err.message);
    }
  }

  res.json({
    message: emailSent
      ? 'تم إرسال رسالة التفعيل ورمز التحقق الجديد إلى بريدك الإلكتروني بنجاح.'
      : 'تم إنشاء رمز تفعيل جديد.',
    email_sent: emailSent,
    dev_code: !emailSent ? newCode : null,
    dev_link: !emailSent ? activationUrl : null
  });
});

// ─── Admin Email Settings & Test Routes ────────────────────────────────────────

// GET /api/admin/email-settings
app.get('/api/admin/email-settings', (req, res) => {
  const s = getMailSettings();
  res.json({
    service: s.service,
    host: s.host,
    port: s.port,
    user: s.user,
    configured: Boolean(s.user && s.pass)
  });
});

// POST /api/admin/email-settings
app.post('/api/admin/email-settings', (req, res) => {
  const { service, host, port, user, pass, from } = req.body;
  const db = getDb();
  const setStmt = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');

  if (service != null) setStmt.run('smtp_service', service);
  if (host != null) setStmt.run('smtp_host', host);
  if (port != null) setStmt.run('smtp_port', String(port));
  if (user != null) setStmt.run('smtp_user', user);
  if (pass) setStmt.run('smtp_pass', pass);
  if (from != null) setStmt.run('smtp_from', from);

  res.json({ message: 'تم حفظ إعدادات البريد بنجاح! يمكن لمتجر نجد الآن إرسال رسائل التفعيل لعملائه مباشرة.' });
});

// POST /api/admin/test-email
app.post('/api/admin/test-email', async (req, res) => {
  const { target_email } = req.body;
  if (!target_email) return res.status(400).json({ error: 'البريد الإلكتروني التجريبي مطلوب' });

  const transporter = createMailTransporter();
  if (!transporter) {
    return res.status(400).json({ error: 'لم يتم حفظ بيانات البريد (اسم المستخدم وكلمة مرور التطبيق) بعد' });
  }

  const s = getMailSettings();
  try {
    await transporter.sendMail({
      from: s.from || `"متجر نجد للعطور" <${s.user}>`,
      to: target_email,
      subject: 'رسالة تجريبية من متجر نجد للعطور 🌸',
      text: 'تهانينا! تم ضبط إعدادات البريد بنجاح، رسائل التفعيل ستصل لعملائك مباشرة.',
      html: `
        <div dir="rtl" style="font-family:'Segoe UI',Arial,sans-serif;background:#FAF7F2;padding:32px;color:#2C241E;text-align:center;">
          <h2 style="color:#8B6240;margin-bottom:12px;">متجر نجد للعطور الفاخرة</h2>
          <p style="font-size:16px;">تهانينا! تم ضبط إعدادات البريد بنجاح في متجر نجد.</p>
          <p style="font-size:14px;color:#78685C;margin-top:8px;">رسائل تفعيل الحسابات وروابط التأكيد ستصل الآن لعملائك مباشرة في صندوق الوارد.</p>
        </div>
      `
    });
    res.json({ message: `تم إرسال الرسالة التجريبية بنجاح إلى ${target_email}!` });
  } catch (err) {
    res.status(500).json({ error: 'فشل إرسال الإيميل: ' + err.message });
  }
});

// POST /api/auth/login
app.post('/api/auth/login', authLimiter, (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'البريد الإلكتروني وكلمة المرور مطلوبان' });
  }

  const cleanEmail = String(email).trim().toLowerCase();
  const db = getDb();
  const customer = db.prepare('SELECT * FROM customers WHERE email = ?').get(cleanEmail);

  if (!customer || !bcrypt.compareSync(password, customer.password_hash)) {
    return res.status(401).json({ error: 'بيانات الدخول غير صحيحة، تأكد من البريد وكلمة المرور' });
  }

  const customerPayload = {
    id: customer.id,
    name: customer.name,
    email: customer.email,
    phone: customer.phone || ''
  };

  const token = jwt.sign(customerPayload, JWT_SECRET, { expiresIn: JWT_EXPIRES });

  res.json({
    message: 'تم تسجيل الدخول بنجاح',
    token,
    customer: customerPayload
  });
});

// GET /api/auth/me
app.get('/api/auth/me', authenticateToken, (req, res) => {
  const db = getDb();
  const customer = db.prepare('SELECT id, name, email, phone, created_at FROM customers WHERE id = ?').get(req.customer.id);
  if (!customer) return res.status(404).json({ error: 'المستخدم غير موجود' });
  res.json(customer);
});

// GET /api/auth/my-orders
app.get('/api/auth/my-orders', authenticateToken, (req, res) => {
  const db = getDb();
  const orders = db.prepare('SELECT * FROM orders WHERE customer_id = ? ORDER BY created_at DESC').all(req.customer.id);
  const itemsStmt = db.prepare('SELECT * FROM order_items WHERE order_id = ?');

  const detailedOrders = orders.map(o => ({
    ...o,
    items: itemsStmt.all(o.id)
  }));

  res.json(detailedOrders);
});

// ─── Image Upload Route ───────────────────────────────────────────────────────

// POST /api/upload-image — upload perfume image from device
app.post('/api/upload-image', (req, res) => {
  upload.single('image')(req, res, function (err) {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: 'حجم الصورة كبير جداً، الحد الأقصى 8 ميجابايت' });
      }
      return res.status(400).json({ error: 'خطأ أثناء رفع الصورة: ' + err.message });
    } else if (err) {
      return res.status(400).json({ error: err.message });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'لم يتم اختيار أي ملف صورة' });
    }

    const fileUrl = '/uploads/' + req.file.filename;
    res.json({
      message: 'تم رفع صورة المنتج بنجاح',
      url: fileUrl
    });
  });
});

// ─── Products ────────────────────────────────────────────────────────────────

// GET /api/products — only in-stock (customer view)
app.get('/api/products', (req, res) => {
  const db = getDb();
  const products = db.prepare('SELECT * FROM products WHERE stock > 0 ORDER BY created_at DESC').all();
  res.json(products);
});

// GET /api/products/all — all products (admin view)
app.get('/api/products/all', (req, res) => {
  const db = getDb();
  const products = db.prepare('SELECT * FROM products ORDER BY created_at DESC').all();
  res.json(products);
});

// POST /api/products — add product (admin)
app.post('/api/products', (req, res) => {
  const { name, description, price, stock, image_url } = req.body;
  if (!name || price == null || stock == null) {
    return res.status(400).json({ error: 'الرجاء ملء جميع الحقول المطلوبة' });
  }
  const db = getDb();
  const stmt = db.prepare(
    'INSERT INTO products (name, description, price, stock, image_url) VALUES (?, ?, ?, ?, ?)'
  );
  const result = stmt.run(name, description || '', price, stock, image_url || '');
  res.status(201).json({ id: result.lastInsertRowid, message: 'تم إضافة المنتج بنجاح' });
});

// PUT /api/products/:id — update product (admin)
app.put('/api/products/:id', (req, res) => {
  const { name, description, price, stock, image_url } = req.body;
  if (!name || price == null || stock == null) {
    return res.status(400).json({ error: 'الرجاء ملء جميع الحقول المطلوبة' });
  }
  const db = getDb();
  const stmt = db.prepare(
    'UPDATE products SET name=?, description=?, price=?, stock=?, image_url=? WHERE id=?'
  );
  const result = stmt.run(name, description || '', price, stock, image_url || '', req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'المنتج غير موجود' });
  res.json({ message: 'تم تحديث المنتج بنجاح' });
});

// DELETE /api/products/:id
app.delete('/api/products/:id', (req, res) => {
  const db = getDb();
  const result = db.prepare('DELETE FROM products WHERE id=?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'المنتج غير موجود' });
  res.json({ message: 'تم حذف المنتج بنجاح' });
});

// ─── Orders ──────────────────────────────────────────────────────────────────

// GET /api/orders/export/excel — Export all/filtered orders to Excel spreadsheet
app.get('/api/orders/export/excel', async (req, res) => {
  try {
    const db = getDb();
    const { status } = req.query;
    const orders = status
      ? db.prepare('SELECT * FROM orders WHERE status=? ORDER BY created_at DESC').all(status)
      : db.prepare('SELECT * FROM orders ORDER BY created_at DESC').all();

    const itemsStmt = db.prepare('SELECT * FROM order_items WHERE order_id=?');

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'متجر نجد للعطور الفاخرة';
    workbook.created = new Date();

    const sheet = workbook.addWorksheet('طلبات نجد', {
      views: [{ rightToLeft: true }] // RTL for Arabic
    });

    sheet.columns = [
      { header: 'رقم الطلب', key: 'id', width: 14 },
      { header: 'تاريخ الطلب', key: 'date', width: 24 },
      { header: 'اسم العميل', key: 'name', width: 24 },
      { header: 'رقم الجوال', key: 'phone', width: 18 },
      { header: 'المدينة', key: 'city', width: 16 },
      { header: 'العنوان التفصيلي وموقع التوصيل', key: 'address', width: 36 },
      { header: 'المنتجات المطلوبة والكميات', key: 'items', width: 44 },
      { header: 'إجمالي الطلب (ريال)', key: 'total', width: 18 },
      { header: 'حالة الطلب', key: 'status', width: 18 },
      { header: 'ملاحظات العميل', key: 'notes', width: 28 },
    ];

    // Format Header Row
    const headerRow = sheet.getRow(1);
    headerRow.font = { name: 'Segoe UI', bold: true, color: { argb: 'FFFFFFFF' }, size: 12 };
    headerRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF8B6240' } // Brand brown color
    };
    headerRow.alignment = { vertical: 'middle', horizontal: 'center' };
    headerRow.height = 32;

    const STATUS_AR = {
      pending: 'معلق',
      confirmed: 'مؤكد',
      delivered: 'تم التوصيل',
      cancelled: 'ملغي'
    };

    orders.forEach((o, index) => {
      const items = itemsStmt.all(o.id);
      const itemsText = items.map(i => `${i.product_name} × ${i.quantity}`).join(' | ');

      const row = sheet.addRow({
        id: `#${o.id}`,
        date: o.created_at ? new Date(o.created_at).toLocaleString('ar-SA') : '—',
        name: o.customer_name,
        phone: o.customer_phone,
        city: o.customer_city,
        address: o.customer_address,
        items: itemsText || '—',
        total: (o.total_price || 0).toFixed(2),
        status: STATUS_AR[o.status] || o.status,
        notes: o.notes || '—'
      });

      row.height = 24;
      row.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
      row.font = { name: 'Segoe UI', size: 11 };

      // Alternate row backgrounds
      if (index % 2 === 1) {
        row.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFF9F5F0' }
        };
      }
    });

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="najd-orders-${Date.now()}.xlsx"`
    );

    await workbook.xlsx.write(res);
    res.end();

  } catch (err) {
    console.error('Excel Export Error:', err);
    res.status(500).json({ error: 'حدث خطأ أثناء تصدير ملف الإكسل' });
  }
});

// GET /api/orders — all orders (admin)
app.get('/api/orders', (req, res) => {
  const db = getDb();
  const { status } = req.query;
  const orders = status
    ? db.prepare('SELECT * FROM orders WHERE status=? ORDER BY created_at DESC').all(status)
    : db.prepare('SELECT * FROM orders ORDER BY created_at DESC').all();
  res.json(orders);
});

// GET /api/orders/:id — single order with items
app.get('/api/orders/:id', (req, res) => {
  const db = getDb();
  const order = db.prepare('SELECT * FROM orders WHERE id=?').get(req.params.id);
  if (!order) return res.status(404).json({ error: 'الطلب غير موجود' });
  const items = db.prepare('SELECT * FROM order_items WHERE order_id=?').all(req.params.id);
  res.json({ ...order, items });
});

// POST /api/orders — submit new order (requires verified logged in customer)
app.post('/api/orders', authenticateToken, (req, res) => {
  const { customer_name, customer_phone, customer_country, customer_city, customer_address, notes, items } = req.body;

  if (!customer_name || !customer_phone || !customer_city || !customer_address) {
    return res.status(400).json({ error: 'الرجاء ملء جميع بيانات العميل والتوصيل المطلوبة' });
  }

  const cleanName = String(customer_name).trim();
  const cleanCity = String(customer_city).trim();
  const cleanAddress = String(customer_address).trim();

  if (!isValidName(cleanName)) {
    return res.status(400).json({ error: 'الاسم الكامل يجب أن يحتوي على 3 أحرف على الأقل' });
  }

  const phoneValidation = validateAndFormatPhone(customer_phone, customer_country || '+966');
  if (!phoneValidation.valid) {
    return res.status(400).json({ error: phoneValidation.error });
  }

  if (cleanCity.length < 2) {
    return res.status(400).json({ error: 'يرجى إدخال اسم مدينة صحيح' });
  }

  if (cleanAddress.length < 4) {
    return res.status(400).json({ error: 'يرجى إدخال عنوان تفصيلي واضح لتسليم الطلب' });
  }

  if (!items || items.length === 0) {
    return res.status(400).json({ error: 'السلة فارغة، يرجى إضافة عطور للسلة أولاً' });
  }

  const db = getDb();

  // Validate stock for each item
  for (const item of items) {
    const product = db.prepare('SELECT * FROM products WHERE id=?').get(item.product_id);
    if (!product) {
      return res.status(400).json({ error: `المنتج غير موجود: ${item.product_name}` });
    }
    if (product.stock < item.quantity) {
      return res.status(400).json({
        error: `الكمية المطلوبة من "${product.name}" غير متوفرة. المتاح: ${product.stock}`
      });
    }
  }

  const total_price = items.reduce((sum, i) => sum + i.price * i.quantity, 0);
  const customerId = req.customer ? req.customer.id : null;
  const finalPhone = phoneValidation.formatted;

  const submitOrder = db.transaction(() => {
    // Insert order with customer_id if authenticated
    const orderResult = db.prepare(`
      INSERT INTO orders (customer_id, customer_name, customer_phone, customer_city, customer_address, notes, total_price)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(customerId, cleanName, finalPhone, cleanCity, cleanAddress, notes || '', total_price);

    const orderId = orderResult.lastInsertRowid;

    // Insert items and deduct stock
    const insertItem = db.prepare(`
      INSERT INTO order_items (order_id, product_id, product_name, quantity, price)
      VALUES (?, ?, ?, ?, ?)
    `);
    const deductStock = db.prepare('UPDATE products SET stock = stock - ? WHERE id=?');

    for (const item of items) {
      insertItem.run(orderId, item.product_id, item.product_name, item.quantity, item.price);
      deductStock.run(item.quantity, item.product_id);
    }

    return orderId;
  });

  const orderId = submitOrder();

  // 1. Build WhatsApp message for Admin Notification
  let adminWaText = `🚨 طلب جديد في متجر نجد للعطور! 🌟\n`;
  adminWaText += `━━━━━━━━━━━━━━━━━━━━\n`;
  adminWaText += `📦 رقم الطلب: #${orderId}\n`;
  adminWaText += `👤 اسم العميل: ${cleanName}\n`;
  adminWaText += `📞 رقم الجوال: ${finalPhone}\n`;
  adminWaText += `🏙️ المدينة: ${cleanCity}\n`;
  adminWaText += `📍 عنوان التوصيل: ${cleanAddress}\n`;
  if (notes) adminWaText += `📝 ملاحظات العميل: ${notes}\n`;
  adminWaText += `━━━━━━━━━━━━━━━━━━━━\n`;
  adminWaText += `🛒 تفاصيل العطور:\n`;
  items.forEach(item => {
    adminWaText += `  • ${item.product_name} × ${item.quantity} = ${(item.price * item.quantity).toFixed(2)} ريال\n`;
  });
  adminWaText += `\n💰 الإجمالي المطلوب: ${total_price.toFixed(2)} ريال\n`;
  adminWaText += `⏰ وقت الطلب: ${new Date().toLocaleString('ar-SA')}`;

  const adminWhatsappUrl = `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(adminWaText)}`;

  // 2. Build WhatsApp message for Customer Confirmation
  let customerWaText = `🌟 مرحباً نجد، قمت بطلب جديد رقم #${orderId}\n`;
  customerWaText += `👤 الاسم: ${cleanName}\n`;
  customerWaText += `📞 الهاتف: ${finalPhone}\n`;
  customerWaText += `🏙️ المدينة: ${cleanCity} - ${cleanAddress}\n`;
  customerWaText += `💰 الإجمالي: ${total_price.toFixed(2)} ريال\n`;
  customerWaText += `يرجى تأكيد التجهيز والتوصيل 🌸`;

  const customerWhatsappUrl = `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(customerWaText)}`;

  // Store for real-time live alert in Admin Dashboard
  latestAdminNotification = {
    order_id: orderId,
    customer_name: cleanName,
    customer_phone: finalPhone,
    customer_city: cleanCity,
    total_price,
    items_count: items.reduce((s, i) => s + i.quantity, 0),
    admin_whatsapp_url: adminWhatsappUrl,
    customer_direct_whatsapp_url: `https://wa.me/${finalPhone.replace(/\+/g, '')}?text=${encodeURIComponent(`مرحباً ${cleanName}، بخصوص طلبك #${orderId} في متجر نجد...`)}`,
    timestamp: Date.now()
  };

  console.log(`\n======================================================`);
  console.log(`🔔 [إشعار طلب جديد لإدارة متجر نجد عبر واتساب]:`);
  console.log(`📦 رقم الطلب: #${orderId} | العميل: ${cleanName} (${finalPhone})`);
  console.log(`💰 الإجمالي: ${total_price.toFixed(2)} ريال`);
  console.log(`📱 رابط إشعار واتساب للإدارة:`);
  console.log(adminWhatsappUrl);
  console.log(`======================================================\n`);

  res.status(201).json({
    message: 'تم تسجيل الطلب بنجاح وإشعار الإدارة',
    order_id: orderId,
    total_price,
    whatsapp_url: customerWhatsappUrl,
    admin_whatsapp_url: adminWhatsappUrl
  });
});

// GET /api/admin/latest-notification — Polled by admin dashboard for real-time WhatsApp alert
app.get('/api/admin/latest-notification', (req, res) => {
  res.json({ notification: latestAdminNotification });
});

// PUT /api/orders/:id/status — update order status
app.put('/api/orders/:id/status', (req, res) => {
  const { status } = req.body;
  const validStatuses = ['pending', 'confirmed', 'delivered', 'cancelled'];
  if (!validStatuses.includes(status)) {
    return res.status(400).json({ error: 'حالة الطلب غير صالحة' });
  }
  const db = getDb();
  const result = db.prepare('UPDATE orders SET status=? WHERE id=?').run(status, req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'الطلب غير موجود' });
  res.json({ message: 'تم تحديث حالة الطلب بنجاح' });
});

// ─── Stats ───────────────────────────────────────────────────────────────────

app.get('/api/stats', (req, res) => {
  const db = getDb();
  const totalOrders = db.prepare('SELECT COUNT(*) as c FROM orders').get().c;
  const pendingOrders = db.prepare("SELECT COUNT(*) as c FROM orders WHERE status='pending'").get().c;
  const totalRevenue = db.prepare("SELECT COALESCE(SUM(total_price),0) as r FROM orders WHERE status != 'cancelled'").get().r;
  const lowStock = db.prepare('SELECT COUNT(*) as c FROM products WHERE stock <= 5').get().c;
  const recentOrders = db.prepare('SELECT * FROM orders ORDER BY created_at DESC LIMIT 5').all();
  res.json({ totalOrders, pendingOrders, totalRevenue, lowStock, recentOrders });
});

// ─── Serve SPA fallback ───────────────────────────────────────────────────────

app.get('*', (req, res) => {
  if (req.path.startsWith('/api')) return res.status(404).json({ error: 'المسار غير موجود' });
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`\n🌸 متجر نجد للعطور يعمل على http://localhost:${PORT}`);
  console.log(`🔧 لوحة التحكم: http://localhost:${PORT}/admin.html\n`);
});
