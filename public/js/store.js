/* =====================================================
   store.js — Customer Storefront Logic with Auth & Security
   ===================================================== */

const API = '';
let products = [];
let cart = {}; // { productId: { product, qty } }

// ─── Auth State ────────────────────────────────────────────────
let authToken = localStorage.getItem('najd_token');
let currentCustomer = null;
let pendingVerificationEmail = '';
try {
  currentCustomer = JSON.parse(localStorage.getItem('najd_customer') || 'null');
} catch (e) {
  currentCustomer = null;
}

function getAuthHeaders() {
  const headers = { 'Content-Type': 'application/json' };
  if (authToken) {
    headers['Authorization'] = `Bearer ${authToken}`;
  }
  return headers;
}

function updateAuthUI() {
  const authSection = document.getElementById('authSection');
  const authUser = document.getElementById('authUser');
  const userGreeting = document.getElementById('userGreeting');

  if (currentCustomer && authToken) {
    if (authSection) authSection.style.display = 'none';
    if (authUser) authUser.style.display = 'flex';
    if (userGreeting) {
      const firstName = currentCustomer.name ? currentCustomer.name.split(' ')[0] : 'عميلنا العزيز';
      userGreeting.textContent = `أهلاً، ${firstName}`;
    }
  } else {
    if (authSection) authSection.style.display = 'flex';
    if (authUser) authUser.style.display = 'none';
  }
}

function logout() {
  authToken = null;
  currentCustomer = null;
  localStorage.removeItem('najd_token');
  localStorage.removeItem('najd_customer');
  updateAuthUI();

  // Reset any auth notices in the order form
  const notice = document.getElementById('authNotice');
  if (notice) notice.style.display = 'none';
}

// ─── Init ──────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  // Check if customer just activated via email link
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get('welcome') === 'true') {
    window.history.replaceState({}, document.title, window.location.pathname);
    authToken = localStorage.getItem('najd_token');
    try {
      currentCustomer = JSON.parse(localStorage.getItem('najd_customer') || 'null');
    } catch (e) {}
    setTimeout(() => {
      alert('🎉 أهلاً بك في متجر نجد للعطور الفاخرة!\nتم تفعيل حسابك بنجاح عبر الإيميل، يمكنك الآن إضافة العطور للسلة وإتمام طلبك بكل سهولة.');
    }, 400);
  }

  updateAuthUI();
  loadProducts();
  renderCart();
  bindUI();
  bindAuthUI();
});

// ─── Products API ──────────────────────────────────────────────
async function loadProducts() {
  try {
    const res = await fetch(`${API}/api/products`);
    products = await res.json();
    renderProducts();
  } catch (err) {
    document.getElementById('productsGrid').innerHTML =
      '<p style="color:#e74c3c;grid-column:1/-1;text-align:center;padding:40px">حدث خطأ أثناء تحميل المنتجات. تأكد من تشغيل الخادم.</p>';
  }
}

// ─── Render Products ────────────────────────────────────────────
function renderProducts() {
  const grid = document.getElementById('productsGrid');
  if (!products.length) {
    grid.innerHTML = '<p style="color:#8a7a60;grid-column:1/-1;text-align:center;padding:40px">لا توجد منتجات متاحة حالياً.</p>';
    return;
  }

  grid.innerHTML = products.map(p => {
    const isLow = p.stock <= 5;
    const img = p.image_url
      ? `<img src="${escHtml(p.image_url)}" alt="${escHtml(p.name)}" loading="lazy" />`
      : '🌹';
    return `
      <div class="product-card" data-id="${p.id}">
        <div class="product-img">${img}</div>
        <div class="product-body">
          <div class="product-name">${escHtml(p.name)}</div>
          <div class="product-desc">${escHtml(p.description || '')}</div>
          <div class="product-price">${p.price.toFixed(2)} ريال</div>
          <span class="stock-badge ${isLow ? 'low' : 'ok'}">
            ${isLow ? `⚠️ متبقي ${p.stock} فقط` : '✔ متوفر في المخزون'}
          </span>
          <div class="qty-controls">
            <button class="qty-btn" onclick="changeQty(${p.id},-1)" id="qtyMinus-${p.id}">−</button>
            <span class="qty-display" id="qtyDisplay-${p.id}">1</span>
            <button class="qty-btn" onclick="changeQty(${p.id},1)" id="qtyPlus-${p.id}">+</button>
          </div>
          <button class="add-to-cart-btn" onclick="addToCart(${p.id})">
            🛒 أضف للسلة
          </button>
        </div>
      </div>`;
  }).join('');
}

