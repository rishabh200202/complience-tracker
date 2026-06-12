// netlify/functions/verify-otp.js
//
// Checks the submitted OTP against the one stored in Firestore by send-otp.js.
// Marks it as used on success so it can't be replayed.

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
    const { otp } = JSON.parse(event.body || '{}');
    if (!otp || typeof otp !== 'string') {
      return { statusCode: 400, headers, body: JSON.stringify({ valid: false, error: 'Missing OTP' }) };
    }

    const app = getApp();
    const db = admin.firestore();
    const ref = db.collection('tracker').doc('otp');
    const snap = await ref.get();

    if (!snap.exists) {
      return { statusCode: 200, headers, body: JSON.stringify({ valid: false, error: 'No OTP requested' }) };
    }

    const data = snap.data();

    if (data.used) {
      return { statusCode: 200, headers, body: JSON.stringify({ valid: false, error: 'OTP already used' }) };
    }
    if (Date.now() > data.expiresAt) {
      return { statusCode: 200, headers, body: JSON.stringify({ valid: false, error: 'OTP expired' }) };
    }
    if (data.code !== otp.trim()) {
      return { statusCode: 200, headers, body: JSON.stringify({ valid: false, error: 'Incorrect OTP' }) };
    }

    // Mark as used so it can't be reused, and issue a short-lived sync token
    const syncToken = Math.random().toString(36).slice(2) + Date.now().toString(36);
    await ref.set({ ...data, used: true, syncToken, syncTokenExpiresAt: Date.now() + 2 * 60 * 1000 });

    return { statusCode: 200, headers, body: JSON.stringify({ valid: true, syncToken }) };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, headers, body: JSON.stringify({ valid: false, error: err.message }) };
  }
};