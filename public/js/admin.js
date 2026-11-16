/* =====================================================
   admin.js — Admin Panel Logic
   ===================================================== */

const API = '';

// State
let currentOrderId = null;
let deleteProductId = null;
let allOrders = [];

// ─── Init ──────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  bindNavigation();
  bindModals();
  bindEmailSettings();
  loadDashboard();
});

// ─── Tab Navigation ────────────────────────────────────────────
function bindNavigation() {
  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
      btn.classList.add('active');
      const tab = btn.dataset.tab;
      document.getElementById(`tab-${tab}`).classList.add('active');
      if (tab === 'dashboard') loadDashboard();
      if (tab === 'products') loadProducts();
      if (tab === 'orders') loadOrders();
      if (tab === 'settings') loadEmailSettings();
    });
  });
}

// ─── Modals ─────────────────────────────────────────────────────
function bindModals() {
  // Product modal
  document.getElementById('addProductBtn').addEventListener('click', openAddProduct);
  document.getElementById('closeProductModal').addEventListener('click', closeProductModal);
  document.getElementById('productModalOverlay').addEventListener('click', e => {
    if (e.target === document.getElementById('productModalOverlay')) closeProductModal();
  });
  document.getElementById('productForm').addEventListener('submit', saveProduct);

  // Image Upload Bindings
  bindImageUpload();

  // Excel Export Binding
  document.getElementById('exportExcelBtn').addEventListener('click', exportOrdersToExcel);

  // Order detail modal
  document.getElementById('closeOrderDetail').addEventListener('click', () => closeModal('orderDetailOverlay'));
  document.getElementById('orderDetailOverlay').addEventListener('click', e => {
    if (e.target === document.getElementById('orderDetailOverlay')) closeModal('orderDetailOverlay');
  });
  document.getElementById('updateStatusBtn').addEventListener('click', updateOrderStatus);

  // Delete confirm modal
  document.getElementById('closeDeleteModal').addEventListener('click', () => closeModal('deleteConfirmOverlay'));
  document.getElementById('cancelDeleteBtn').addEventListener('click', () => closeModal('deleteConfirmOverlay'));
  document.getElementById('confirmDeleteBtn').addEventListener('click', confirmDelete);

  // Orders filter
  document.getElementById('statusFilter').addEventListener('change', e => {
    renderOrdersTable(
      e.target.value ? allOrders.filter(o => o.status === e.target.value) : allOrders
    );
  });
}