// ─── Quantity Selector ──────────────────────────────────────────
const selectedQtys = {};

function changeQty(productId, delta) {
  const p = products.find(x => x.id === productId);
  if (!p) return;
  if (!selectedQtys[productId]) selectedQtys[productId] = 1;
  let q = selectedQtys[productId] + delta;
  q = Math.max(1, Math.min(q, p.stock));
  selectedQtys[productId] = q;
  document.getElementById(`qtyDisplay-${productId}`).textContent = q;
  document.getElementById(`qtyMinus-${productId}`).disabled = q <= 1;
  document.getElementById(`qtyPlus-${productId}`).disabled = q >= p.stock;
}

// ─── Cart Logic ─────────────────────────────────────────────────
let pendingAddToCart = null;

function addToCart(productId) {
  const p = products.find(x => x.id === productId);
  if (!p) return;
  const qty = selectedQtys[productId] || 1;

  // Requirement: Guests cannot add items to cart without an account!
  if (!currentCustomer || !authToken) {
    pendingAddToCart = { id: productId, qty };
    promptAuthRequired('add_to_cart');
    return;
  }

  if (cart[productId]) {
    const newQty = cart[productId].qty + qty;
    cart[productId].qty = Math.min(newQty, p.stock);
  } else {
    cart[productId] = { product: p, qty };
  }

  // Reset page selector
  selectedQtys[productId] = 1;
  const display = document.getElementById(`qtyDisplay-${productId}`);
  if (display) display.textContent = '1';

  renderCart();
  openCart();

  // Flash badge
  const badge = document.getElementById('cartBadge');
  badge.style.transform = 'scale(1.4)';
  setTimeout(() => badge.style.transform = '', 250);
}

function removeFromCart(productId) {
  delete cart[productId];
  renderCart();
}

function changeCartQty(productId, delta) {
  if (!cart[productId]) return;
  const p = cart[productId].product;
  let q = cart[productId].qty + delta;
  q = Math.max(1, Math.min(q, p.stock));
  cart[productId].qty = q;
  renderCart();
}

function getCartItems() {
  return Object.values(cart);
}

function getCartTotal() {
  return getCartItems().reduce((s, { product, qty }) => s + product.price * qty, 0);
}

function getCartCount() {
  return getCartItems().reduce((s, { qty }) => s + qty, 0);
}

function renderCart() {
  const items = getCartItems();
  const badge = document.getElementById('cartBadge');
  const footer = document.getElementById('cartFooter');
  const cartItemsEl = document.getElementById('cartItems');
  const cartTotalEl = document.getElementById('cartTotal');

  badge.textContent = getCartCount();

  if (!items.length) {
    cartItemsEl.innerHTML = `<div class="empty-cart"><span>🛍️</span><p>السلة فارغة، اختر من عطور نجد المميزة</p></div>`;
    footer.style.display = 'none';
    return;
  }

  footer.style.display = 'block';
  cartTotalEl.textContent = `${getCartTotal().toFixed(2)} ريال`;

  cartItemsEl.innerHTML = items.map(({ product: p, qty }) => `
    <div class="cart-item">
      <div class="cart-item-info">
        <div class="cart-item-name">${escHtml(p.name)}</div>
        <div class="cart-item-price">${p.price.toFixed(2)} ريال × ${qty}</div>
      </div>
      <div class="cart-item-subtotal">${(p.price * qty).toFixed(2)} ريال</div>
      <div style="display:flex;flex-direction:column;gap:4px;align-items:center">
        <button class="qty-btn" onclick="changeCartQty(${p.id},1)" style="width:28px;height:28px;font-size:14px">+</button>
        <button class="qty-btn" onclick="changeCartQty(${p.id},-1)" style="width:28px;height:28px;font-size:14px" ${qty<=1?'disabled':''}>−</button>
      </div>
      <button class="cart-item-remove" onclick="removeFromCart(${p.id})" title="إزالة">✕</button>
    </div>`).join('');
}

