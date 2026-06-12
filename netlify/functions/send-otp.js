// netlify/functions/send-otp.js
//
// Generates a 6-digit OTP, stores it in Firestore with a 5-minute expiry,
// and emails it to the admin via Resend.
//
// ENV VARS NEEDED (set in Netlify dashboard → Site settings → Environment variables):
//   RESEND_API_KEY        — from resend.com (free tier, 100 emails/day)
//   ADMIN_EMAIL           — ssandco.rishabhrai@gmail.com
//   FIREBASE_SERVICE_KEY  — JSON string of Firebase service account (for Firestore admin access)
//
// NOTE: This uses Firebase Admin SDK to write the OTP to Firestore so the
// verify-otp function (a separate, stateless invocation) can read it back.

const admin = require('firebase-admin');

function getApp() {
  if (admin.apps.length) return admin.app();
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_KEY);
  return admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const app = getApp();
    const db = admin.firestore();

    // Generate 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = Date.now() + 5 * 60 * 1000; // 5 minutes

    // Store in Firestore (overwrites any previous pending OTP)
    await db.collection('tracker').doc('otp').set({ code: otp, expiresAt, used: false });

    // Send email via Resend
    const adminEmail = process.env.ADMIN_EMAIL;
    const resendKey = process.env.RESEND_API_KEY;

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resendKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'Compliance Tracker <onboarding@resend.dev>',
        to: [adminEmail],
        subject: 'Your Sync OTP — Sanket Salecha & Co.',
        html: `
          <div style="font-family:sans-serif;max-width:400px;margin:0 auto;padding:24px;border:1px solid #e2e8f0;border-radius:12px;">
            <h2 style="color:#1E3A5F;margin:0 0 8px;">🏛️ Compliance Tracker</h2>
            <p style="color:#64748B;font-size:13px;margin:0 0 20px;">Sanket Salecha &amp; Co.</p>
            <p style="font-size:14px;color:#374151;">Use this code to confirm syncing your data to Google Sheets:</p>
            <div style="font-size:32px;font-weight:800;letter-spacing:8px;color:#2563EB;text-align:center;padding:16px;background:#EFF6FF;border-radius:10px;margin:16px 0;">
              ${otp}
            </div>
            <p style="font-size:12px;color:#94A3B8;">This code expires in 5 minutes. If you didn't request this, you can ignore this email.</p>
          </div>
        `,
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error('Resend error:', errText);
      return { statusCode: 500, headers, body: JSON.stringify({ error: 'Failed to send email' }) };
    }

    return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};