// ─── Image Upload Logic ─────────────────────────────────────────
function bindImageUpload() {
  const triggerBtn = document.getElementById('triggerUploadBtn');
  const fileInput = document.getElementById('productImageFile');
  const statusText = document.getElementById('uploadStatusText');
  const previewContainer = document.getElementById('imagePreviewContainer');
  const previewImg = document.getElementById('imagePreview');
  const removeBtn = document.getElementById('removePreviewBtn');
  const urlInput = document.getElementById('productImage');

  triggerBtn.addEventListener('click', () => fileInput.click());

  fileInput.addEventListener('change', async () => {
    if (!fileInput.files || !fileInput.files[0]) return;
    const file = fileInput.files[0];

    statusText.textContent = 'جاري رفع الصورة...';
    triggerBtn.disabled = true;

    const formData = new FormData();
    formData.append('image', file);

    try {
      const res = await fetch(`${API}/api/upload-image`, {
        method: 'POST',
        body: formData
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'فشل رفع الصورة');

      urlInput.value = data.url;
      previewImg.src = data.url;
      previewContainer.style.display = 'block';
      statusText.textContent = '✔ تم رفع الصورة بنجاح';
      statusText.style.color = '#15803d';

    } catch (err) {
      statusText.textContent = `❌ ${err.message}`;
      statusText.style.color = '#b91c1c';
    } finally {
      triggerBtn.disabled = false;
    }
  });

  removeBtn.addEventListener('click', () => {
    fileInput.value = '';
    urlInput.value = '';
    previewImg.src = '';
    previewContainer.style.display = 'none';
    statusText.textContent = '';
  });

  urlInput.addEventListener('input', () => {
    const val = urlInput.value.trim();
    if (val) {
      previewImg.src = val;
      previewContainer.style.display = 'block';
    } else {
      previewContainer.style.display = 'none';
    }
  });
}

// ─── Export Orders to Excel ─────────────────────────────────────
function exportOrdersToExcel() {
  const filterVal = document.getElementById('statusFilter').value;
  const url = `${API}/api/orders/export/excel${filterVal ? '?status=' + encodeURIComponent(filterVal) : ''}`;
  window.open(url, '_blank');
}

function openModal(id) { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }

// ─── Dashboard ──────────────────────────────────────────────────
async function loadDashboard() {
  try {
    const res = await fetch(`${API}/api/stats`);
    const stats = await res.json();

    document.getElementById('statTotal').textContent = stats.totalOrders;
    document.getElementById('statPending').textContent = stats.pendingOrders;
    document.getElementById('statRevenue').textContent = stats.totalRevenue.toFixed(2);
    document.getElementById('statLowStock').textContent = stats.lowStock;

    const tbody = document.getElementById('recentOrdersBody');
    if (!stats.recentOrders.length) {
      tbody.innerHTML = '<tr class="empty-row"><td colspan="6">لا توجد طلبات بعد</td></tr>';
      return;
    }
    tbody.innerHTML = stats.recentOrders.map(o => `
      <tr>
        <td><strong>#${o.id}</strong></td>
        <td>${escHtml(o.customer_name)}</td>
        <td>${escHtml(o.customer_city)}</td>
        <td>${o.total_price ? o.total_price.toFixed(2) + ' ريال' : '—'}</td>
        <td>${statusBadge(o.status)}</td>
        <td>${formatDate(o.created_at)}</td>
      </tr>`).join('');
  } catch (err) {
    console.error('Dashboard error:', err);
  }
}

// ─── Products ───────────────────────────────────────────────────
async function loadProducts() {
  try {
    const res = await fetch(`${API}/api/products/all`);
    const products = await res.json();
    const tbody = document.getElementById('productsBody');

    if (!products.length) {
      tbody.innerHTML = '<tr class="empty-row"><td colspan="6">لا توجد منتجات</td></tr>';
      return;
    }
    tbody.innerHTML = products.map(p => `
      <tr>
        <td><strong>#${p.id}</strong></td>
        <td>${escHtml(p.name)}</td>
        <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(p.description || '—')}</td>
        <td>${p.price.toFixed(2)} ريال</td>
        <td>
          <span style="font-weight:700;color:${p.stock === 0 ? '#ef4444' : p.stock <= 5 ? '#f59e0b' : '#22c55e'}">
            ${p.stock}
          </span>
        </td>
        <td>
          <button class="icon-btn edit" onclick="openEditProduct(${p.id})" title="تعديل">✏️</button>
          <button class="icon-btn del" onclick="openDeleteProduct(${p.id})" title="حذف">🗑️</button>
        </td>
      </tr>`).join('');
  } catch (err) {
    console.error('Products error:', err);
  }
}

function openAddProduct() {
  document.getElementById('productModalTitle').textContent = 'إضافة منتج';
  document.getElementById('productId').value = '';
  document.getElementById('productForm').reset();
  document.getElementById('productError').classList.remove('show');

  // Reset image upload preview
  document.getElementById('imagePreview').src = '';
  document.getElementById('imagePreviewContainer').style.display = 'none';
  document.getElementById('uploadStatusText').textContent = '';

  openModal('productModalOverlay');
}

async function openEditProduct(id) {
  try {
    const res = await fetch(`${API}/api/products/all`);
    const products = await res.json();
    const p = products.find(x => x.id === id);
    if (!p) return;
    document.getElementById('productModalTitle').textContent = 'تعديل منتج';
    document.getElementById('productId').value = p.id;
    document.getElementById('productName').value = p.name;
    document.getElementById('productDesc').value = p.description || '';
    document.getElementById('productPrice').value = p.price;
    document.getElementById('productStock').value = p.stock;
    document.getElementById('productImage').value = p.image_url || '';
    document.getElementById('productError').classList.remove('show');

    // Show existing image preview if available
    const previewContainer = document.getElementById('imagePreviewContainer');
    const previewImg = document.getElementById('imagePreview');
    document.getElementById('uploadStatusText').textContent = '';
    if (p.image_url) {
      previewImg.src = p.image_url;
      previewContainer.style.display = 'block';
    } else {
      previewImg.src = '';
      previewContainer.style.display = 'none';
    }

    openModal('productModalOverlay');
  } catch (err) {
    console.error(err);
  }
}

function closeProductModal() { closeModal('productModalOverlay'); }

async function saveProduct(e) {
  e.preventDefault();
  const errorEl = document.getElementById('productError');
  errorEl.classList.remove('show');
  const id = document.getElementById('productId').value;
  const submitBtn = document.getElementById('productSubmitBtn');

  const body = {
    name: document.getElementById('productName').value.trim(),
    description: document.getElementById('productDesc').value.trim(),
    price: parseFloat(document.getElementById('productPrice').value),
    stock: parseInt(document.getElementById('productStock').value),
    image_url: document.getElementById('productImage').value.trim()
  };

  if (!body.name || isNaN(body.price) || isNaN(body.stock)) {
    errorEl.textContent = 'الرجاء ملء جميع الحقول المطلوبة';
    errorEl.classList.add('show');
    return;
  }

  submitBtn.disabled = true;
  try {
    const url = id ? `${API}/api/products/${id}` : `${API}/api/products`;
    const method = id ? 'PUT' : 'POST';
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    closeProductModal();
    loadProducts();
    loadDashboard();
  } catch (err) {
    errorEl.textContent = err.message || 'حدث خطأ';
    errorEl.classList.add('show');
  } finally {
    submitBtn.disabled = false;
  }
}

function openDeleteProduct(id) {
  deleteProductId = id;
  openModal('deleteConfirmOverlay');
}

async function confirmDelete() {
  if (!deleteProductId) return;
  try {
    const res = await fetch(`${API}/api/products/${deleteProductId}`, { method: 'DELETE' });
    if (!res.ok) {
      const data = await res.json();
      alert(data.error || 'فشل الحذف');
      return;
    }
    closeModal('deleteConfirmOverlay');
    loadProducts();
    loadDashboard();
  } catch (err) {
    alert('حدث خطأ أثناء الحذف');
  }
  deleteProductId = null;
}

// ─── Orders ─────────────────────────────────────────────────────
async function loadOrders() {
  try {
    const res = await fetch(`${API}/api/orders`);
    allOrders = await res.json();
    renderOrdersTable(allOrders);
  } catch (err) {
    console.error('Orders error:', err);
  }
}

function renderOrdersTable(orders) {
  const tbody = document.getElementById('ordersBody');
  if (!orders.length) {
    tbody.innerHTML = '<tr class="empty-row"><td colspan="8">لا توجد طلبات</td></tr>';
    return;
  }
  tbody.innerHTML = orders.map(o => `
    <tr>
      <td><strong>#${o.id}</strong></td>
      <td>${escHtml(o.customer_name)}</td>
      <td dir="ltr">${escHtml(o.customer_phone)}</td>
      <td>${escHtml(o.customer_city)}</td>
      <td>${o.total_price ? o.total_price.toFixed(2) + ' ريال' : '—'}</td>
      <td>${statusBadge(o.status)}</td>
      <td>${formatDate(o.created_at)}</td>
      <td>
        <button class="primary-btn" onclick="viewOrder(${o.id})" style="padding:6px 12px;font-size:12px">عرض</button>
      </td>
    </tr>`).join('');
}

async function viewOrder(id) {
  try {
    const res = await fetch(`${API}/api/orders/${id}`);
    const order = await res.json();
    currentOrderId = id;

    document.getElementById('detailOrderId').textContent = `#${id}`;
    document.getElementById('detailName').textContent = order.customer_name;
    document.getElementById('detailPhone').textContent = order.customer_phone;
    document.getElementById('detailCity').textContent = order.customer_city;
    document.getElementById('detailAddress').textContent = order.customer_address;
    document.getElementById('detailNotes').textContent = order.notes || '—';
    document.getElementById('detailDate').textContent = formatDate(order.created_at);
    document.getElementById('detailTotal').textContent = (order.total_price || 0).toFixed(2) + ' ريال';
    document.getElementById('detailStatus').value = order.status;

    // Setup direct WhatsApp action links
    const cleanPhone = (order.customer_phone || '').replace(/\D/g, '');
    const waText = encodeURIComponent(`مرحباً ${order.customer_name}، بخصوص طلبك #${id} من متجر نجد للعطور...`);
    const adminNotifText = encodeURIComponent(`طلب رقم #${id} - العميل: ${order.customer_name} - الإجمالي: ${(order.total_price || 0).toFixed(2)} ريال`);

    const custBtn = document.getElementById('detailWhatsappCustomer');
    const adminBtn = document.getElementById('detailWhatsappAdmin');
    if (custBtn) custBtn.href = `https://wa.me/${cleanPhone}?text=${waText}`;
    if (adminBtn) adminBtn.href = `https://wa.me/966500000000?text=${adminNotifText}`;

    const tbody = document.getElementById('detailItemsBody');
    tbody.innerHTML = (order.items || []).map(item => `
      <tr>
        <td>${escHtml(item.product_name)}</td>
        <td>${item.quantity}</td>
        <td>${item.price.toFixed(2)} ريال</td>
        <td>${(item.price * item.quantity).toFixed(2)} ريال</td>
      </tr>`).join('') || '<tr><td colspan="4" style="text-align:center;color:#64748b">لا توجد عناصر</td></tr>';

    openModal('orderDetailOverlay');
  } catch (err) {
    console.error('View order error:', err);
  }
}

async function updateOrderStatus() {
  if (!currentOrderId) return;
  const status = document.getElementById('detailStatus').value;
  try {
    const res = await fetch(`${API}/api/orders/${currentOrderId}/status`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status })
    });
    if (!res.ok) {
      const data = await res.json();
      alert(data.error || 'فشل التحديث');
      return;
    }
    closeModal('orderDetailOverlay');
    loadOrders();
    loadDashboard();
  } catch (err) {
    alert('حدث خطأ أثناء التحديث');
  }
}

