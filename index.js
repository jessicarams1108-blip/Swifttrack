const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const { v4: uuidv4 } = require('uuid');
const cors = require('cors');
const path = require('path');
const { Resend } = require('resend');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── Supabase ──
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
if (!supabaseUrl || !supabaseKey) {
  console.error('ERROR: SUPABASE_URL and SUPABASE_KEY are required.');
  process.exit(1);
}
const supabase = createClient(supabaseUrl, supabaseKey);

// ── Resend ──
const resend = new Resend(process.env.RESEND_API_KEY);

// ── App base URL for email links (set APP_URL in env for custom domain) ──
const APP_URL = (process.env.APP_URL || '').replace(/\/$/, '');

// ── Schema state ──
let hasEmailColumn = false;
let emailReady = false;

// ── Startup: detect schema ──
async function detectSchema() {
  console.log('Detecting Supabase schema…');

  // Insert a probe row that includes customer_email
  const probeId = 'PROBE-SCHEMA-CHECK';
  const probeResult = await supabase.from('shipments').insert([{
    id: uuidv4(),
    tracking_id: probeId,
    customer_name: '__probe__',
    status: '__probe__',
    location: '__probe__',
    customer_email: '__probe__@probe.internal',
    history: [],
    created_at: new Date().toISOString()
  }]);

  if (!probeResult.error) {
    hasEmailColumn = true;
    // Clean up probe row
    await supabase.from('shipments').delete().eq('tracking_id', probeId);
  } else if (probeResult.error.code === 'PGRST204') {
    hasEmailColumn = false;
    console.warn('⚠  customer_email column missing. Run this SQL in Supabase SQL Editor:');
    console.warn('   ALTER TABLE shipments ADD COLUMN IF NOT EXISTS customer_email TEXT;');
  } else {
    // Some other error — assume column exists (safe default)
    hasEmailColumn = true;
    // Still try to clean up just in case
    await supabase.from('shipments').delete().eq('tracking_id', probeId).catch(() => {});
  }

  emailReady = hasEmailColumn && !!process.env.RESEND_API_KEY;

  console.log(`  customer_email column : ${hasEmailColumn ? '✓ present' : '✗ missing'}`);
  console.log(`  email notifications   : ${emailReady ? '✓ active' : '✗ inactive'}`);
}

detectSchema().catch(e => console.error('Schema detection error:', e.message));

// ── Helpers ──
function generateTrackingId() {
  return 'TRK' + Math.floor(10000000 + Math.random() * 90000000);
}

function trackingLink(tracking_id) {
  return APP_URL ? `${APP_URL}/?id=${tracking_id}` : `/?id=${tracking_id}`;
}

async function sendCreatedEmail(to, { customer_name, tracking_id, status, location, date }) {
  if (!to || !emailReady) return;
  const link = trackingLink(tracking_id);
  try {
    await resend.emails.send({
      from: 'SwiftTrack <onboarding@resend.dev>',
      to,
      subject: '📦 Your Shipment Receipt — SwiftTrack',
      html: `
        <div style="font-family:Arial,sans-serif;max-width:580px;margin:0 auto;padding:24px;background:#f2f2f2;">
          <div style="background:#ffcc00;padding:16px 24px;border-radius:8px 8px 0 0;border-bottom:4px solid #d40511;">
            <h1 style="margin:0;color:#d40511;font-size:22px;">🚚 SwiftTrack</h1>
          </div>
          <div style="background:#fff;padding:24px;border-radius:0 0 8px 8px;box-shadow:0 2px 8px rgba(0,0,0,.08);">
            <h2 style="color:#1a1a1a;margin-top:0;">Shipment Receipt</h2>
            <p style="color:#444;">Hello <strong>${customer_name}</strong>,</p>
            <p style="color:#444;">Your shipment has been created and is ready to track.</p>
            <table style="width:100%;border-collapse:collapse;margin:16px 0;">
              <tr><td style="padding:8px 0;color:#888;width:140px;">Tracking ID</td><td style="padding:8px 0;font-weight:700;color:#1a1a1a;">${tracking_id}</td></tr>
              <tr><td style="padding:8px 0;color:#888;">Status</td><td style="padding:8px 0;color:#1a1a1a;">${status}</td></tr>
              <tr><td style="padding:8px 0;color:#888;">Location</td><td style="padding:8px 0;color:#1a1a1a;">${location}</td></tr>
              <tr><td style="padding:8px 0;color:#888;">Date</td><td style="padding:8px 0;color:#1a1a1a;">${new Date(date).toLocaleString('en-US', { month: 'long', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</td></tr>
            </table>
            <a href="${link}" style="display:inline-block;padding:12px 28px;background:#d40511;color:#fff;text-decoration:none;border-radius:6px;font-weight:700;font-size:14px;margin-top:8px;">Track Your Shipment →</a>
            <p style="color:#aaa;font-size:12px;margin-top:24px;">SwiftTrack Logistics · Fast. Reliable. Worldwide.</p>
          </div>
        </div>
      `
    });
    console.log('Creation email sent to', to);
  } catch (err) {
    console.error('Email error (non-fatal):', err.message);
  }
}

