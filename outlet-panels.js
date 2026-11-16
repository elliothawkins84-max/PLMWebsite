// outlet-panels.html: build laser-marked outlet plates, list them in an
// order table, and request a quote. Uses the shared plate model/renderer
// (outlet-plate.js) and, from script.js, encodePlmjFile / RFQ_ENDPOINT /
// flagRfqField -- the same quote pipeline as the Round ID Tags page. The
// order goes to the Worker as a .plmj (app: 'outlet-panel-order') that PLM
// Job Viewer opens.
(function () {
  const P = window.OutletPlate;
  if (!P || !document.getElementById('outletPreview')) return;
  const $ = (id) => document.getElementById(id);
  // Plate text is all caps: uppercase it as it's typed (keeping the cursor
  // where it was).
  function forceCaps(input) {
    const upper = input.value.toUpperCase();
    if (upper === input.value) return;
    const { selectionStart, selectionEnd } = input;
    input.value = upper;
    try { input.setSelectionRange(selectionStart, selectionEnd); } catch (e) { /* not focused */ }
  }

  const GANG_OPTIONS = Object.keys(P.GANGS).map((g) => [g, P.GANGS[g].label]);
  const TYPE_OPTIONS = Object.keys(P.TYPES).map((t) => [t, P.TYPES[t].label]);
  const MATERIAL_OPTIONS = Object.keys(P.MATERIALS).map((m) => [m, P.MATERIALS[m].label]);
  const COLOR_OPTIONS = Object.keys(P.COLORS).map((c) => [c, P.COLORS[c].label]);

  // ---- Builder ----
  const state = { type: 'duplex', gang: 2, material: 'thermoset', color: 'white', text: '' };
  const preview = $('outletPreview');
  const textInput = $('outletTextInput');
  const fitWarning = $('outletFitWarning');
  const charCount = $('outletCharCount');
  const colorGroup = $('outletColorGroup');
  const markNote = $('outletMarkNote');

  function markSentence(material, color) {
    const mark = P.MARKS[P.markFor(material, color)].label.toLowerCase();
    return material === 'stainless' ? `Stainless steel is marked in ${mark}.` : `Marked in ${mark}.`;
  }
  function setChips(groupId, attr, value) {
    $(groupId).querySelectorAll('.chip').forEach((c) => c.classList.toggle('is-on', c.dataset[attr] === String(value)));
  }
  function renderBuilder() {
    const max = P.TEXT.maxChars[state.gang];
    textInput.maxLength = max;
    if (textInput.value.length > max) textInput.value = textInput.value.slice(0, max);
    state.text = textInput.value;
    preview.innerHTML = P.plateSVG(state, { placeholder: 'YOUR TEXT' });
    preview.dataset.gang = state.gang;
    const stainless = state.material === 'stainless';
    colorGroup.hidden = stainless;
    const group = P.TYPES[state.type].group;
    setChips('outletTypeChips', 'group', group);
    setChips('outletReceptacleChips', 'type', state.type);
    $('outletReceptacleGroup').hidden = group !== 'receptacle';
    $('outletBlankNote').hidden = state.type !== 'blank';
    markNote.textContent = markSentence(state.material, state.color);
    charCount.textContent = `— ${state.text.length}/${max}`;
    const fits = P.textFits(state.text.trim(), state.gang);
    fitWarning.hidden = fits;
    $('outletAddToOrderBtn').disabled = !fits;
  }
  // Plate type: Receptacle remembers whether it was single or duplex.
  let lastReceptacle = 'duplex';
  $('outletTypeChips').addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    state.type = chip.dataset.group === 'receptacle' ? lastReceptacle : chip.dataset.group;
    renderBuilder();
  });
  $('outletReceptacleChips').addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    state.type = lastReceptacle = chip.dataset.type;
    renderBuilder();
  });
  $('outletGangChips').addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    state.gang = Number(chip.dataset.gang);
    setChips('outletGangChips', 'gang', state.gang);
    renderBuilder();
  });
  $('outletMaterialChips').addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    state.material = chip.dataset.material;
    setChips('outletMaterialChips', 'material', state.material);
    renderBuilder();
  });
  $('outletColorChips').addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    state.color = chip.dataset.color;
    setChips('outletColorChips', 'color', state.color);
    renderBuilder();
  });
  textInput.addEventListener('input', () => { forceCaps(textInput); renderBuilder(); });

  // ---- Order table ----
  const orderBody = $('outletOrderBody');
  function optionsHTML(options, current) {
    return options.map(([v, l]) => `<option value="${v}"${String(v) === String(current) ? ' selected' : ''}>${l}</option>`).join('');
  }
  function rowItem(row) {
    const material = row.querySelector('.outlet-material-select').value;
    return {
      type: row.querySelector('.outlet-type-select').value,
      gang: Number(row.querySelector('.outlet-gang-select').value),
      material,
      color: material === 'stainless' ? null : row.querySelector('.outlet-color-select').value,
      text: P.caps(row.querySelector('.outlet-text-input').value).trim(),
      qty: Math.max(1, Math.round(Number(row.querySelector('.outlet-qty-input').value) || 1)),
    };
  }
  // Keeps a row's color/text fields in step with its plate and material:
  // stainless has no color choice, and the text limit follows the gang.
  function syncRow(row) {
    const item = rowItem(row);
    const colorSelect = row.querySelector('.outlet-color-select');
    const stainless = item.material === 'stainless';
    colorSelect.disabled = stainless;
    colorSelect.classList.toggle('is-na', stainless);
    row.querySelector('.outlet-color-na').hidden = !stainless;
    colorSelect.hidden = stainless;
    const text = row.querySelector('.outlet-text-input');
    text.maxLength = P.TEXT.maxChars[item.gang];
    if (text.value.length > text.maxLength) text.value = text.value.slice(0, text.maxLength);
    const fits = P.textFits(text.value.trim(), item.gang);
    text.classList.toggle('is-too-long', !fits);
    text.title = fits ? '' : 'Too long for this plate';
    row.querySelector('.outlet-mark-cell').textContent = `${P.MARKS[P.markFor(item.material, item.color || 'white')].label} mark`;
  }
  function renumber() {
    [...orderBody.querySelectorAll('.tag-order-row')].forEach((row, i) => { row.querySelector('.tag-order-num').textContent = i + 1; });
  }
  function addRow(initial) {
    const it = { type: 'duplex', gang: 2, material: 'thermoset', color: 'white', text: '', qty: 1, ...(initial || {}) };
    const row = document.createElement('tr');
    row.className = 'tag-order-row';
    row.innerHTML = `
      <td class="tag-order-num"></td>
      <td><select class="outlet-gang-select">${optionsHTML(GANG_OPTIONS, it.gang)}</select></td>
      <td><select class="outlet-type-select">${optionsHTML(TYPE_OPTIONS, it.type)}</select></td>
      <td><select class="outlet-material-select">${optionsHTML(MATERIAL_OPTIONS, it.material)}</select></td>
      <td>
        <select class="outlet-color-select">${optionsHTML(COLOR_OPTIONS, it.color || 'white')}</select>
        <span class="outlet-color-na" hidden>Stainless</span>
        <div class="outlet-mark-cell"></div>
      </td>
      <td class="tag-order-text-cell"><div class="tag-order-text-row"><input type="text" class="outlet-text-input" placeholder="Text" /></div></td>
      <td><input type="number" class="outlet-qty-input" min="1" step="1" value="${it.qty}" inputmode="numeric" /></td>
      <td><div class="tag-order-actions">
        <button type="button" class="tag-order-view" aria-label="View this plate in the builder above">View</button>
        <button type="button" class="tag-order-remove" aria-label="Remove this plate">✕</button>
      </div></td>`;
    row.querySelector('.outlet-text-input').value = P.caps(it.text);
    orderBody.appendChild(row);
    syncRow(row);
    renumber();
    return row;
  }
  orderBody.addEventListener('input', (e) => {
    const row = e.target.closest('.tag-order-row');
    if (!row) return;
    if (e.target.matches('.outlet-text-input')) forceCaps(e.target);
    syncRow(row);
  });
  orderBody.addEventListener('change', (e) => {
    const row = e.target.closest('.tag-order-row');
    if (!row) return;
    if (e.target.matches('.outlet-qty-input')) e.target.value = rowItem(row).qty;
    syncRow(row);
  });
  orderBody.addEventListener('click', (e) => {
    const row = e.target.closest('.tag-order-row');
    if (!row) return;
    if (e.target.closest('.tag-order-remove')) {
      if (orderBody.querySelectorAll('.tag-order-row').length <= 1) return;
      row.remove();
      renumber();
    } else if (e.target.closest('.tag-order-view')) {
      // Loads this row into the builder above (same as clicking its chips).
      const item = rowItem(row);
      state.type = item.type;
      if (P.TYPES[item.type].group === 'receptacle') lastReceptacle = item.type;
      $('outletGangChips').querySelector(`[data-gang="${item.gang}"]`).click();
      $('outletMaterialChips').querySelector(`[data-material="${item.material}"]`).click();
      if (item.color) $('outletColorChips').querySelector(`[data-color="${item.color}"]`).click();
      textInput.value = item.text;
      renderBuilder();
      const top = document.querySelector('.outlet-configurator').getBoundingClientRect().top + window.scrollY - 160;
      window.scrollTo({ top, behavior: 'smooth' });
    }
  });
  $('outletOrderAddRow').addEventListener('click', () => addRow());

  // "Add to Order List": the builder's plate into the table (taking over
  // an untouched blank row instead of adding another).
  const addBtn = $('outletAddToOrderBtn');
  const addLabel = addBtn.textContent;
  let addTimer = null;
  addBtn.addEventListener('click', () => {
    const item = { type: state.type, gang: state.gang, material: state.material, color: state.material === 'stainless' ? null : state.color, text: state.text.trim(), qty: 1 };
    const blank = [...orderBody.querySelectorAll('.tag-order-row')].find((r) => !r.querySelector('.outlet-text-input').value.trim());
    if (blank) {
      blank.querySelector('.outlet-type-select').value = item.type;
      blank.querySelector('.outlet-gang-select').value = item.gang;
      blank.querySelector('.outlet-material-select').value = item.material;
      if (item.color) blank.querySelector('.outlet-color-select').value = item.color;
      blank.querySelector('.outlet-text-input').value = item.text;
      syncRow(blank);
    } else {
      addRow(item);
    }
    clearTimeout(addTimer);
    addBtn.classList.add('is-added');
    addBtn.textContent = 'Added ✓';
    addBtn.disabled = true;
    addTimer = setTimeout(() => {
      addBtn.classList.remove('is-added');
      addBtn.textContent = addLabel;
      renderBuilder();
    }, 1800);
  });

  function collectItems() {
    return [...orderBody.querySelectorAll('.tag-order-row')].map((row) => {
      const item = rowItem(row);
      return { ...item, markColor: P.markFor(item.material, item.color) };
    });
  }
  function describe(item) {
    const parts = [P.GANGS[item.gang].label, P.TYPES[item.type].label, P.MATERIALS[item.material].short];
    if (item.material !== 'stainless') parts.push(P.COLORS[item.color].label);
    return `${parts.join(' · ')} (${P.MARKS[item.markColor].label.toLowerCase()} mark)`;
  }

  // ---- Request a quote ----
  const modal = $('outlet-rfq-modal');
  const successModal = $('outlet-rfq-success-modal');
  const form = $('outletRfqForm');
  const statusEl = $('outletRfqStatus');
  function renderSummary() {
    const groups = new Map();
    let total = 0;
    collectItems().forEach((item) => {
      const key = describe(item);
      groups.set(key, (groups.get(key) || 0) + item.qty);
      total += item.qty;
    });
    $('outletRfqSummaryList').innerHTML = [...groups].map(([label, n]) => `
      <div class="tag-rfq-summary-row"><span class="tag-rfq-summary-count">${n}</span><span class="tag-rfq-summary-dash">-</span><span>${label}</span></div>`).join('')
      + `<div class="tag-rfq-summary-row outlet-rfq-total"><span class="tag-rfq-summary-count">${total}</span><span class="tag-rfq-summary-dash">-</span><span>plate${total === 1 ? '' : 's'} total</span></div>`;
  }
  function openModal() {
    const tooLong = collectItems().some((it) => !P.textFits(it.text, it.gang));
    if (tooLong) {
      const bad = orderBody.querySelector('.outlet-text-input.is-too-long');
      if (bad) { bad.focus(); bad.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
      return;
    }
    renderSummary();
    modal.classList.add('is-open');
    modal.setAttribute('aria-hidden', 'false');
  }
  function closeModal() {
    modal.classList.remove('is-open');
    modal.setAttribute('aria-hidden', 'true');
  }
  function openSuccess() {
    closeModal();
    setTimeout(() => {
      const check = successModal.querySelector('.editor-rfq-success-check');
      if (check) { const parent = check.parentNode; const next = check.nextSibling; parent.removeChild(check); void check.offsetWidth; parent.insertBefore(check, next); }
      successModal.classList.add('is-open');
      successModal.setAttribute('aria-hidden', 'false');
    }, 300);
  }
  function closeSuccess() {
    successModal.classList.remove('is-open');
    successModal.setAttribute('aria-hidden', 'true');
  }
  $('outletQuoteBtn').addEventListener('click', openModal);
  $('outlet-rfq-modal-close').addEventListener('click', closeModal);
  modal.addEventListener('mousedown', (e) => { if (e.target === modal) closeModal(); });
  successModal.addEventListener('mousedown', (e) => { if (e.target === successModal) closeSuccess(); });
  $('outlet-rfq-success-close-btn').addEventListener('click', closeSuccess);
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (modal.classList.contains('is-open')) closeModal();
    if (successModal.classList.contains('is-open')) closeSuccess();
  });

  function buildPayload() {
    const fd = new FormData(form);
    return {
      app: 'outlet-panel-order',
      kind: 'plmj',
      version: 1,
      createdAt: new Date().toISOString(),
      specs: { plateHeightIn: P.PLATE_H_IN, textSizeIn: P.TEXT.sizeIn, placement: 'top center' },
      order: {
        name: fd.get('name') || '',
        email: fd.get('email') || '',
        address: fd.get('address') || '',
        city: fd.get('city') || '',
        state: fd.get('state') || '',
        zip: fd.get('zip') || '',
        discountCode: String(fd.get('discount') || '').trim(),
        message: fd.get('message') || '',
      },
      items: collectItems(),
    };
  }
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const submitBtn = form.querySelector('button[type="submit"]');
    const submitLabel = submitBtn.innerHTML;
    statusEl.textContent = '';
    statusEl.className = 'form-status';
    submitBtn.disabled = true;
    submitBtn.textContent = 'Sending…';
    try {
      const payload = buildPayload();
      const fd = new FormData(form);
      const total = payload.items.reduce((n, it) => n + it.qty, 0);
      const lines = payload.items.map((it, i) => `${i + 1}. ${it.qty} x ${describe(it)} — ${it.text || '(no text)'}`);
      const userMessage = String(fd.get('message') || '').trim();
      fd.set('message', [
        `${total} outlet plate${total === 1 ? '' : 's'} requested:`,
        ...lines,
        `Shipping address: ${payload.order.address || 'n/a'}, ${payload.order.city || 'n/a'}, ${payload.order.state || 'n/a'} ${payload.order.zip || 'n/a'}`,
      ].join('\n') + (userMessage ? `\n\n${userMessage}` : ''));
      const bytes = await encodePlmjFile(payload);
      const base = (payload.order.name || 'outlet-panels').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'outlet-panels';
      fd.append('attachment', new Blob([bytes], { type: 'application/octet-stream' }), `${base}-outlet-panels.plmj`);
      const res = await fetch(RFQ_ENDPOINT, { method: 'POST', body: fd });
      const data = await res.json();
      if (res.ok && data.success) {
        form.reset();
        openSuccess();
      } else {
        statusEl.textContent = data.message || 'Something went wrong — please try again.';
        statusEl.className = 'form-status error';
        if (typeof flagRfqField === 'function') flagRfqField(form, data);
      }
    } catch (err) {
      statusEl.textContent = 'Network error — please try again.';
      statusEl.className = 'form-status error';
    } finally {
      submitBtn.disabled = false;
      submitBtn.innerHTML = submitLabel;
    }
  });

  renderBuilder();
  addRow();
})();