// ─── Helpers ────────────────────────────────────────────────────
const STATUS_LABELS = {
  pending:   { label: 'معلق',         cls: 'pending' },
  confirmed: { label: 'مؤكد',         cls: 'confirmed' },
  delivered: { label: 'تم التوصيل',   cls: 'delivered' },
  cancelled: { label: 'ملغي',         cls: 'cancelled' }
};

function statusBadge(status) {
  const s = STATUS_LABELS[status] || { label: status, cls: 'pending' };
  return `<span class="status-badge ${s.cls}">${s.label}</span>`;
}

function formatDate(str) {
  if (!str) return '—';
  const d = new Date(str);
  return d.toLocaleDateString('ar-SA', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function escHtml(str) {
  return String(str)
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;');
}

// ─── Real-Time Admin WhatsApp & Order Notifications ────────────
let lastSeenNotifTime = Date.now();

async function pollAdminNotifications() {
  try {
    const res = await fetch(`${API}/api/admin/latest-notification`);
    const data = await res.json();
    if (data.notification && data.notification.timestamp > lastSeenNotifTime) {
      lastSeenNotifTime = data.notification.timestamp;
      showLiveOrderNotification(data.notification);
      loadDashboard();
      loadOrders();
    }
  } catch (e) {}
}

function showLiveOrderNotification(n) {
  const alertEl = document.getElementById('liveOrderAlert');
  if (!alertEl) return;

  alertEl.innerHTML = `
    <div class="alert-info">
      <span style="font-size:22px;">🔔</span>
      <div>
        <div>طلب جديد وصل للتو! <strong>#${n.order_id}</strong> — ${escHtml(n.customer_name)} (${escHtml(n.customer_phone)})</div>
        <div style="font-size:12px;opacity:0.9;">المدينة: ${escHtml(n.customer_city)} | الإجمالي: ${n.total_price.toFixed(2)} ريال</div>
      </div>
    </div>
    <div style="display:flex;gap:8px;align-items:center;">
      <a href="${n.admin_whatsapp_url}" target="_blank" class="alert-btn" title="فتح إشعار الطلب المنسق للإدارة على واتساب">
        💬 فتح إشعار الواتساب
      </a>
      <a href="${n.customer_direct_whatsapp_url}" target="_blank" class="alert-btn" style="background:#25D366;color:#fff;" title="مراسلة العميل مباشرة عبر واتساب">
        👤 محادثة العميل
      </a>
      <button onclick="document.getElementById('liveOrderAlert').style.display='none'" style="background:transparent;border:none;color:#fff;font-size:18px;cursor:pointer;padding:0 6px;" title="إغلاق">✕</button>
    </div>
  `;
  alertEl.style.display = 'flex';

  // Play a soft notification audio chime using Web Audio API
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(587.33, ctx.currentTime);
    osc.frequency.setValueAtTime(880, ctx.currentTime + 0.15);
    gain.gain.setValueAtTime(0.2, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.4);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.4);
  } catch (e) {}
}