async function sendUpdateEmail(to, { customer_name, tracking_id, status, location, date }) {
  if (!to || !emailReady) return;
  const link = trackingLink(tracking_id);
  try {
    await resend.emails.send({
      from: 'SwiftTrack <onboarding@resend.dev>',
      to,
      subject: `🚚 Shipment Update: ${status} — SwiftTrack`,
      html: `
        <div style="font-family:Arial,sans-serif;max-width:580px;margin:0 auto;padding:24px;background:#f2f2f2;">
          <div style="background:#ffcc00;padding:16px 24px;border-radius:8px 8px 0 0;border-bottom:4px solid #d40511;">
            <h1 style="margin:0;color:#d40511;font-size:22px;">🚚 SwiftTrack</h1>
          </div>
          <div style="background:#fff;padding:24px;border-radius:0 0 8px 8px;box-shadow:0 2px 8px rgba(0,0,0,.08);">
            <h2 style="color:#1a1a1a;margin-top:0;">Shipment Update</h2>
            <p style="color:#444;">Hello <strong>${customer_name || 'Customer'}</strong>,</p>
            <p style="color:#444;">Your shipment status has been updated.</p>
            <table style="width:100%;border-collapse:collapse;margin:16px 0;">
              <tr><td style="padding:8px 0;color:#888;width:140px;">Tracking ID</td><td style="padding:8px 0;font-weight:700;color:#1a1a1a;">${tracking_id}</td></tr>
              <tr><td style="padding:8px 0;color:#888;">New Status</td><td style="padding:8px 0;font-weight:700;color:#d40511;">${status}</td></tr>
              <tr><td style="padding:8px 0;color:#888;">Location</td><td style="padding:8px 0;color:#1a1a1a;">${location}</td></tr>
              <tr><td style="padding:8px 0;color:#888;">Updated</td><td style="padding:8px 0;color:#1a1a1a;">${new Date(date).toLocaleString('en-US', { month: 'long', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</td></tr>
            </table>
            <a href="${link}" style="display:inline-block;padding:12px 28px;background:#d40511;color:#fff;text-decoration:none;border-radius:6px;font-weight:700;font-size:14px;margin-top:8px;">Track Your Shipment →</a>
            <p style="color:#aaa;font-size:12px;margin-top:24px;">SwiftTrack Logistics · Fast. Reliable. Worldwide.</p>
          </div>
        </div>
      `
    });
    console.log('Update email sent to', to);
  } catch (err) {
    console.error('Email error (non-fatal):', err.message);
  }
}

// ── Admin middleware ──
function requireAdmin(req, res, next) {
  const provided = req.headers['authorization'] || req.headers['x-admin-password'];
  const expected = process.env.ADMIN_PASSWORD;
  if (!provided || provided !== expected) {
    return res.status(401).json({ error: 'Unauthorized.' });
  }
  next();
}