// ─── UI Bindings ────────────────────────────────────────────────
function bindUI() {
  // Cart open/close
  document.getElementById('cartBtn').addEventListener('click', openCart);
  document.getElementById('closeCart').addEventListener('click', closeCart);
  document.getElementById('cartOverlay').addEventListener('click', closeCart);

  // Checkout button
  document.getElementById('checkoutBtn').addEventListener('click', () => {
    if (!getCartItems().length) return;
    closeCart();

    if (!currentCustomer || !authToken) {
      promptAuthRequired();
      return;
    }

    openOrderModal();
  });

  // Order modal close
  document.getElementById('closeModal').addEventListener('click', closeOrderModal);
  document.getElementById('orderModalOverlay').addEventListener('click', e => {
    if (e.target === document.getElementById('orderModalOverlay')) closeOrderModal();
  });

  // Order form submit
  document.getElementById('orderForm').addEventListener('submit', submitOrder);

  // Success modal
  document.getElementById('continueShopping').addEventListener('click', () => {
    document.getElementById('successModalOverlay').classList.remove('open');
  });
  document.getElementById('successModalOverlay').addEventListener('click', e => {
    if (e.target === document.getElementById('successModalOverlay'))
      document.getElementById('successModalOverlay').classList.remove('open');
  });
}

function openCart() {
  document.getElementById('cartSidebar').classList.add('open');
  document.getElementById('cartOverlay').classList.add('active');
  document.body.style.overflow = 'hidden';
}

function closeCart() {
  document.getElementById('cartSidebar').classList.remove('open');
  document.getElementById('cartOverlay').classList.remove('active');
  document.body.style.overflow = '';
}

function promptAuthRequired(action = 'checkout') {
  const regNotice = document.getElementById('registerPromptNotice');
  const loginNotice = document.getElementById('loginPromptNotice');

  if (action === 'add_to_cart') {
    if (regNotice) {
      regNotice.innerHTML = '🔒 <strong>لا يمكن إضافة العطور إلى السلة إلا بعد إنشاء حساب وتفعيله.</strong><br>أنشئ حسابك الآن وسيصلك رابط عبر بريدك الإلكتروني لتفعيله وتجنب الحسابات الوهمية.';
      regNotice.style.display = 'block';
    }
    if (loginNotice) {
      loginNotice.innerHTML = '🔒 <strong>يرجى تسجيل الدخول بحسابك لتتمكن من إضافة العطور إلى السلة والشراء.</strong>';
      loginNotice.style.display = 'block';
    }
  } else {
    if (regNotice) {
      regNotice.innerHTML = '🔒 <strong>لتجهيز وإتمام طلبك، يجب إنشاء حساب وتفعيل بريدك الإلكتروني لضمان المصداقية.</strong>';
      regNotice.style.display = 'block';
    }
    if (loginNotice) {
      loginNotice.innerHTML = '🔒 <strong>لتجهيز وإتمام طلبك، يرجى تسجيل الدخول بحسابك.</strong>';
      loginNotice.style.display = 'block';
    }
  }
  openModal('registerModalOverlay');
}

function onAuthSuccess() {
  updateAuthUI();

  if (pendingAddToCart) {
    const { id, qty } = pendingAddToCart;
    pendingAddToCart = null;
    selectedQtys[id] = qty;
    addToCart(id);
    alert('✨ أهلاً بك! تم تفعيل حسابك بنجاح وتم إضافة العطر إلى سلتك.');
  } else if (getCartItems().length > 0) {
    openOrderModal();
  }
}

