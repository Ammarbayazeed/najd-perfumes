const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, 'perfume_store.db');

let db;

function getDb() {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    initSchema();
    seedIfEmpty();
  }
  return db;
}

function initSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      price REAL NOT NULL,
      stock INTEGER NOT NULL DEFAULT 0,
      image_url TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS customers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      phone TEXT DEFAULT '',
      password_hash TEXT NOT NULL,
      is_verified INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS email_verifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      code TEXT NOT NULL,
      token TEXT,
      name TEXT NOT NULL,
      phone TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      expires_at DATETIME NOT NULL
    );

    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id INTEGER,
      customer_name TEXT NOT NULL,
      customer_phone TEXT NOT NULL,
      customer_city TEXT NOT NULL,
      customer_address TEXT NOT NULL,
      notes TEXT,
      status TEXT DEFAULT 'pending',
      total_price REAL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (customer_id) REFERENCES customers(id)
    );

    CREATE TABLE IF NOT EXISTS order_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER,
      product_id INTEGER,
      product_name TEXT,
      quantity INTEGER,
      price REAL,
      FOREIGN KEY (order_id) REFERENCES orders(id),
      FOREIGN KEY (product_id) REFERENCES products(id)
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `);

  // Migration: add customer_id if orders table already existed previously without it
  try {
    db.exec('ALTER TABLE orders ADD COLUMN customer_id INTEGER REFERENCES customers(id)');
  } catch (e) {
    // Column already exists, ignore
  }

  // Migration: add is_verified if customers table already existed previously without it
  try {
    db.exec('ALTER TABLE customers ADD COLUMN is_verified INTEGER DEFAULT 1');
  } catch (e) {
    // Column already exists, ignore
  }

  // Migration: add token if email_verifications table already existed previously without it
  try {
    db.exec('ALTER TABLE email_verifications ADD COLUMN token TEXT');
  } catch (e) {
    // Column already exists, ignore
  }
}

function seedIfEmpty() {
  const count = db.prepare('SELECT COUNT(*) as c FROM products').get();
  if (count.c > 0) return;

  const insert = db.prepare(`
    INSERT INTO products (name, description, price, stock, image_url)
    VALUES (?, ?, ?, ?, ?)
  `);

  const seed = db.transaction(() => {
    insert.run('عود الملكي', 'عطر فاخر بنكهة العود الأصيل', 350, 20, '');
    insert.run('ورد الطائف', 'عطر زهري رقيق من ورد الطائف', 280, 15, '');
    insert.run('مسك الأبيض', 'عطر مسكي ناعم للاستخدام اليومي', 220, 8, '');
    insert.run('بخور العرب', 'بخور عربي أصيل بعبق التراث', 180, 3, '');
    insert.run('الليل الذهبي', 'تركيبة شرقية فريدة للمناسبات', 420, 12, '');
  });

  seed();
  console.log('✅ تم زرع البيانات الأولية بنجاح');
}

module.exports = { getDb };