// ────────────────────────────────────────────
// POST /create
// ────────────────────────────────────────────
app.post('/create', requireAdmin, async (req, res) => {
  console.log('POST /create body:', JSON.stringify(req.body));

  const { customer_name, location, customer_email, custom_date } = req.body;

  if (!customer_name || !location) {
    return res.status(400).json({ error: 'customer_name and location are required.' });
  }

  const tracking_id = generateTrackingId();
  const status = 'Order Placed';
  const now = custom_date ? new Date(custom_date).toISOString() : new Date().toISOString();

  const record = {
    id: uuidv4(),
    tracking_id,
    customer_name,
    status,
    location,
    history: [{ status, location, date: now }],
    created_at: now
  };

  if (hasEmailColumn) record.customer_email = customer_email || null;

  console.log('Inserting:', JSON.stringify(record));

  const { data, error } = await supabase
    .from('shipments')
    .insert([record])
    .select()
    .single();

  if (error) {
    console.error('Create error:', JSON.stringify(error));
    return res.status(500).json({ error: 'Failed to create shipment: ' + error.message });
  }

  console.log('Created shipment:', data.tracking_id);

  await sendCreatedEmail(customer_email, { customer_name, tracking_id, status, location, date: now });

  return res.status(201).json({
    message: 'Shipment created successfully.',
    tracking_id: data.tracking_id,
    shipment: data
  });
});

// ────────────────────────────────────────────
// GET /track/:id
// ────────────────────────────────────────────
app.get('/track/:id', async (req, res) => {
  const { id } = req.params;
  console.log('GET /track/' + id);

  const { data, error } = await supabase
    .from('shipments')
    .select('*')
    .eq('tracking_id', id.toUpperCase())
    .single();

  if (error || !data) {
    console.log('Not found:', id, error?.message);
    return res.status(404).json({ error: 'Tracking not found. Please check your tracking ID.' });
  }

  return res.json({ shipment: data });
});

// ────────────────────────────────────────────
// POST /update
// ────────────────────────────────────────────
app.post('/update', requireAdmin, async (req, res) => {
  console.log('POST /update body:', JSON.stringify(req.body));

  const { tracking_id, status, location, custom_date } = req.body;
  if (!tracking_id || !status || !location) {
    return res.status(400).json({ error: 'tracking_id, status, and location are required.' });
  }

  const { data: existing, error: fetchError } = await supabase
    .from('shipments')
    .select('*')
    .eq('tracking_id', tracking_id.toUpperCase())
    .single();

  if (fetchError || !existing) {
    return res.status(404).json({ error: 'Shipment not found.' });
  }

  const now = custom_date ? new Date(custom_date).toISOString() : new Date().toISOString();
  const updatedHistory = [...(existing.history || []), { status, location, date: now }];

  const { data, error } = await supabase
    .from('shipments')
    .update({ status, location, history: updatedHistory })
    .eq('tracking_id', tracking_id.toUpperCase())
    .select()
    .single();

  if (error) {
    console.error('Update error:', JSON.stringify(error));
    return res.status(500).json({ error: 'Failed to update shipment: ' + error.message });
  }

  console.log('Updated shipment:', tracking_id, '->', status);

  await sendUpdateEmail(existing.customer_email, {
    customer_name: existing.customer_name,
    tracking_id: tracking_id.toUpperCase(),
    status,
    location,
    date: now
  });

  return res.json({ message: 'Shipment updated successfully.', shipment: data });
});

// ── Schema status (admin only) ──
app.get('/api/schema-status', requireAdmin, (req, res) => {
  res.json({
    customer_email_column: hasEmailColumn,
    email_notifications_active: emailReady,
    migration_sql: hasEmailColumn ? null : 'ALTER TABLE shipments ADD COLUMN IF NOT EXISTS customer_email TEXT;'
  });
});

// ── Test email route (debug only) ──
app.get('/test-email', async (req, res) => {
  if (!process.env.RESEND_API_KEY) {
    return res.status(500).json({ error: 'RESEND_API_KEY is not set in environment variables.' });
  }
  const to = req.query.to || 'delivered@resend.dev';
  try {
    const response = await resend.emails.send({
      from: 'SwiftTrack <onboarding@resend.dev>',
      to,
      subject: '✅ SwiftTrack Email Test',
      html: '<div style="font-family:Arial;padding:24px;"><h2 style="color:#d40511;">Email is working! 🚚</h2><p>SwiftTrack Resend integration is active.</p></div>'
    });
    console.log('Test email response:', JSON.stringify(response));
    res.json({ success: true, to, resend_response: response });
  } catch (err) {
    console.error('Test email error:', err);
    res.status(500).json({ success: false, error: err.message, details: err });
  }
});

// ── Admin page ──
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`SwiftTrack server running on port ${PORT}`);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} already in use. Retrying in 2s…`);
    setTimeout(() => {
      server.close();
      server.listen(PORT, '0.0.0.0');
    }, 2000);
  } else {
    throw err;
  }
});