function openOrderModal() {
  if (!currentCustomer || !authToken) {
    promptAuthRequired();
    return;
  }

  renderOrderSummary();

  // Pre-fill customer data if logged in
  const notice = document.getElementById('authNotice');
  if (currentCustomer) {
    const nameInput = document.getElementById('customerName');
    const phoneInput = document.getElementById('customerPhone');

    if (!nameInput.value && currentCustomer.name) nameInput.value = currentCustomer.name;
    if (!phoneInput.value && currentCustomer.phone) {
      let ph = currentCustomer.phone;
      const countrySel = document.getElementById('customerCountryCode');
      if (ph.startsWith('+967')) {
        if (countrySel) countrySel.value = '+967';
        phoneInput.value = ph.replace('+967', '');
      } else if (ph.startsWith('+966')) {
        if (countrySel) countrySel.value = '+966';
        phoneInput.value = '0' + ph.replace('+966', '');
      } else {
        phoneInput.value = ph;
      }
    }

    notice.textContent = `✨ مسجل كـ ${currentCustomer.name} (${currentCustomer.email}) — تم تعبئة بياناتك`;
    notice.style.display = 'block';
  } else {
    notice.style.display = 'none';
  }

  document.getElementById('orderModalOverlay').classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeOrderModal() {
  document.getElementById('orderModalOverlay').classList.remove('open');
  document.body.style.overflow = '';
}

function renderOrderSummary() {
  const items = getCartItems();
  const summaryEl = document.getElementById('orderSummary');
  const modalTotalEl = document.getElementById('modalTotal');
  summaryEl.innerHTML = items.map(({ product: p, qty }) => `
    <div class="summary-item">
      <span>${escHtml(p.name)} × ${qty}</span>
      <span>${(p.price * qty).toFixed(2)} ريال</span>
    </div>`).join('');
  modalTotalEl.textContent = `${getCartTotal().toFixed(2)} ريال`;
}

// ─── Input Validation Helpers (Saudi & Yemen Phone + Email) ───
function normalizePhone(raw) {
  if (!raw) return '';
  const arabicDigits = ['٠','١','٢','٣','٤','٥','٦','٧','٨','٩'];
  let str = String(raw).trim();
  for (let i = 0; i < 10; i++) {
    str = str.split(arabicDigits[i]).join(String(i));
  }
  return str.replace(/[\s\-\(\)\.]/g, '');
}

function validateAndFormatPhoneClient(raw, countryCode = '+966') {
  let clean = normalizePhone(raw);
  if (!clean) return { valid: false, error: 'رقم الجوال مطلوب' };

  if (countryCode === '+967') {
    if (clean.startsWith('+967')) clean = clean.slice(4);
    else if (clean.startsWith('00967')) clean = clean.slice(5);
    else if (clean.startsWith('967')) clean = clean.slice(3);
    if (clean.startsWith('0')) clean = clean.slice(1);

    if (/^7\d{8}$/.test(clean)) {
      return { valid: true, formatted: '+967' + clean, display: clean };
    }
    return { valid: false, error: 'رقم الجوال اليمني غير صحيح، يجب أن يتكون من 9 أرقام ويبدأ بـ 7 (مثال: 771234567)' };
  } else {
    if (clean.startsWith('+966')) clean = clean.slice(4);
    else if (clean.startsWith('00966')) clean = clean.slice(5);
    else if (clean.startsWith('966')) clean = clean.slice(3);
    if (clean.startsWith('05') && clean.length === 10) clean = clean.slice(1);

    if (/^5\d{8}$/.test(clean)) {
      return { valid: true, formatted: '+966' + clean, display: '0' + clean };
    }
    return { valid: false, error: 'رقم الجوال السعودي غير صحيح، يجب أن يتكون من 10 أرقام ويبدأ بـ 05 (مثال: 0501234567)' };
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

// ─── Submit Order ───────────────────────────────────────────────
async function submitOrder(e) {
  e.preventDefault();
  const errorEl = document.getElementById('formError');
  const submitBtn = document.getElementById('submitBtn');
  errorEl.classList.remove('show');

  const name        = document.getElementById('customerName').value.trim();
  const countryCode = document.getElementById('customerCountryCode').value;
  const phoneRaw    = document.getElementById('customerPhone').value;
  const city        = document.getElementById('customerCity').value.trim();
  const address     = document.getElementById('customerAddress').value.trim();
  const notes       = document.getElementById('customerNotes').value.trim();

  if (!name || !phoneRaw || !city || !address) {
    showError(errorEl, 'الرجاء ملء جميع الحقول المطلوبة (الاسم، الهاتف، المدينة، العنوان).');
    return;
  }

  if (!isValidName(name)) {
    showError(errorEl, 'الاسم الكامل يجب أن يحتوي على 3 أحرف على الأقل.');
    return;
  }

  const phoneVal = validateAndFormatPhoneClient(phoneRaw, countryCode);
  if (!phoneVal.valid) {
    showError(errorEl, phoneVal.error);
    return;
  }

  if (city.length < 2) {
    showError(errorEl, 'يرجى إدخال اسم مدينة صحيح.');
    return;
  }

  if (address.length < 4) {
    showError(errorEl, 'يرجى إدخال عنوان تفصيلي واضح لتسليم الطلب.');
    return;
  }

  const items = getCartItems().map(({ product: p, qty }) => ({
    product_id: p.id,
    product_name: p.name,
    quantity: qty,
    price: p.price
  }));

  submitBtn.disabled = true;
  submitBtn.textContent = 'جاري الإرسال وتجهيز الطلب...';

  try {
    const res = await fetch(`${API}/api/orders`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({
        customer_name: name,
        customer_phone: phoneVal.formatted,
        customer_country: countryCode,
        customer_city: city,
        customer_address: address,
        notes,
        items
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'حدث خطأ غير متوقع');

    // Clear cart
    cart = {};
    renderCart();

    // Reset form
    document.getElementById('orderForm').reset();
    closeOrderModal();

    // Show success
    document.getElementById('successOrderId').textContent = `#${data.order_id}`;
    document.getElementById('whatsappLink').href = data.whatsapp_url;
    document.getElementById('successModalOverlay').classList.add('open');

    // Reload products (stock updated)
    loadProducts();

  } catch (err) {
    showError(errorEl, err.message);
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'إرسال وتجهيز الطلب 🌟';
  }
}

// ─── Auth Bindings & Functions ─────────────────────────────────
function bindAuthUI() {
  const loginModal = document.getElementById('loginModalOverlay');
  const registerModal = document.getElementById('registerModalOverlay');
  const verifyModal = document.getElementById('verifyModalOverlay');
  const myOrdersModal = document.getElementById('myOrdersModalOverlay');

  // Country code selector placeholder updater
  const regCountry = document.getElementById('regCountryCode');
  const regPhoneInput = document.getElementById('regPhone');
  if (regCountry && regPhoneInput) {
    regCountry.addEventListener('change', () => {
      regPhoneInput.placeholder = regCountry.value === '+967' ? '7xxxxxxxx' : '05xxxxxxxx';
    });
  }

  const custCountry = document.getElementById('customerCountryCode');
  const custPhoneInput = document.getElementById('customerPhone');
  if (custCountry && custPhoneInput) {
    custCountry.addEventListener('change', () => {
      custPhoneInput.placeholder = custCountry.value === '+967' ? '7xxxxxxxx' : '05xxxxxxxx';
    });
  }

  // Open modals
  document.getElementById('loginBtn')?.addEventListener('click', () => {
    openModal('loginModalOverlay');
    document.getElementById('loginEmail')?.focus();
  });
  document.getElementById('registerBtn')?.addEventListener('click', () => {
    openModal('registerModalOverlay');
    document.getElementById('regName')?.focus();
  });
  document.getElementById('myOrdersBtn')?.addEventListener('click', loadMyOrders);
  document.getElementById('logoutBtn')?.addEventListener('click', logout);

  // Close modals
  document.getElementById('closeLoginModal')?.addEventListener('click', () => closeModal('loginModalOverlay'));
  document.getElementById('closeRegisterModal')?.addEventListener('click', () => closeModal('registerModalOverlay'));
  document.getElementById('closeVerifyModal')?.addEventListener('click', () => closeModal('verifyModalOverlay'));
  document.getElementById('closeMyOrders')?.addEventListener('click', () => closeModal('myOrdersModalOverlay'));

  // Overlay click to close
  loginModal?.addEventListener('click', e => { if (e.target === loginModal) closeModal('loginModalOverlay'); });
  registerModal?.addEventListener('click', e => { if (e.target === registerModal) closeModal('registerModalOverlay'); });
  verifyModal?.addEventListener('click', e => { if (e.target === verifyModal) closeModal('verifyModalOverlay'); });
  myOrdersModal?.addEventListener('click', e => { if (e.target === myOrdersModal) closeModal('myOrdersModalOverlay'); });

  // Switch between Login and Register
  document.getElementById('switchToRegister')?.addEventListener('click', e => {
    e.preventDefault();
    closeModal('loginModalOverlay');
    openModal('registerModalOverlay');
  });

  document.getElementById('switchToLogin')?.addEventListener('click', e => {
    e.preventDefault();
    closeModal('registerModalOverlay');
    openModal('loginModalOverlay');
  });

  // Form submits
  document.getElementById('loginSubmit')?.addEventListener('click', handleLogin);
  document.getElementById('registerSubmit')?.addEventListener('click', handleRegister);
  document.getElementById('verifySubmit')?.addEventListener('click', handleVerifyCode);
  document.getElementById('resendCodeBtn')?.addEventListener('click', handleResendCode);
  document.getElementById('cancelVerifyBtn')?.addEventListener('click', e => {
    e.preventDefault();
    closeModal('verifyModalOverlay');
    openModal('registerModalOverlay');
  });

  // Enter key support
  document.getElementById('loginPassword')?.addEventListener('keyup', e => {
    if (e.key === 'Enter') handleLogin();
  });
  document.getElementById('regPassword')?.addEventListener('keyup', e => {
    if (e.key === 'Enter') handleRegister();
  });
  document.getElementById('verifyCode')?.addEventListener('keyup', e => {
    if (e.key === 'Enter') handleVerifyCode();
  });
}

function openModal(id) {
  const el = document.getElementById(id);
  if (el) {
    el.classList.add('open');
    document.body.style.overflow = 'hidden';
  }
}

function closeModal(id) {
  const el = document.getElementById(id);
  if (el) {
    el.classList.remove('open');
    document.body.style.overflow = '';
  }
}

// ─── Login Logic ───────────────────────────────────────────────
async function handleLogin() {
  const emailInput = document.getElementById('loginEmail');
  const passInput = document.getElementById('loginPassword');
  const errorEl = document.getElementById('loginError');
  const submitBtn = document.getElementById('loginSubmit');

  errorEl.classList.remove('show');
  const email = emailInput.value.trim();
  const password = passInput.value;

  if (!email || !password) {
    showError(errorEl, 'يرجى إدخال البريد الإلكتروني وكلمة المرور');
    return;
  }

  submitBtn.disabled = true;
  submitBtn.textContent = 'جاري التحقق...';

  try {
    const res = await fetch(`${API}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'فشل تسجيل الدخول');

    authToken = data.token;
    currentCustomer = data.customer;
    localStorage.setItem('najd_token', authToken);
    localStorage.setItem('najd_customer', JSON.stringify(currentCustomer));

    updateAuthUI();
    closeModal('loginModalOverlay');
    emailInput.value = '';
    passInput.value = '';

    onAuthSuccess();

  } catch (err) {
    showError(errorEl, err.message);
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'دخول';
  }
}

// ─── Register Logic (Initiates Email Verification) ──────────────
async function handleRegister() {
  const nameInput = document.getElementById('regName');
  const emailInput = document.getElementById('regEmail');
  const countryCode = document.getElementById('regCountryCode').value;
  const phoneInput = document.getElementById('regPhone');
  const passInput = document.getElementById('regPassword');
  const errorEl = document.getElementById('registerError');
  const submitBtn = document.getElementById('registerSubmit');

  errorEl.classList.remove('show');

  const name = nameInput.value.trim();
  const email = emailInput.value.trim().toLowerCase();
  const phone = phoneInput.value;
  const password = passInput.value;

  if (!name || !email || !phone || !password) {
    showError(errorEl, 'يرجى ملء جميع الحقول المطلوبة (الاسم، البريد، الجوال، كلمة المرور)');
    return;
  }

  if (!isValidName(name)) {
    showError(errorEl, 'الاسم الكامل غير صحيح، يجب أن يحتوي على 3 أحرف على الأقل');
    return;
  }

  if (!isValidEmail(email)) {
    showError(errorEl, 'البريد الإلكتروني غير صحيح، يرجى كتابة بريد صالح (مثال: name@gmail.com)');
    return;
  }

  const phoneVal = validateAndFormatPhoneClient(phone, countryCode);
  if (!phoneVal.valid) {
    showError(errorEl, phoneVal.error);
    return;
  }

  if (password.length < 8) {
    showError(errorEl, 'كلمة المرور يجب أن تكون 8 خانات أو أكثر لضمان أمان حسابك');
    return;
  }

  submitBtn.disabled = true;
  submitBtn.textContent = 'جاري إرسال رابط التفعيل...';

  try {
    const res = await fetch(`${API}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        email,
        phone: phoneVal.formatted,
        country_code: countryCode,
        password
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'فشل إرسال رابط التفعيل');

    // Switch to Email Verification Modal
    pendingVerificationEmail = email;
    closeModal('registerModalOverlay');

    document.getElementById('verifyEmailDisplay').textContent = email;
    document.getElementById('verifyCode').value = '';
    document.getElementById('verifyError').classList.remove('show');

    // If SMTP wasn't configured yet, help developer with friendly notice
    const noticeEl = document.getElementById('unconfiguredNotice');
    if (data.dev_code && noticeEl) {
      noticeEl.innerHTML = `
        <div style="font-size:13px;line-height:1.6;text-align:center;">
          ⚠️ <strong>تنبيه للمسؤول:</strong><br>
          لم يتم ربط بريد الإرسال (Gmail) في لوحة التحكم بعد لتسليم الرسائل لصندوق البريد الحقيقي.<br>
          لتجربة الحساب الآن، رمز التحقق هو: <strong style="font-size:20px;letter-spacing:3px;color:var(--gold-dark);">${data.dev_code}</strong><br>
          <a href="${data.dev_link}" style="display:inline-block;margin-top:6px;color:var(--gold-dark);font-weight:bold;text-decoration:underline;">أو اضغط هنا للتفعيل الفوري</a>
          <br><small style="color:var(--text-muted);">(لإرسال الرسائل لبريد العملاء الفعلي تلقائياً، اربط بريدك في لوحة التحكم > إعدادات البريد).</small>
        </div>
      `;
      noticeEl.style.display = 'block';
    } else if (noticeEl) {
      noticeEl.style.display = 'none';
    }

    openModal('verifyModalOverlay');
    document.getElementById('verifyCode').focus();

  } catch (err) {
    showError(errorEl, err.message);
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'إرسال رابط تفعيل البريد';
  }
}

// ─── Verify Email Code Logic ───────────────────────────────────
async function handleVerifyCode() {
  const codeInput = document.getElementById('verifyCode');
  const errorEl = document.getElementById('verifyError');
  const submitBtn = document.getElementById('verifySubmit');

  errorEl.classList.remove('show');
  const code = normalizePhone(codeInput.value);

  if (!code || code.length !== 6) {
    showError(errorEl, 'يرجى إدخال رمز التفعيل المكون من 6 أرقام');
    return;
  }

  submitBtn.disabled = true;
  submitBtn.textContent = 'جاري التحقق من الرمز...';

  try {
    const res = await fetch(`${API}/api/auth/verify-code`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: pendingVerificationEmail,
        code
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'رمز التحقق غير صحيح');

    // Verification successful! Save token and login user
    authToken = data.token;
    currentCustomer = data.customer;
    localStorage.setItem('najd_token', authToken);
    localStorage.setItem('najd_customer', JSON.stringify(currentCustomer));

    closeModal('verifyModalOverlay');

    // Reset forms
    document.getElementById('regName').value = '';
    document.getElementById('regEmail').value = '';
    document.getElementById('regPhone').value = '';
    document.getElementById('regPassword').value = '';
    codeInput.value = '';

    onAuthSuccess();

  } catch (err) {
    showError(errorEl, err.message);
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'تأكيد وتفعيل الحساب ✨';
  }
}

// ─── Resend Verification Code Logic ─────────────────────────────
async function handleResendCode() {
  const resendBtn = document.getElementById('resendCodeBtn');
  const errorEl = document.getElementById('verifyError');

  errorEl.classList.remove('show');
  resendBtn.disabled = true;
  resendBtn.textContent = 'جاري الإرسال...';

  try {
    const res = await fetch(`${API}/api/auth/resend-code`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: pendingVerificationEmail })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'فشل إعادة الإرسال');

    const noticeEl = document.getElementById('unconfiguredNotice');
    if (data.dev_code && noticeEl) {
      noticeEl.innerHTML = `
        <div style="font-size:13px;line-height:1.6;text-align:center;">
          ⚠️ <strong>رمز التحقق الجديد:</strong> <strong style="font-size:20px;letter-spacing:3px;color:var(--gold-dark);">${data.dev_code}</strong><br>
          <a href="${data.dev_link}" style="display:inline-block;margin-top:6px;color:var(--gold-dark);font-weight:bold;text-decoration:underline;">أو اضغط هنا للتفعيل الفوري</a>
        </div>
      `;
      noticeEl.style.display = 'block';
    }

    alert('تم إرسال رسالة التفعيل ورمز التحقق الجديد إلى بريدك الإلكتروني بنجاح.');

  } catch (err) {
    showError(errorEl, err.message);
  } finally {
    resendBtn.disabled = false;
    resendBtn.textContent = 'إعادة إرسال الرابط والرمز 🔄';
  }
}

// ─── My Orders Logic ───────────────────────────────────────────
async function loadMyOrders() {
  const container = document.getElementById('myOrdersContent');
  container.innerHTML = '<p style="text-align:center;color:var(--text-muted);padding:30px">جاري تحميل طلباتك...</p>';
  openModal('myOrdersModalOverlay');

  try {
    const res = await fetch(`${API}/api/auth/my-orders`, {
      headers: getAuthHeaders()
    });

    if (res.status === 401 || res.status === 403) {
      logout();
      closeModal('myOrdersModalOverlay');
      openModal('loginModalOverlay');
      return;
    }

    const orders = await res.json();

    if (!orders || !orders.length) {
      container.innerHTML = `
        <div style="text-align:center;padding:40px 20px;color:var(--text-muted)">
          <span style="font-size:44px;display:block;margin-bottom:12px">📦</span>
          <p style="font-weight:700;font-size:16px;color:var(--gold-dark);margin-bottom:6px">لا توجد لديك طلبات سابقة بعد</p>
          <p style="font-size:14px">اختر من عطورنا الفاخرة وسجل طلبك الأول وسيظهر هنا مباشرة!</p>
        </div>`;
      return;
    }

    const STATUS_MAP = {
      pending:   { label: 'قيد التجهيز / معلق', bg: '#fef3c7', color: '#b45309' },
      confirmed: { label: 'تم التأكيد وجاري الشحن', bg: '#dbeafe', color: '#1d4ed8' },
      delivered: { label: 'تم التسليم بنجاح', bg: '#dcfce7', color: '#15803d' },
      cancelled: { label: 'ملغي', bg: '#fee2e2', color: '#b91c1c' }
    };

    container.innerHTML = orders.map(o => {
      const st = STATUS_MAP[o.status] || { label: o.status, bg: '#f3f4f6', color: '#4b5563' };
      const itemsList = (o.items || []).map(i => `• ${escHtml(i.product_name)} × ${i.quantity} (${(i.price * i.quantity).toFixed(2)} ريال)`).join('<br>');
      const dateStr = o.created_at ? new Date(o.created_at).toLocaleDateString('ar-SA', {
        year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit'
      }) : '—';

      return `
        <div class="my-order-card">
          <div class="my-order-header">
            <div>
              <span class="my-order-id">طلب #${o.id}</span>
              <span class="my-order-date">(${dateStr})</span>
            </div>
            <span class="my-order-status-badge" style="background:${st.bg};color:${st.color}">
              ${st.label}
            </span>
          </div>
          <div class="my-order-items">
            <strong>العطور:</strong><br>${itemsList || '—'}
          </div>
          <div class="my-order-total-row">
            <span>موقع التوصيل: ${escHtml(o.customer_city)} - ${escHtml(o.customer_address)}</span>
            <span style="color:var(--gold-dark)">الإجمالي: ${(o.total_price || 0).toFixed(2)} ريال</span>
          </div>
        </div>
      `;
    }).join('');

  } catch (err) {
    container.innerHTML = '<p style="text-align:center;color:var(--danger);padding:30px">حدث خطأ أثناء تحميل الطلبات</p>';
  }
}

// ─── Helpers ────────────────────────────────────────────────────
function showError(el, msg) {
  el.textContent = msg;
  el.classList.add('show');
}

function escHtml(str) {
  return String(str)
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;');
}