// Start polling every 4 seconds
setInterval(pollAdminNotifications, 4000);

// ─── Email Settings Logic ───────────────────────────────────────
function bindEmailSettings() {
  const serviceSel = document.getElementById('settingService');
  const customFields = document.getElementById('customSmtpFields');
  if (serviceSel && customFields) {
    serviceSel.addEventListener('change', () => {
      customFields.style.display = serviceSel.value === 'smtp' ? 'block' : 'none';
    });
  }

  document.getElementById('saveEmailSettingsBtn')?.addEventListener('click', saveEmailSettings);
  document.getElementById('sendTestEmailBtn')?.addEventListener('click', sendTestEmail);
}

async function loadEmailSettings() {
  try {
    const res = await fetch(`${API}/api/admin/email-settings`);
    const data = await res.json();
    if (data) {
      if (data.service) document.getElementById('settingService').value = data.service;
      if (data.host) document.getElementById('settingHost').value = data.host;
      if (data.port) document.getElementById('settingPort').value = data.port;
      if (data.user) document.getElementById('settingUser').value = data.user;
      const customFields = document.getElementById('customSmtpFields');
      if (customFields) customFields.style.display = data.service === 'smtp' ? 'block' : 'none';

      const successEl = document.getElementById('settingsSuccess');
      if (data.configured) {
        successEl.textContent = `✔ البريد الإلكتروني مضبوط حالياً (${data.user})`;
        successEl.style.display = 'block';
      }
    }
  } catch (e) {
    console.error('Failed to load email settings:', e);
  }
}

