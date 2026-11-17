// The customer-information fields shared by the three order quote forms
// (card editor, Round ID Tags, outlet panels): name, company, email, phone,
// ship or pick up, and billing (same as shipping, or its own address).
// Each form has an empty <div data-rfq-contact></div> where these fields
// go, so all three stay identical. The values land in the .plmj's `order`
// under the same keys PLM Job Viewer uses for a custom job (company, phone,
// pickup, billSame, billAddress/City/State/Zip), and RfqContact.lines()
// spells them out for the email body. The Worker only reads name, email,
// message and discount, so it needs nothing new.
// The honeypot field is already named "company", so the real company
// field is "companyName".
(function () {
  const HTML = `
    <label>
      <span>Name</span>
      <input type="text" name="name" placeholder="Your name" autocomplete="name" required />
    </label>
    <label>
      <span>Company <em>— optional</em></span>
      <input type="text" name="companyName" placeholder="Company name" autocomplete="organization" maxlength="120" />
    </label>
    <div class="editor-next-modal-form-row rfq-contact-row">
      <label>
        <span>Email</span>
        <input type="email" name="email" placeholder="you@example.com" autocomplete="email" required />
      </label>
      <label>
        <span>Phone <em>— optional</em></span>
        <input type="tel" name="phone" placeholder="(555) 555-5555" autocomplete="tel" maxlength="40" />
      </label>
    </div>
    <div class="rfq-delivery" role="radiogroup" aria-label="Delivery">
      <span class="rfq-field-label">Delivery</span>
      <div class="rfq-delivery-options">
        <label class="rfq-choice"><input type="radio" name="delivery" value="ship" checked /> Ship it to me</label>
        <label class="rfq-choice"><input type="radio" name="delivery" value="pickup" /> I'll pick it up (Orange, CA)</label>
      </div>
    </div>
    <div class="rfq-ship-fields" data-rfq-ship>
      <label>
        <span>Shipping address <em>— for calculating shipping</em></span>
        <input type="text" name="address" placeholder="Street address" autocomplete="shipping street-address" required />
      </label>
      <div class="editor-next-modal-form-row">
        <label>
          <span>City</span>
          <input type="text" name="city" placeholder="City" autocomplete="shipping address-level2" required />
        </label>
        <label>
          <span>State</span>
          <input type="text" name="state" placeholder="State" autocomplete="shipping address-level1" required />
        </label>
        <label>
          <span>ZIP code</span>
          <input type="text" name="zip" placeholder="ZIP" inputmode="numeric" autocomplete="shipping postal-code" required />
        </label>
      </div>
      <label class="rfq-choice rfq-bill-same"><input type="checkbox" name="billSame" checked /> Billing address is the same as shipping</label>
    </div>
    <div class="rfq-bill-fields" data-rfq-bill hidden>
      <label>
        <span data-rfq-bill-label>Billing address</span>
        <input type="text" name="billAddress" placeholder="Street address" autocomplete="billing street-address" />
      </label>
      <div class="editor-next-modal-form-row">
        <label>
          <span>City</span>
          <input type="text" name="billCity" placeholder="City" autocomplete="billing address-level2" />
        </label>
        <label>
          <span>State</span>
          <input type="text" name="billState" placeholder="State" autocomplete="billing address-level1" />
        </label>
        <label>
          <span>ZIP code</span>
          <input type="text" name="billZip" placeholder="ZIP" inputmode="numeric" autocomplete="billing postal-code" />
        </label>
      </div>
    </div>`;

  // Shows/hides the shipping and billing fields for the current choices,
  // and makes only the visible, needed ones required.
  function sync(form) {
    const pickup = (form.querySelector('[name="delivery"]:checked') || {}).value === 'pickup';
    const sameBox = form.querySelector('[name="billSame"]');
    const ship = form.querySelector('[data-rfq-ship]');
    const bill = form.querySelector('[data-rfq-bill]');
    if (!ship || !bill) return;
    ship.hidden = pickup;
    ship.querySelectorAll('input[type="text"]').forEach((i) => { i.required = !pickup; });
    const showBill = pickup || !sameBox.checked;
    bill.hidden = !showBill;
    // Billing is optional for a pickup; required when it differs from
    // where it's shipping.
    const needBill = !pickup && !sameBox.checked;
    bill.querySelectorAll('input').forEach((i) => { i.required = needBill; });
    form.querySelector('[data-rfq-bill-label]').innerHTML = pickup ? 'Billing address <em>— optional</em>' : 'Billing address';
  }

  function mount(form) {
    const slot = form.querySelector('[data-rfq-contact]');
    if (!slot || slot.dataset.mounted) return;
    slot.innerHTML = HTML;
    slot.dataset.mounted = '1';
    form.addEventListener('change', (e) => {
      if (e.target.name === 'delivery' || e.target.name === 'billSame') sync(form);
    });
    form.addEventListener('reset', () => setTimeout(() => sync(form), 0));
    sync(form);
  }

  const str = (fd, k) => String(fd.get(k) || '').trim();
  // The order fields, from a FormData of the form.
  function read(fd) {
    const pickup = fd.get('delivery') === 'pickup';
    const billSame = !pickup && fd.get('billSame') != null;
    const ship = pickup ? { address: '', city: '', state: '', zip: '' } : { address: str(fd, 'address'), city: str(fd, 'city'), state: str(fd, 'state'), zip: str(fd, 'zip') };
    return {
      name: str(fd, 'name'),
      company: str(fd, 'companyName'),
      email: str(fd, 'email'),
      phone: str(fd, 'phone'),
      pickup,
      ...ship,
      billSame,
      billAddress: billSame ? ship.address : str(fd, 'billAddress'),
      billCity: billSame ? ship.city : str(fd, 'billCity'),
      billState: billSame ? ship.state : str(fd, 'billState'),
      billZip: billSame ? ship.zip : str(fd, 'billZip'),
    };
  }
  function addressText(a, c, s, z) {
    // "1 Main St, Anaheim, CA 92801"
    return [a, [[c, s].filter(Boolean).join(', '), z].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  }
  // Lines for the email body.
  function lines(o) {
    const out = [];
    if (o.company) out.push(`Company: ${o.company}`);
    if (o.phone) out.push(`Phone: ${o.phone}`);
    if (o.pickup) out.push('Delivery: customer pickup (Orange, CA)');
    else out.push(`Shipping address: ${addressText(o.address, o.city, o.state, o.zip) || 'n/a'}`);
    const bill = addressText(o.billAddress, o.billCity, o.billState, o.billZip);
    if (o.billSame) out.push('Billing address: same as shipping');
    else if (bill) out.push(`Billing address: ${bill}`);
    return out;
  }

  function mountAll() {
    document.querySelectorAll('form').forEach((f) => { if (f.querySelector('[data-rfq-contact]')) mount(f); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mountAll);
  else mountAll();

  window.RfqContact = { read, lines, mount, sync };
})();
