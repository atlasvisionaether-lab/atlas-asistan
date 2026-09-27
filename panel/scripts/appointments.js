// panel/js/appointments.js - MANUAL CUSTOMER NAME FIX
// Eski select yerine serbest metin + auto-create customer

const ORG_ID = window.ORG_ID || '00000000-0000-0000-0000-000000000001'; // senin org id'ni app.js set ediyor, bu fallback
let currentDay = new Date();
currentDay.setHours(0,0,0,0);

function toISODate(d) { return d.toISOString().split('T')[0]; }
function toTRDate(d) { return d.toLocaleDateString('tr-TR', {day:'2-digit', month:'long', year:'numeric'}); }

async function loadAppointmentsForDay(day = currentDay) {
  currentDay = day;
  const dayLabel = document.getElementById('current-day-label');
  if (dayLabel) dayLabel.textContent = toTRDate(day);

  const start = new Date(day); start.setHours(0,0,0,0);
  const end = new Date(day); end.setHours(23,59,59,999);

  const { data, error } = await supabase
    .from('appointments')
    .select('id, service_name, starts_at, ends_at, status, notes, customer_id, customers(full_name)')
    .eq('organization_id', ORG_ID)
    .gte('starts_at', start.toISOString())
    .lte('starts_at', end.toISOString())
    .order('starts_at', { ascending: true });

  if (error) {
    console.error('appointments load error', error);
    document.getElementById('appointments-list').innerHTML = `<div class="card error">Hata: ${error.message}</div>`;
    return;
  }
  renderDay(data || []);
}

function renderDay(list) {
  const box = document.getElementById('appointments-list');
  if (!box) return;
  if (!list.length) {
    box.innerHTML = `<div class="card" style="padding:20px;text-align:center;opacity:.7">Bu güne ait randevu yok.<br><button onclick="openNewAppointmentModal()" style="margin-top:12px">+ Yeni Randevu Oluştur</button></div>`;
    return;
  }
  box.innerHTML = list.map(a => {
    const time = new Date(a.starts_at).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
    return `
      <div class="card" style="display:flex;justify-content:space-between;align-items:center;padding:12px;margin-bottom:8px">
        <div>
          <b>${a.customers?.full_name || 'Müşteri'}</b> • ${a.service_name} • ${time}
          <br><small style="opacity:.6">${a.notes || ''}</small>
        </div>
        <div style="display:flex;gap:6px;align-items:center">
          <span class="badge">${a.status}</span>
          <button onclick="updateAppointmentStatus('${a.id}','onaylandı')">Onayla</button>
          <button onclick="updateAppointmentStatus('${a.id}','iptal')">İptal</button>
          <button onclick="updateAppointmentStatus('${a.id}','gelmedi')">Yoklama</button>
        </div>
      </div>
    `;
  }).join('');
}

async function updateAppointmentStatus(id, status) {
  const { error } = await supabase.from('appointments').update({ status }).eq('id', id);
  if (error) return alert(error.message);
  loadAppointmentsForDay(currentDay);
}

function openNewAppointmentModal() {
  document.getElementById('new-appointment-modal').style.display = 'flex';
  // bugünün tarihini doldur
  const dInput = document.getElementById('appt-date');
  if (dInput && !dInput.value) dInput.value = toISODate(currentDay);
  loadCustomerDatalist();
}

function closeNewAppointmentModal() {
  document.getElementById('new-appointment-modal').style.display = 'none';
}

async function loadCustomerDatalist() {
  const list = document.getElementById('customer-list');
  if (!list) return;
  const { data } = await supabase.from('customers').select('full_name').eq('organization_id', ORG_ID).limit(50);
  if (data) list.innerHTML = data.map(c => `<option value="${c.full_name}">`).join('');
}

async function createAppointment() {
  const service_name = document.getElementById('appt-service').value.trim();
  const customerName = document.getElementById('appt-customer-name').value.trim();
  const date = document.getElementById('appt-date').value;
  const time = document.getElementById('appt-time').value;
  const notes = document.getElementById('appt-notes').value.trim();

  if (!customerName) return alert('Müşteri adını yazın - örn: Ayşe Yılmaz');
  if (!service_name) return alert('Hizmet yazın - örn: güzellik makyaj');
  if (!date || !time) return alert('Tarih ve saat seçin');

  // 1. müşteriyi bul veya oluştur
  let customer_id = null;
  const { data: existing } = await supabase
    .from('customers')
    .select('id')
    .eq('organization_id', ORG_ID)
    .ilike('full_name', customerName)
    .maybeSingle();

  if (existing) {
    customer_id = existing.id;
  } else {
    const { data: created, error: cErr } = await supabase
      .from('customers')
      .insert({ organization_id: ORG_ID, full_name: customerName })
      .select('id')
      .single();
    if (cErr) {
      console.error(cErr);
      return alert('Müşteri oluşturulamadı: ' + cErr.message + '\n\nSupabase SQL Editor de customers için GRANT yaptın mı?');
    }
    customer_id = created.id;
  }

  const starts_at = new Date(`${date}T${time}:00`).toISOString();
  const ends_at = new Date(new Date(starts_at).getTime() + 60 * 60 * 1000).toISOString(); // +1 saat

  const { error } = await supabase.from('appointments').insert({
    organization_id: ORG_ID,
    customer_id,
    service_name,
    starts_at,
    ends_at,
    notes,
    status: 'beklemede'
  });

  if (error) {
    console.error(error);
    return alert('Randevu oluşturulamadı: ' + error.message);
  }

  closeNewAppointmentModal();
  // inputları temizle
  document.getElementById('appt-customer-name').value = '';
  document.getElementById('appt-service').value = '';
  document.getElementById('appt-notes').value = '';

  await loadAppointmentsForDay(new Date(date));
}

function changeDay(offset) {
  const d = new Date(currentDay);
  d.setDate(d.getDate() + offset);
  loadAppointmentsForDay(d);
}

// global
window.loadAppointmentsForDay = loadAppointmentsForDay;
window.createAppointment = createAppointment;
window.updateAppointmentStatus = updateAppointmentStatus;
window.openNewAppointmentModal = openNewAppointmentModal;
window.closeNewAppointmentModal = closeNewAppointmentModal;
window.changeDay = changeDay;

// ilk yükleme
document.addEventListener('DOMContentLoaded', () => {
  if (document.getElementById('appointments-list')) {
    loadAppointmentsForDay(currentDay);
  }
});