async function saveEmailSettings() {
  const service = document.getElementById('settingService').value;
  const host = document.getElementById('settingHost').value.trim();
  const port = document.getElementById('settingPort').value.trim();
  const user = document.getElementById('settingUser').value.trim();
  const pass = document.getElementById('settingPass').value.replace(/\s+/g, '');

  const errEl = document.getElementById('settingsError');
  const succEl = document.getElementById('settingsSuccess');
  errEl.classList.remove('show');
  succEl.style.display = 'none';

  if (!user) {
    errEl.textContent = 'يرجى إدخال البريد الإلكتروني للإرسال';
    errEl.classList.add('show');
    return;
  }

  const btn = document.getElementById('saveEmailSettingsBtn');
  btn.disabled = true;
  btn.textContent = 'جاري الحفظ...';

  try {
    const res = await fetch(`${API}/api/admin/email-settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ service, host, port, user, pass })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'فشل حفظ الإعدادات');

    succEl.textContent = data.message;
    succEl.style.display = 'block';
    document.getElementById('settingPass').value = '';
  } catch (err) {
    errEl.textContent = err.message;
    errEl.classList.add('show');
  } finally {
    btn.disabled = false;
    btn.textContent = '💾 حفظ إعدادات البريد';
  }
}

async function sendTestEmail() {
  const target = document.getElementById('testEmailTarget').value.trim();
  const statusEl = document.getElementById('testEmailStatus');
  const btn = document.getElementById('sendTestEmailBtn');

  if (!target) {
    statusEl.textContent = '❌ يرجى كتابة البريد الإلكتروني المراد التجربة عليه';
    statusEl.style.color = '#b91c1c';
    statusEl.style.background = '#fee2e2';
    statusEl.style.display = 'block';
    return;
  }

  btn.disabled = true;
  btn.textContent = 'جاري الإرسال...';
  statusEl.style.display = 'none';

  try {
    const res = await fetch(`${API}/api/admin/test-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target_email: target })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'فشل إرسال الإيميل');

    statusEl.textContent = '✔ ' + data.message;
    statusEl.style.color = '#15803d';
    statusEl.style.background = '#dcfce7';
    statusEl.style.display = 'block';
  } catch (err) {
    statusEl.textContent = '❌ ' + err.message;
    statusEl.style.color = '#b91c1c';
    statusEl.style.background = '#fee2e2';
    statusEl.style.display = 'block';
  } finally {
    btn.disabled = false;
    btn.textContent = 'إرسال تجربة الآن';
  }
}
