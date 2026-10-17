// One-off smoke test: verify the configured Resend key + From domain can
// deliver an office notification. Run with: node scripts/test-resend.mjs
import { readFileSync } from 'fs';
import { Resend } from 'resend';

const env = readFileSync(new URL('../.env', import.meta.url), 'utf8');
const key = env.match(/^RESEND_API_KEY=(.+)$/m)?.[1]?.trim();
const to = env.match(/^OFFICE_NOTIFY_EMAIL=(.+)$/m)?.[1]?.trim() || 'maliqueoilandgasltd@gmail.com';
if (!key) { console.error('RESEND_API_KEY not found in .env'); process.exit(1); }

const resend = new Resend(key);
try {
  const res = await resend.emails.send({
    from: 'Malique Oil & Gas <noreply@malique-oilgas.com>',
    to,
    subject: 'Notification system test — Malique Oil & Gas',
    html: '<h2>Email notifications are live</h2><p>This is a verification send from the Resend notification system wired into all portals.</p>',
  });
  console.log('SEND_OK', JSON.stringify(res));
} catch (err) {
  console.error('SEND_FAIL', err?.message ?? err);
  process.exit(1);
}
