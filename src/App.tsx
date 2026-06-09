import { useState, useEffect, useRef, useCallback } from 'react';
import { initializeApp, getApps } from 'firebase/app';
import {
  getFirestore,
  doc,
  onSnapshot,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import {
  getAuth,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
} from 'firebase/auth';

// ╔══════════════════════════════════════════════════════════════════╗
// ║  STEP 1: Paste YOUR Firebase config here                         ║
// ╚══════════════════════════════════════════════════════════════════╝
const firebaseConfig = {
  apiKey: 'AIzaSyAyGEBwflAMkadGHORcaHhHwq09rimQUdk',
  authDomain: 'compliance-tracker-fa4b5.firebaseapp.com',
  projectId: 'compliance-tracker-fa4b5',
  storageBucket: 'compliance-tracker-fa4b5.firebasestorage.app',
  messagingSenderId: '144181379155',
  appId: '1:144181379155:web:38b35cc158cf6d0eaf46a6',
};
// ═══════════════════════════════════════════════════════════════════

const fbApp = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
const db = getFirestore(fbApp);
const auth = getAuth(fbApp);

// ── Constants ─────────────────────────────────────────────────────────────
const FY_MONTHS = [
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
  'Jan',
  'Feb',
  'Mar',
];
const CURRENT_FY = 2026;
const GST_FILING_MONTH = PREVIOUS_MONTH[CURRENT_MONTH];
const PREVIOUS_MONTH = {
  Apr: "Mar",
  May: "Apr",
  Jun: "May",
  Jul: "Jun",
  Aug: "Jul",
  Sep: "Aug",
  Oct: "Sep",
  Nov: "Oct",
  Dec: "Nov",
  Jan: "Dec",
  Feb: "Jan",
  Mar: "Feb"
};
const STATUSES: Record<string, any> = {
  pending: {
    label: 'Pending',
    color: '#6B7280',
    bg: '#F9FAFB',
    border: '#E5E7EB',
    dot: '#CBD5E1',
  },
  in_progress: {
    label: 'In Progress',
    color: '#92400E',
    bg: '#FFFBEB',
    border: '#FCD34D',
    dot: '#F59E0B',
  },
  done: {
    label: 'Done',
    color: '#166534',
    bg: '#F0FDF4',
    border: '#86EFAC',
    dot: '#22C55E',
  },
  na: {
    label: 'N/A',
    color: '#9CA3AF',
    bg: '#F3F4F6',
    border: '#E5E7EB',
    dot: '#D1D5DB',
  },
};

const NEXT_M: Record<string, string> = {
  Apr: 'May',
  May: 'Jun',
  Jun: 'Jul',
  Jul: 'Aug',
  Aug: 'Sep',
  Sep: 'Oct',
  Oct: 'Nov',
  Nov: 'Dec',
  Dec: 'Jan',
  Jan: 'Feb',
  Feb: 'Mar',
  Mar: 'Apr',
};

// ── Your real client data ─────────────────────────────────────────────────
const DEFAULTS = {
  gstClients: [
    'Resonics AI',
    'Arion Analytics',
    'Swichh',
    'AR Healthcare',
    'Sanket Salecha & Co.',
  ],
  bookkeepingClients: ['Resonics AI', 'Arion Analytics', 'Swichh'],
  teamMembers: ['Rishabh'],
  bookkeepingTasks: [
    'Bank reconciliation',
    'Purchase entries',
    'Sales entries',
    'Expense entries',
    'Payroll entries',
    'Depreciation entry',
    'GST Reconciliation',
    'Month-end closing',
  ],
  adminEmails: ['ssandco.rishabhrai@gmail.com'], // ← STEP 2: Put Rishabh's login email here e.g. "ssandco.rishabhrai@gmail.com"
};

// ── Startup India clients ─────────────────────────────────────────────────
const STARTUP_CLIENTS = ['Resonics AI', 'Arion Analytics', 'Swichh'];
const PT_CLIENTS = ['Sanket Salecha & Co.'];

// ── Helpers ───────────────────────────────────────────────────────────────
function mkKey(fy: number, m: string) {
  const i = FY_MONTHS.indexOf(m);
  const yr = i <= 8 ? fy : fy + 1;
  const cm = [4, 5, 6, 7, 8, 9, 10, 11, 12, 1, 2, 3][i];
  return `${yr}-${String(cm).padStart(2, '0')}`;
}
const fyL = (fy: number) => `FY ${fy}-${String(fy + 1).slice(-2)}`;
const dc = (o: any) => JSON.parse(JSON.stringify(o));
const sanitizeKey = (n: string) =>
  n.replace(/\./g, '').replace(/\s+/g, '_').replace(/&/g, 'and');

function getDefaultPortals(clientName: string) {
  const base = [
    {
      id: 'gst',
      name: 'GST Portal',
      url: 'https://gst.gov.in',
      username: '',
      password: '',
      notes: '',
    },
    {
      id: 'it',
      name: 'Income Tax',
      url: 'https://incometax.gov.in',
      username: '',
      password: '',
      notes: '',
    },
    {
      id: 'mca',
      name: 'MCA Portal',
      url: 'https://mca.gov.in',
      username: '',
      password: '',
      notes: '',
    },
  ];
  if (STARTUP_CLIENTS.includes(clientName))
    base.push({
      id: 'startup',
      name: 'Startup India',
      url: 'https://startupindia.gov.in',
      username: '',
      password: '',
      notes: '',
    });
  if (PT_CLIENTS.includes(clientName))
    base.push({
      id: 'pt',
      name: 'Professional Tax',
      url: '',
      username: '',
      password: '',
      notes: '',
    });
  return base;
}

// ── Firebase helpers ──────────────────────────────────────────────────────
async function fbSaveSettings(data: any) {
  await setDoc(doc(db, 'tracker', 'settings'), data);
}
async function fbWriteGst(
  mk: string,
  client: string,
  filing: string,
  upd: any
) {
  const ref = doc(db, 'tracker', 'gst');
  const path = `${mk}.${client}.${filing}`;
  try {
    await updateDoc(ref, { [path]: upd });
  } catch {
    await setDoc(
      ref,
      { [mk]: { [client]: { [filing]: upd } } },
      { merge: true }
    );
  }
}
async function fbWriteBk(mk: string, client: string, task: string, upd: any) {
  const ref = doc(db, 'tracker', 'bk');
  const path = `${mk}.${client}.${task}`;
  try {
    await updateDoc(ref, { [path]: upd });
  } catch {
    await setDoc(ref, { [mk]: { [client]: { [task]: upd } } }, { merge: true });
  }
}
async function fbWriteVault(clientKey: string, data: any) {
  const ref = doc(db, 'tracker', 'vault');
  try {
    await updateDoc(ref, { [clientKey]: data });
  } catch {
    await setDoc(ref, { [clientKey]: data }, { merge: true });
  }
}

// ── Shared UI ─────────────────────────────────────────────────────────────
function Loader({ text = 'Loading…' }: { text?: string }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
        background: '#F8FAFC',
        flexDirection: 'column',
        gap: 14,
      }}
    >
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      <div
        style={{
          width: 34,
          height: 34,
          border: '3px solid #E2E8F0',
          borderTopColor: '#3B82F6',
          borderRadius: '50%',
          animation: 'spin .8s linear infinite',
        }}
      />
      <span style={{ color: '#94A3B8', fontSize: 13, fontWeight: 500 }}>
        {text}
      </span>
    </div>
  );
}
function Badge({ status, by, compact, onClick }: any) {
  const s = STATUSES[status] || STATUSES.pending;
  return (
    <button
      onClick={onClick}
      title="Click to update"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        padding: compact ? '3px 9px' : '5px 12px',
        borderRadius: 99,
        background: s.bg,
        color: s.color,
        border: `1.5px solid ${s.border}`,
        fontSize: compact ? 11 : 12,
        fontWeight: 600,
        cursor: 'pointer',
        whiteSpace: 'nowrap',
        fontFamily: 'inherit',
        outline: 'none',
      }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: '50%',
          background: s.dot,
          flexShrink: 0,
        }}
      />
      {s.label}
      {by && !compact && (
        <span style={{ opacity: 0.6, fontWeight: 400, fontSize: 10 }}>
          · {by}
        </span>
      )}
    </button>
  );
}
function Bar({ done, total, color = '#3B82F6', h = 6 }: any) {
  const pct = total ? (done / total) * 100 : 0;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div
        style={{
          flex: 1,
          height: h,
          background: '#E2E8F0',
          borderRadius: 99,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            height: '100%',
            width: `${pct}%`,
            background: color,
            borderRadius: 99,
            transition: 'width .4s ease',
          }}
        />
      </div>
      <span
        style={{
          fontSize: 11,
          color: '#94A3B8',
          minWidth: 34,
          textAlign: 'right',
          flexShrink: 0,
        }}
      >
        {done}/{total}
      </span>
    </div>
  );
}
function Empty({ emoji, title, sub }: any) {
  return (
    <div
      style={{
        textAlign: 'center',
        padding: '56px 24px',
        background: 'white',
        borderRadius: 16,
        border: '1.5px dashed #E2E8F0',
      }}
    >
      <div style={{ fontSize: 44, marginBottom: 12 }}>{emoji}</div>
      <div style={{ fontSize: 16, fontWeight: 700, color: '#374151' }}>
        {title}
      </div>
      <div style={{ fontSize: 13, color: '#94A3B8', marginTop: 4 }}>{sub}</div>
    </div>
  );
}

// ── Status Popover ────────────────────────────────────────────────────────
function Popover({ rect, status, by, teamMembers, onSave, onClose }: any) {
  const [st, setSt] = useState(status || 'pending');
  const [who, setWho] = useState(by || '');
  const ref = useRef<HTMLDivElement>(null);
  const needsWho = st === 'done' || st === 'in_progress';
  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const id = setTimeout(() => document.addEventListener('mousedown', h), 80);
    return () => {
      clearTimeout(id);
      document.removeEventListener('mousedown', h);
    };
  }, [onClose]);
  const left = Math.max(8, Math.min(rect.left, window.innerWidth - 248));
  const top =
    window.innerHeight - rect.bottom > 290
      ? rect.bottom + 6
      : Math.max(8, rect.top - 290);
  return (
    <div
      ref={ref}
      onClick={(e) => e.stopPropagation()}
      style={{
        position: 'fixed',
        top,
        left,
        zIndex: 9999,
        background: 'white',
        borderRadius: 14,
        boxShadow: '0 20px 48px rgba(0,0,0,0.18)',
        padding: 16,
        width: 236,
        border: '1px solid #E2E8F0',
      }}
    >
      <p
        style={{
          fontSize: 10,
          fontWeight: 700,
          color: '#94A3B8',
          letterSpacing: 1.2,
          margin: '0 0 10px',
        }}
      >
        UPDATE STATUS
      </p>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 5,
          marginBottom: needsWho ? 14 : 0,
        }}
      >
        {Object.entries(STATUSES).map(([k, s]: any) => (
          <button
            key={k}
            onClick={() => setSt(k)}
            style={{
              background: st === k ? s.bg : 'transparent',
              border: `1.5px solid ${st === k ? s.border : '#F1F5F9'}`,
              borderRadius: 9,
              padding: '8px 12px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              color: st === k ? s.color : '#374151',
              fontWeight: st === k ? 700 : 400,
              fontSize: 13,
              fontFamily: 'inherit',
            }}
          >
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: s.dot,
                flexShrink: 0,
              }}
            />
            {s.label}
          </button>
        ))}
      </div>
      {needsWho && (
        <div style={{ marginTop: 14 }}>
          <p
            style={{
              fontSize: 10,
              fontWeight: 700,
              color: '#94A3B8',
              letterSpacing: 1.2,
              margin: '0 0 6px',
            }}
          >
            DONE BY
          </p>
          <select
            value={who}
            onChange={(e) => setWho(e.target.value)}
            style={{
              width: '100%',
              padding: '8px 10px',
              borderRadius: 9,
              border: '1.5px solid #E2E8F0',
              fontSize: 13,
              fontFamily: 'inherit',
              background: 'white',
              cursor: 'pointer',
              outline: 'none',
            }}
          >
            <option value="">Select person…</option>
            {teamMembers.map((m: string) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </div>
      )}
      <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
        <button
          onClick={onClose}
          style={{
            flex: 1,
            padding: '8px',
            borderRadius: 9,
            border: '1.5px solid #E2E8F0',
            background: 'white',
            cursor: 'pointer',
            fontSize: 13,
            fontFamily: 'inherit',
            color: '#374151',
          }}
        >
          Cancel
        </button>
        <button
          onClick={() => {
            onSave({ status: st, by: who });
            onClose();
          }}
          style={{
            flex: 1,
            padding: '8px',
            borderRadius: 9,
            border: 'none',
            background: '#2563EB',
            color: 'white',
            cursor: 'pointer',
            fontSize: 13,
            fontWeight: 700,
            fontFamily: 'inherit',
          }}
        >
          Save
        </button>
      </div>
    </div>
  );
}

// ── Login Screen ──────────────────────────────────────────────────────────
function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const handleLogin = async () => {
    if (!email || !password) {
      setError('Please enter email and password.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      await signInWithEmailAndPassword(auth, email, password);
    } catch (e: any) {
      const msgs: Record<string, string> = {
        'auth/wrong-password': 'Incorrect password.',
        'auth/user-not-found': 'No account with this email.',
        'auth/invalid-email': 'Invalid email address.',
        'auth/too-many-requests': 'Too many attempts. Try again later.',
        'auth/invalid-credential': 'Incorrect email or password.',
      };
      setError(msgs[e.code] || 'Login failed. Please try again.');
    }
    setLoading(false);
  };
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        background: 'linear-gradient(135deg,#1E3A5F 0%,#2563EB 100%)',
      }}
    >
      <div
        style={{
          background: 'white',
          borderRadius: 20,
          padding: '40px 36px',
          width: 360,
          boxShadow: '0 24px 64px rgba(0,0,0,0.25)',
        }}
      >
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{ fontSize: 44, marginBottom: 12 }}>🏛️</div>
          <h1
            style={{
              margin: 0,
              fontSize: 22,
              fontWeight: 800,
              color: '#0F172A',
            }}
          >
            Compliance Tracker
          </h1>
          <p style={{ margin: '6px 0 0', color: '#64748B', fontSize: 13 }}>
            SS & Co. — Please sign in
          </p>
        </div>
        {error && (
          <div
            style={{
              background: '#FEF2F2',
              color: '#DC2626',
              padding: '10px 14px',
              borderRadius: 9,
              marginBottom: 16,
              fontSize: 13,
              border: '1px solid #FECACA',
            }}
          >
            {error}
          </div>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <label
              style={{
                fontSize: 11,
                fontWeight: 700,
                color: '#374151',
                marginBottom: 6,
                display: 'block',
                letterSpacing: 0.5,
              }}
            >
              EMAIL
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              style={{
                width: '100%',
                padding: '10px 14px',
                borderRadius: 9,
                border: '1.5px solid #E2E8F0',
                fontSize: 13,
                fontFamily: 'inherit',
                outline: 'none',
                boxSizing: 'border-box',
              }}
              onFocus={(e) => (e.target.style.borderColor = '#93C5FD')}
              onBlur={(e) => (e.target.style.borderColor = '#E2E8F0')}
            />
          </div>
          <div>
            <label
              style={{
                fontSize: 11,
                fontWeight: 700,
                color: '#374151',
                marginBottom: 6,
                display: 'block',
                letterSpacing: 0.5,
              }}
            >
              PASSWORD
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
              placeholder="••••••••"
              style={{
                width: '100%',
                padding: '10px 14px',
                borderRadius: 9,
                border: '1.5px solid #E2E8F0',
                fontSize: 13,
                fontFamily: 'inherit',
                outline: 'none',
                boxSizing: 'border-box',
              }}
              onFocus={(e) => (e.target.style.borderColor = '#93C5FD')}
              onBlur={(e) => (e.target.style.borderColor = '#E2E8F0')}
            />
          </div>
          <button
            onClick={handleLogin}
            disabled={loading}
            style={{
              padding: '12px',
              borderRadius: 10,
              border: 'none',
              background: loading ? '#93C5FD' : '#2563EB',
              color: 'white',
              fontWeight: 700,
              fontSize: 14,
              cursor: loading ? 'default' : 'pointer',
              fontFamily: 'inherit',
              marginTop: 4,
            }}
          >
            {loading ? 'Signing in…' : 'Sign In →'}
          </button>
        </div>
        <p
          style={{
            textAlign: 'center',
            fontSize: 11,
            color: '#CBD5E1',
            margin: '20px 0 0',
          }}
        >
          Contact your admin to get access
        </p>
      </div>
    </div>
  );
}

// ── Nav ───────────────────────────────────────────────────────────────────
function Nav({ tab, setTab, userEmail }: any) {
  const items = [
    { id: 'dashboard', icon: '📊', label: 'Dashboard' },
    { id: 'gst', icon: '📋', label: 'GST Filings' },
    { id: 'bookkeeping', icon: '📒', label: 'Bookkeeping' },
    { id: 'vault', icon: '🔐', label: 'Client Vault' },
    { id: 'settings', icon: '⚙️', label: 'Settings' },
  ];
  return (
    <nav
      style={{
        background: '#1E3A5F',
        display: 'flex',
        alignItems: 'stretch',
        padding: '0 16px',
        position: 'sticky',
        top: 0,
        zIndex: 100,
        boxShadow: '0 2px 12px rgba(0,0,0,0.25)',
        overflowX: 'auto',
      }}
    >
      <div
        style={{
          color: 'white',
          fontWeight: 800,
          fontSize: 14,
          marginRight: 'auto',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '0 16px 0 0',
          borderRight: '1px solid rgba(255,255,255,0.1)',
          flexShrink: 0,
        }}
      >
        <span style={{ fontSize: 22 }}>🏛️</span>
        <div>
          <div style={{ lineHeight: 1.2 }}>Compliance Tracker</div>
          <div
            style={{
              fontSize: 9,
              fontWeight: 400,
              opacity: 0.4,
              letterSpacing: 1,
            }}
          >
            SS &amp; CO.
          </div>
        </div>
      </div>
      {items.map((it) => (
        <button
          key={it.id}
          onClick={() => setTab(it.id)}
          style={{
            background:
              tab === it.id ? 'rgba(255,255,255,0.12)' : 'transparent',
            border: 'none',
            color: 'white',
            padding: '18px 14px 14px',
            cursor: 'pointer',
            fontSize: 12,
            fontWeight: tab === it.id ? 700 : 400,
            borderBottom:
              tab === it.id ? '3px solid #60A5FA' : '3px solid transparent',
            display: 'flex',
            alignItems: 'center',
            gap: 5,
            fontFamily: 'inherit',
            opacity: tab === it.id ? 1 : 0.65,
            flexShrink: 0,
          }}
        >
          {it.icon} {it.label}
        </button>
      ))}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          marginLeft: 8,
          borderLeft: '1px solid rgba(255,255,255,0.1)',
          paddingLeft: 12,
          flexShrink: 0,
        }}
      >
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.4)' }}>
            Signed in as
          </div>
          <div style={{ fontSize: 11, color: 'white', fontWeight: 600 }}>
            {userEmail?.split('@')[0]}
          </div>
        </div>
        <button
          onClick={() => signOut(auth)}
          style={{
            background: 'rgba(255,255,255,0.1)',
            border: 'none',
            color: 'white',
            borderRadius: 7,
            padding: '5px 9px',
            cursor: 'pointer',
            fontSize: 11,
            fontFamily: 'inherit',
          }}
        >
          Sign out
        </button>
      </div>
    </nav>
  );
}

// ── Month Bar ─────────────────────────────────────────────────────────────
function MonthBar({ month, setMonth, fy, setFy }: any) {
  return (
    <div
      style={{
        background: '#162d50',
        borderBottom: '1px solid rgba(255,255,255,0.07)',
        padding: '0 24px',
        display: 'flex',
        alignItems: 'center',
        overflowX: 'auto',
      }}
    >
      <select
        value={fy}
        onChange={(e) => setFy(Number(e.target.value))}
        style={{
          background: 'rgba(255,255,255,0.1)',
          color: 'white',
          border: '1px solid rgba(255,255,255,0.15)',
          borderRadius: 6,
          padding: '3px 8px',
          fontSize: 11,
          marginRight: 14,
          cursor: 'pointer',
          fontFamily: 'inherit',
          flexShrink: 0,
        }}
      >
        {[2024, 2025, 2026, 2027].map((y) => (
          <option key={y} value={y} style={{ background: '#162d50' }}>
            {fyL(y)}
          </option>
        ))}
      </select>
      {FY_MONTHS.map((m) => {
        const isCur = m === CURRENT_MONTH && fy === CURRENT_FY,
          isSel = m === month;
        return (
          <button
            key={m}
            onClick={() => setMonth(m)}
            style={{
              background: isSel ? 'rgba(255,255,255,0.12)' : 'transparent',
              border: 'none',
              color: 'white',
              padding: '10px 14px',
              cursor: 'pointer',
              fontSize: 12,
              fontWeight: isSel ? 700 : 400,
              borderBottom: isSel
                ? '2px solid #60A5FA'
                : '2px solid transparent',
              whiteSpace: 'nowrap',
              fontFamily: 'inherit',
              flexShrink: 0,
              opacity: isSel ? 1 : 0.55,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 5,
            }}
          >
            {m}
            {isCur && (
              <span
                style={{
                  background: '#EF4444',
                  borderRadius: 3,
                  padding: '1px 4px',
                  fontSize: 8,
                  fontWeight: 800,
                }}
              >
                NOW
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

// ── Dashboard ─────────────────────────────────────────────────────────────
function Dashboard({ settings, gstData, bkData, fy, onNavigate }: any) {
  const { gstClients, bookkeepingClients, bookkeepingTasks } = settings;
  const currMk = mkKey(fy, CURRENT_MONTH);
  const doneGst = gstClients.reduce(
    (a: number, c: string) =>
      a +
      ['GSTR-1', 'GSTR-3B'].filter(
        (f) => gstData[currMk]?.[c]?.[f]?.status === 'done'
      ).length,
    0
  );
  const totalGst = gstClients.length * 2;
  const doneBk = bookkeepingClients.reduce(
    (a: number, c: string) =>
      a +
      bookkeepingTasks.filter(
        (t: string) => bkData[currMk]?.[c]?.[t]?.status === 'done'
      ).length,
    0
  );
  const totalBk = bookkeepingClients.length * bookkeepingTasks.length;
  const gstCell = (client: string, m: string) => {
    const mk = mkKey(fy, m);
    const s1 = gstData[mk]?.[client]?.['GSTR-1']?.status || 'pending';
    const s3 = gstData[mk]?.[client]?.['GSTR-3B']?.status || 'pending';
    if (s1 === 'done' && s3 === 'done') return 'done';
    if (s1 === 'na' && s3 === 'na') return 'na';
    if (
      ['done', 'in_progress'].includes(s1) ||
      ['done', 'in_progress'].includes(s3)
    )
      return 'in_progress';
    return 'pending';
  };
  const bkProg = (client: string, m: string) => {
    const mk = mkKey(fy, m);
    return {
      done: bookkeepingTasks.filter(
        (t: string) => bkData[mk]?.[client]?.[t]?.status === 'done'
      ).length,
      total: bookkeepingTasks.length,
    };
  };
  const HeatCell = ({ status }: any) => {
    const s = STATUSES[status];
    const sym =
      status === 'done'
        ? '✓'
        : status === 'in_progress'
        ? '~'
        : status === 'na'
        ? '–'
        : '';
    return (
      <td style={{ padding: '4px 2px', textAlign: 'center' }}>
        <div
          title={s.label}
          style={{
            width: 20,
            height: 20,
            borderRadius: 4,
            margin: '0 auto',
            background: s.bg,
            border: `1px solid ${s.border}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 10,
            color: s.color,
            fontWeight: 700,
          }}
        >
          {sym}
        </div>
      </td>
    );
  };
  const cards = [
    {
      emoji: '🏢',
      val: gstClients.length,
      label: 'GST Clients',
      sub: 'Monthly filers',
      prog: null,
    },
    {
      emoji: '📚',
      val: bookkeepingClients.length,
      label: 'BK Clients',
      sub: 'Monthly closing',
      prog: null,
    },
    {
      emoji: '📋',
      val: doneGst,
      label: `GST Filings — ${CURRENT_MONTH}`,
      sub: null,
      prog: ['#2563EB', totalGst],
    },
    {
      emoji: '📒',
      val: doneBk,
      label: `BK Tasks — ${CURRENT_MONTH}`,
      sub: null,
      prog: ['#16A34A', totalBk],
    },
  ];
  return (
    <div style={{ paddingBottom: 40 }}>
      <div style={{ marginBottom: 24 }}>
        <h1
          style={{ margin: 0, fontSize: 24, fontWeight: 800, color: '#0F172A' }}
        >
          Overview
        </h1>
        <p style={{ margin: '4px 0 0', color: '#64748B', fontSize: 14 }}>
          {fyL(fy)} · Current month: {CURRENT_MONTH} 2026
        </p>
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))',
          gap: 14,
          marginBottom: 28,
        }}
      >
        {cards.map((c) => (
          <div
            key={c.label}
            style={{
              background: 'white',
              borderRadius: 14,
              padding: '18px 20px',
              border: '1px solid #E2E8F0',
              boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
            }}
          >
            <div style={{ fontSize: 24, marginBottom: 8 }}>{c.emoji}</div>
            {c.prog ? (
              <>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'baseline',
                    gap: 3,
                    marginBottom: 4,
                  }}
                >
                  <span
                    style={{
                      fontSize: 28,
                      fontWeight: 800,
                      color:
                        c.val === (c.prog as any)[1] ? '#166534' : '#1D4ED8',
                      lineHeight: 1,
                    }}
                  >
                    {c.val}
                  </span>
                  <span style={{ fontSize: 14, color: '#CBD5E1' }}>
                    /{(c.prog as any)[1]}
                  </span>
                </div>
                <div
                  style={{
                    fontSize: 13,
                    fontWeight: 600,
                    color: '#1E293B',
                    marginBottom: 8,
                  }}
                >
                  {c.label}
                </div>
                <Bar
                  done={c.val}
                  total={(c.prog as any)[1]}
                  color={(c.prog as any)[0]}
                />
              </>
            ) : (
              <>
                <div
                  style={{
                    fontSize: 28,
                    fontWeight: 800,
                    color: '#1E3A5F',
                    lineHeight: 1,
                  }}
                >
                  {c.val}
                </div>
                <div
                  style={{
                    fontSize: 13,
                    fontWeight: 600,
                    color: '#1E293B',
                    marginTop: 4,
                  }}
                >
                  {c.label}
                </div>
                <div style={{ fontSize: 11, color: '#94A3B8', marginTop: 2 }}>
                  {c.sub}
                </div>
              </>
            )}
          </div>
        ))}
      </div>
      <div
        style={{
          background: 'white',
          borderRadius: 14,
          padding: 24,
          border: '1px solid #E2E8F0',
          marginBottom: 18,
          boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 16,
          }}
        >
          <h2
            style={{
              margin: 0,
              fontSize: 15,
              fontWeight: 700,
              color: '#0F172A',
            }}
          >
            📋 GST Annual Status — {fyL(fy)}
          </h2>
          <button
            onClick={() => onNavigate('gst')}
            style={{
              background: '#EFF6FF',
              border: 'none',
              color: '#2563EB',
              borderRadius: 8,
              padding: '5px 12px',
              fontSize: 12,
              fontWeight: 700,
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            Open →
          </button>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table
            style={{ borderCollapse: 'collapse', fontSize: 12, width: '100%' }}
          >
            <thead>
              <tr>
                <th
                  style={{
                    textAlign: 'left',
                    padding: '4px 10px 8px',
                    color: '#94A3B8',
                    fontWeight: 600,
                    minWidth: 130,
                    fontSize: 11,
                  }}
                >
                  Client
                </th>
                {FY_MONTHS.map((m) => (
                  <th
                    key={m}
                    style={{
                      padding: '4px 2px 8px',
                      color: m === CURRENT_MONTH ? '#2563EB' : '#CBD5E1',
                      fontWeight: m === CURRENT_MONTH ? 700 : 500,
                      fontSize: 10,
                      textAlign: 'center',
                      minWidth: 24,
                    }}
                  >
                    {m}
                    {m === CURRENT_MONTH && (
                      <div
                        style={{
                          width: 3,
                          height: 3,
                          background: '#2563EB',
                          borderRadius: '50%',
                          margin: '2px auto 0',
                        }}
                      />
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {gstClients.map((c: string, i: number) => (
                <tr
                  key={c}
                  style={{ background: i % 2 === 0 ? 'white' : '#FAFAFA' }}
                >
                  <td
                    style={{
                      padding: '5px 10px',
                      fontWeight: 500,
                      color: '#1E293B',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      maxWidth: 150,
                      fontSize: 12,
                    }}
                  >
                    {c}
                  </td>
                  {FY_MONTHS.map((m) => (
                    <HeatCell key={m} status={gstCell(c, m)} />
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div
          style={{ display: 'flex', gap: 16, marginTop: 12, flexWrap: 'wrap' }}
        >
          {Object.entries(STATUSES).map(([k, s]: any) => (
            <span
              key={k}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                fontSize: 11,
                color: '#64748B',
              }}
            >
              <span
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: 3,
                  background: s.bg,
                  border: `1px solid ${s.border}`,
                  display: 'inline-block',
                }}
              />
              {s.label}
            </span>
          ))}
        </div>
      </div>
      {bookkeepingClients.length > 0 && (
        <div
          style={{
            background: 'white',
            borderRadius: 14,
            padding: 24,
            border: '1px solid #E2E8F0',
            boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: 16,
            }}
          >
            <h2
              style={{
                margin: 0,
                fontSize: 15,
                fontWeight: 700,
                color: '#0F172A',
              }}
            >
              📒 Bookkeeping Annual — {fyL(fy)}
            </h2>
            <button
              onClick={() => onNavigate('bookkeeping')}
              style={{
                background: '#F0FDF4',
                border: 'none',
                color: '#16A34A',
                borderRadius: 8,
                padding: '5px 12px',
                fontSize: 12,
                fontWeight: 700,
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              Open →
            </button>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table
              style={{
                borderCollapse: 'collapse',
                fontSize: 12,
                width: '100%',
              }}
            >
              <thead>
                <tr>
                  <th
                    style={{
                      textAlign: 'left',
                      padding: '4px 10px 8px',
                      color: '#94A3B8',
                      fontWeight: 600,
                      minWidth: 130,
                      fontSize: 11,
                    }}
                  >
                    Client
                  </th>
                  {FY_MONTHS.map((m) => (
                    <th
                      key={m}
                      style={{
                        padding: '4px 2px 8px',
                        color: m === CURRENT_MONTH ? '#16A34A' : '#CBD5E1',
                        fontWeight: m === CURRENT_MONTH ? 700 : 500,
                        fontSize: 10,
                        textAlign: 'center',
                        minWidth: 36,
                      }}
                    >
                      {m}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {bookkeepingClients.map((c: string, i: number) => (
                  <tr
                    key={c}
                    style={{ background: i % 2 === 0 ? 'white' : '#FAFAFA' }}
                  >
                    <td
                      style={{
                        padding: '5px 10px',
                        fontWeight: 500,
                        color: '#1E293B',
                        whiteSpace: 'nowrap',
                        fontSize: 12,
                      }}
                    >
                      {c}
                    </td>
                    {FY_MONTHS.map((m) => {
                      const { done, total } = bkProg(c, m);
                      const pct = total ? done / total : 0;
                      return (
                        <td
                          key={m}
                          style={{ padding: '4px 2px', textAlign: 'center' }}
                        >
                          <span
                            style={{
                              display: 'inline-block',
                              padding: '2px 5px',
                              borderRadius: 5,
                              background:
                                pct === 1
                                  ? '#F0FDF4'
                                  : pct > 0
                                  ? '#FFFBEB'
                                  : '#F9FAFB',
                              color:
                                pct === 1
                                  ? '#166534'
                                  : pct > 0
                                  ? '#92400E'
                                  : '#9CA3AF',
                              fontSize: 10,
                              fontWeight: 600,
                            }}
                          >
                            {done}/{total}
                          </span>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ── GST Tab ───────────────────────────────────────────────────────────────
function GSTTab({ settings, gstData, mk, month, setPopover }: any) {
  console.log('GST DATA', gstData);
  console.log('MK', mk);
  const { gstClients } = settings;
  const FILINGS = ['GSTR-1', 'GSTR-3B'];
  const getE = (c: string, f: string) => gstData[mk]?.[c]?.[f] || {};
  const openPicker = (e: any, client: string, filing: string) => {
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    const entry = getE(client, filing);
    setPopover({
      rect,
      status: entry.status || 'pending',
      by: entry.by || '',
      onSave: (u: any) => fbWriteGst(mk, client, filing, u),
    });
  };
  const doneCount = gstClients.reduce(
    (a: number, c: string) =>
      a + FILINGS.filter((f) => getE(c, f).status === 'done').length,
    0
  );
  const total = gstClients.length * FILINGS.length;
  return (
    <div>
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          marginBottom: 14,
          flexWrap: 'wrap',
          gap: 10,
        }}
      >
        <div>
          <h1
            style={{
              margin: 0,
              fontSize: 22,
              fontWeight: 800,
              color: '#0F172A',
            }}
          >
            GST Filings — {month}
          </h1>
          <p style={{ margin: '4px 0 0', color: '#64748B', fontSize: 13 }}>
            GSTR-1 due 11 {NEXT_M[month]} · GSTR-3B due 20 {NEXT_M[month]}
          </p>
        </div>
        <div
          style={{
            background: doneCount === total ? '#F0FDF4' : '#EFF6FF',
            border: `1px solid ${doneCount === total ? '#86EFAC' : '#BFDBFE'}`,
            borderRadius: 9,
            padding: '6px 14px',
            fontSize: 13,
            alignSelf: 'flex-start',
          }}
        >
          <span
            style={{
              fontWeight: 700,
              color: doneCount === total ? '#166534' : '#1D4ED8',
            }}
          >
            {doneCount}
          </span>
          <span style={{ color: '#64748B' }}> / {total} done</span>
        </div>
      </div>
      <div style={{ marginBottom: 22 }}>
        <Bar done={doneCount} total={total} color="#2563EB" h={8} />
      </div>
      {gstClients.length === 0 ? (
        <Empty emoji="📋" title="No GST clients" sub="Add in Settings" />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {gstClients.map((client: string, i: number) => {
            const allDone = FILINGS.every(
              (f) => getE(client, f).status === 'done'
            );
            const anyProg = FILINGS.some((f) =>
              ['done', 'in_progress'].includes(getE(client, f).status)
            );
            return (
              <div
                key={client}
                style={{
                  background: 'white',
                  borderRadius: 14,
                  padding: '16px 22px',
                  border: allDone ? '1.5px solid #86EFAC' : '1px solid #E2E8F0',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 14,
                  flexWrap: 'wrap',
                }}
              >
                <div
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: 10,
                    flexShrink: 0,
                    background: allDone
                      ? '#DCFCE7'
                      : anyProg
                      ? '#DBEAFE'
                      : '#F1F5F9',
                    color: allDone
                      ? '#166534'
                      : anyProg
                      ? '#1D4ED8'
                      : '#94A3B8',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 13,
                    fontWeight: 800,
                  }}
                >
                  {allDone ? '✓' : i + 1}
                </div>
                <div style={{ flex: 1, minWidth: 140 }}>
                  <div
                    style={{ fontWeight: 700, color: '#0F172A', fontSize: 14 }}
                  >
                    {client}
                  </div>
                  {allDone && (
                    <div
                      style={{ fontSize: 11, color: '#16A34A', marginTop: 1 }}
                    >
                      All filings complete ✓
                    </div>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
                  {FILINGS.map((f) => {
                    const e = getE(client, f);
                    return (
                      <div
                        key={f}
                        style={{
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 4,
                          alignItems: 'center',
                        }}
                      >
                        <span
                          style={{
                            fontSize: 10,
                            fontWeight: 700,
                            color: '#94A3B8',
                            letterSpacing: 0.5,
                          }}
                        >
                          {f}
                        </span>
                        <Badge
                          status={e.status || 'pending'}
                          by={e.by}
                          onClick={(ev: any) => openPicker(ev, client, f)}
                        />
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Bookkeeping Tab ───────────────────────────────────────────────────────
function BKTab({ settings, bkData, mk, month, setPopover }: any) {
  const { bookkeepingClients, bookkeepingTasks, teamMembers } = settings;
  const [expanded, setExpanded] = useState(() => new Set(bookkeepingClients));
  const [qc, setQc] = useState<any>(null);
  const [qWho, setQWho] = useState('');
  const getE = (c: string, t: string) => bkData[mk]?.[c]?.[t] || {};
  const openPicker = (e: any, client: string, task: string) => {
    e.stopPropagation();
    const entry = getE(client, task);
    const rect = e.currentTarget.getBoundingClientRect();
    setPopover({
      rect,
      status: entry.status || 'pending',
      by: entry.by || '',
      onSave: (u: any) => fbWriteBk(mk, client, task, u),
    });
  };
  const toggle = (c: string) =>
    setExpanded((p: any) => {
      const s = new Set(p);
      s.has(c) ? s.delete(c) : s.add(c);
      return s;
    });
  const markAll = (client: string, who: string) => {
    bookkeepingTasks.forEach((t: string) => {
      if (!['done', 'na'].includes(getE(client, t).status))
        fbWriteBk(mk, client, t, { status: 'done', by: who });
    });
    setQc(null);
    setQWho('');
  };
  const totalAll = bookkeepingClients.length * bookkeepingTasks.length;
  const doneAll = bookkeepingClients.reduce(
    (a: number, c: string) =>
      a +
      bookkeepingTasks.filter((t: string) => getE(c, t).status === 'done')
        .length,
    0
  );
  return (
    <div>
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          marginBottom: 14,
          flexWrap: 'wrap',
          gap: 10,
        }}
      >
        <div>
          <h1
            style={{
              margin: 0,
              fontSize: 22,
              fontWeight: 800,
              color: '#0F172A',
            }}
          >
            Bookkeeping Closing — {month}
          </h1>
          <p style={{ margin: '4px 0 0', color: '#64748B', fontSize: 13 }}>
            {bookkeepingTasks.length} tasks · {bookkeepingClients.length}{' '}
            clients
          </p>
        </div>
        <div
          style={{
            background: '#F0FDF4',
            border: '1px solid #86EFAC',
            borderRadius: 9,
            padding: '6px 14px',
            fontSize: 13,
            alignSelf: 'flex-start',
          }}
        >
          <span style={{ fontWeight: 700, color: '#166534' }}>{doneAll}</span>
          <span style={{ color: '#64748B' }}> / {totalAll} done</span>
        </div>
      </div>
      <div style={{ marginBottom: 22 }}>
        <Bar done={doneAll} total={totalAll} color="#16A34A" h={8} />
      </div>
      {bookkeepingClients.length === 0 ? (
        <Empty emoji="📒" title="No BK clients" sub="Add in Settings" />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {bookkeepingClients.map((client: string) => {
            const done = bookkeepingTasks.filter(
              (t: string) => getE(client, t).status === 'done'
            ).length;
            const total = bookkeepingTasks.length,
              allDone = done === total,
              isOpen = expanded.has(client);
            return (
              <div
                key={client}
                style={{
                  background: 'white',
                  borderRadius: 14,
                  border: allDone ? '1.5px solid #86EFAC' : '1px solid #E2E8F0',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    padding: '14px 20px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    cursor: 'pointer',
                    background: allDone ? '#F9FFFE' : 'white',
                    borderBottom: isOpen ? '1px solid #F1F5F9' : 'none',
                  }}
                  onClick={() => toggle(client)}
                >
                  <div
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: 11,
                      flexShrink: 0,
                      background: allDone ? '#DCFCE7' : '#EFF6FF',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 18,
                    }}
                  >
                    {allDone ? '✅' : '📒'}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontWeight: 700,
                        fontSize: 14,
                        color: '#0F172A',
                      }}
                    >
                      {client}
                    </div>
                    <div style={{ marginTop: 5 }}>
                      <Bar
                        done={done}
                        total={total}
                        color={allDone ? '#16A34A' : '#2563EB'}
                      />
                    </div>
                  </div>
                  {!allDone && (
                    <div onClick={(e) => e.stopPropagation()}>
                      {qc?.client === client ? (
                        <div
                          style={{
                            display: 'flex',
                            gap: 6,
                            alignItems: 'center',
                          }}
                        >
                          <select
                            value={qWho}
                            onChange={(e) => setQWho(e.target.value)}
                            style={{
                              padding: '5px 8px',
                              borderRadius: 7,
                              border: '1.5px solid #E2E8F0',
                              fontSize: 12,
                              fontFamily: 'inherit',
                            }}
                          >
                            <option value="">Who?</option>
                            {teamMembers.map((m: string) => (
                              <option key={m} value={m}>
                                {m}
                              </option>
                            ))}
                          </select>
                          <button
                            onClick={() => markAll(client, qWho)}
                            disabled={!qWho}
                            style={{
                              padding: '5px 10px',
                              borderRadius: 7,
                              border: 'none',
                              background: qWho ? '#16A34A' : '#E2E8F0',
                              color: qWho ? 'white' : '#9CA3AF',
                              fontSize: 11,
                              fontWeight: 700,
                              cursor: qWho ? 'pointer' : 'default',
                              fontFamily: 'inherit',
                            }}
                          >
                            Mark Done
                          </button>
                          <button
                            onClick={() => {
                              setQc(null);
                              setQWho('');
                            }}
                            style={{
                              padding: '4px 7px',
                              borderRadius: 7,
                              border: '1px solid #E2E8F0',
                              background: 'white',
                              fontSize: 13,
                              cursor: 'pointer',
                              color: '#64748B',
                              fontFamily: 'inherit',
                            }}
                          >
                            ✕
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => {
                            setQc({ client });
                            setQWho('');
                          }}
                          style={{
                            padding: '6px 12px',
                            borderRadius: 8,
                            border: '1.5px solid #E2E8F0',
                            background: 'white',
                            color: '#374151',
                            fontSize: 11,
                            fontWeight: 600,
                            cursor: 'pointer',
                            fontFamily: 'inherit',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          ⚡ Quick Close
                        </button>
                      )}
                    </div>
                  )}
                  <span
                    style={{
                      color: '#CBD5E1',
                      fontSize: 18,
                      flexShrink: 0,
                      display: 'inline-block',
                      transform: isOpen ? 'rotate(90deg)' : 'rotate(0)',
                      transition: 'transform .2s',
                    }}
                  >
                    ›
                  </span>
                </div>
                {isOpen && (
                  <div>
                    {bookkeepingTasks.map((task: string, ti: number) => {
                      const e = getE(client, task);
                      const isDone = e.status === 'done';
                      const isNA = e.status === 'na';
                      return (
                        <div
                          key={task}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 12,
                            padding: '10px 20px',
                            background: isDone
                              ? '#FAFFFE'
                              : ti % 2 === 0
                              ? 'white'
                              : '#FAFAFA',
                            borderBottom:
                              ti < bookkeepingTasks.length - 1
                                ? '1px solid #F8FAFC'
                                : 'none',
                          }}
                        >
                          <div
                            style={{
                              width: 20,
                              height: 20,
                              borderRadius: 6,
                              flexShrink: 0,
                              background: isDone
                                ? '#DCFCE7'
                                : isNA
                                ? '#F3F4F6'
                                : 'white',
                              border: `1.5px solid ${
                                isDone
                                  ? '#86EFAC'
                                  : isNA
                                  ? '#E5E7EB'
                                  : '#D1D5DB'
                              }`,
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              fontSize: 11,
                              color: '#166534',
                              fontWeight: 800,
                            }}
                          >
                            {isDone ? '✓' : ''}
                          </div>
                          <span
                            style={{
                              flex: 1,
                              fontSize: 13,
                              color: isDone || isNA ? '#94A3B8' : '#1E293B',
                              textDecoration:
                                isDone || isNA ? 'line-through' : 'none',
                              fontWeight: isDone || isNA ? 400 : 500,
                            }}
                          >
                            {task}
                          </span>
                          {e.by && (
                            <span
                              style={{
                                fontSize: 11,
                                color: '#CBD5E1',
                                flexShrink: 0,
                              }}
                            >
                              {e.by}
                            </span>
                          )}
                          <Badge
                            compact
                            status={e.status || 'pending'}
                            onClick={(ev: any) => openPicker(ev, client, task)}
                          />
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Client Vault Tab ──────────────────────────────────────────────────────
function ClientVaultTab({ settings, vaultData, isAdmin }: any) {
  const allClients = [
    ...new Set([...settings.gstClients, ...settings.bookkeepingClients]),
  ] as string[];
  const [selected, setSelected] = useState(allClients[0] || '');
  const [localData, setLocalData] = useState<any>(null);
  const [editContact, setEditContact] = useState(false);
  const [editPortals, setEditPortals] = useState(false);
  const [showPwd, setShowPwd] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState(false);
  const [addingPortal, setAddingPortal] = useState(false);
  const [newPortal, setNewPortal] = useState({
    name: '',
    url: '',
    username: '',
    password: '',
    notes: '',
  });
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    const key = sanitizeKey(selected);
    const existing = vaultData[key];
    if (existing) {
      setLocalData(dc(existing));
    } else {
      setLocalData({
        contact: {
          gstin: '',
          pan: '',
          contactPerson: '',
          phone: '',
          email: '',
        },
        portals: getDefaultPortals(selected),
      });
    }
    setEditContact(false);
    setEditPortals(false);
    setShowPwd({});
    setAddingPortal(false);
  }, [selected, vaultData]);

  const saveClient = async () => {
    setSaving(true);
    await fbWriteVault(sanitizeKey(selected), localData);
    setSaving(false);
    setSavedMsg(true);
    setTimeout(() => setSavedMsg(false), 2000);
    setEditContact(false);
    setEditPortals(false);
  };

  const togglePwd = (id: string) => setShowPwd((p) => ({ ...p, [id]: !p[id] }));

  const copyText = (text: string, id: string) => {
    navigator.clipboard.writeText(text).catch(() => {});
    setCopied(id);
    setTimeout(() => setCopied(null), 1500);
  };

  const updatePortal = (i: number, field: string, val: string) => {
    const portals = dc(localData.portals);
    portals[i][field] = val;
    setLocalData({ ...localData, portals });
  };

  const removePortal = (i: number) => {
    const portals = localData.portals.filter((_: any, j: number) => j !== i);
    setLocalData({ ...localData, portals });
  };

  const addPortal = () => {
    if (!newPortal.name.trim()) return;
    const portals = [
      ...localData.portals,
      { ...newPortal, id: Date.now().toString() },
    ];
    setLocalData({ ...localData, portals });
    setNewPortal({ name: '', url: '', username: '', password: '', notes: '' });
    setAddingPortal(false);
  };

  const inputStyle = {
    width: '100%',
    padding: '8px 12px',
    borderRadius: 8,
    border: '1.5px solid #E2E8F0',
    fontSize: 13,
    fontFamily: 'inherit',
    outline: 'none',
    background: 'white',
    boxSizing: 'border-box' as const,
  };
  const labelStyle = {
    fontSize: 10,
    fontWeight: 700 as const,
    color: '#94A3B8',
    letterSpacing: 0.8,
    marginBottom: 4,
    display: 'block' as const,
    textTransform: 'uppercase' as const,
  };
  const btnStyle = (color: string) => ({
    padding: '7px 14px',
    borderRadius: 8,
    border: 'none',
    background: color,
    color: 'white',
    fontWeight: 700 as const,
    fontSize: 12,
    cursor: 'pointer' as const,
    fontFamily: 'inherit',
  });

  if (!localData) return null;

  const contactFields = [
    { key: 'gstin', label: 'GSTIN' },
    { key: 'pan', label: 'PAN' },
    { key: 'contactPerson', label: 'Contact Person' },
    { key: 'phone', label: 'Phone' },
    { key: 'email', label: 'Email' },
  ];

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <h1
          style={{ margin: 0, fontSize: 22, fontWeight: 800, color: '#0F172A' }}
        >
          🔐 Client Vault
        </h1>
        <p style={{ margin: '4px 0 0', color: '#64748B', fontSize: 13 }}>
          Contact details & portal credentials · Synced & secured via Firebase
          {!isAdmin && ' · Contact admin to edit'}
        </p>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '220px 1fr',
          gap: 20,
          alignItems: 'start',
        }}
      >
        {/* Client list */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          {allClients.map((c) => {
            const hasData = !!vaultData[sanitizeKey(c)];
            return (
              <button
                key={c}
                onClick={() => setSelected(c)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '12px 14px',
                  borderRadius: 10,
                  background: selected === c ? '#1E3A5F' : 'white',
                  border:
                    selected === c
                      ? '1.5px solid #1E3A5F'
                      : '1px solid #E2E8F0',
                  color: selected === c ? 'white' : '#374151',
                  fontWeight: selected === c ? 700 : 500,
                  cursor: 'pointer',
                  fontSize: 13,
                  fontFamily: 'inherit',
                  textAlign: 'left',
                }}
              >
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    background: hasData
                      ? selected === c
                        ? '#86EFAC'
                        : '#22C55E'
                      : selected === c
                      ? 'rgba(255,255,255,0.3)'
                      : '#E2E8F0',
                    flexShrink: 0,
                  }}
                />
                {c}
              </button>
            );
          })}
          <p
            style={{
              fontSize: 10,
              color: '#CBD5E1',
              margin: '8px 0 0',
              textAlign: 'center',
              lineHeight: 1.4,
            }}
          >
            Green dot = details saved
          </p>
        </div>

        {/* Details panel */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Contact Details */}
          <div
            style={{
              background: 'white',
              borderRadius: 14,
              padding: 24,
              border: '1px solid #E2E8F0',
              boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: 20,
              }}
            >
              <h2
                style={{
                  margin: 0,
                  fontSize: 16,
                  fontWeight: 700,
                  color: '#0F172A',
                }}
              >
                👤 Contact Details
              </h2>
              {isAdmin && !editContact && (
                <button
                  onClick={() => setEditContact(true)}
                  style={btnStyle('#2563EB')}
                >
                  Edit
                </button>
              )}
              {isAdmin && editContact && (
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    onClick={() => {
                      setEditContact(false);
                    }}
                    style={{ ...btnStyle('#F1F5F9'), color: '#374151' }}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={saveClient}
                    style={btnStyle(saving ? '#93C5FD' : '#16A34A')}
                  >
                    {saving ? 'Saving…' : savedMsg ? '✓ Saved' : 'Save & Sync'}
                  </button>
                </div>
              )}
            </div>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: 16,
              }}
            >
              {contactFields.map((f) => (
                <div key={f.key}>
                  <label style={labelStyle}>{f.label}</label>
                  {editContact ? (
                    <input
                      value={localData.contact[f.key] || ''}
                      onChange={(e) =>
                        setLocalData({
                          ...localData,
                          contact: {
                            ...localData.contact,
                            [f.key]: e.target.value,
                          },
                        })
                      }
                      style={inputStyle}
                      onFocus={(e) => (e.target.style.borderColor = '#93C5FD')}
                      onBlur={(e) => (e.target.style.borderColor = '#E2E8F0')}
                    />
                  ) : (
                    <div
                      style={{
                        fontSize: 13,
                        color: localData.contact[f.key] ? '#1E293B' : '#CBD5E1',
                        fontWeight: localData.contact[f.key] ? 500 : 400,
                        padding: '8px 0',
                      }}
                    >
                      {localData.contact[f.key] || 'Not set'}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Portal Credentials */}
          <div
            style={{
              background: 'white',
              borderRadius: 14,
              padding: 24,
              border: '1px solid #E2E8F0',
              boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: 20,
              }}
            >
              <h2
                style={{
                  margin: 0,
                  fontSize: 16,
                  fontWeight: 700,
                  color: '#0F172A',
                }}
              >
                🔑 Portal Credentials
              </h2>
              {isAdmin && !editPortals && (
                <button
                  onClick={() => setEditPortals(true)}
                  style={btnStyle('#2563EB')}
                >
                  Edit
                </button>
              )}
              {isAdmin && editPortals && (
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    onClick={() => setEditPortals(false)}
                    style={{ ...btnStyle('#F1F5F9'), color: '#374151' }}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={saveClient}
                    style={btnStyle(saving ? '#93C5FD' : '#16A34A')}
                  >
                    {saving ? 'Saving…' : savedMsg ? '✓ Saved' : 'Save & Sync'}
                  </button>
                </div>
              )}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {localData.portals.map((portal: any, i: number) => (
                <div
                  key={portal.id || i}
                  style={{
                    padding: 16,
                    borderRadius: 12,
                    border: '1.5px solid #F1F5F9',
                    background: '#FAFAFA',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      marginBottom: 12,
                    }}
                  >
                    <div>
                      {editPortals ? (
                        <input
                          value={portal.name}
                          onChange={(e) =>
                            updatePortal(i, 'name', e.target.value)
                          }
                          style={{
                            ...inputStyle,
                            fontWeight: 700,
                            fontSize: 14,
                            width: 'auto',
                            minWidth: 160,
                          }}
                          onFocus={(e) =>
                            (e.target.style.borderColor = '#93C5FD')
                          }
                          onBlur={(e) =>
                            (e.target.style.borderColor = '#E2E8F0')
                          }
                        />
                      ) : (
                        <span
                          style={{
                            fontWeight: 700,
                            fontSize: 14,
                            color: '#0F172A',
                          }}
                        >
                          {portal.name}
                        </span>
                      )}
                      {portal.url && !editPortals && (
                        <div
                          style={{
                            fontSize: 11,
                            color: '#94A3B8',
                            marginTop: 2,
                          }}
                        >
                          {portal.url}
                        </div>
                      )}
                      {editPortals && (
                        <input
                          value={portal.url}
                          onChange={(e) =>
                            updatePortal(i, 'url', e.target.value)
                          }
                          placeholder="Portal URL"
                          style={{
                            ...inputStyle,
                            fontSize: 11,
                            marginTop: 6,
                            color: '#64748B',
                          }}
                          onFocus={(e) =>
                            (e.target.style.borderColor = '#93C5FD')
                          }
                          onBlur={(e) =>
                            (e.target.style.borderColor = '#E2E8F0')
                          }
                        />
                      )}
                    </div>
                    {editPortals && (
                      <button
                        onClick={() => removePortal(i)}
                        style={{
                          background: 'transparent',
                          border: 'none',
                          color: '#FCA5A5',
                          cursor: 'pointer',
                          fontSize: 20,
                          lineHeight: 1,
                        }}
                        onMouseEnter={(e) =>
                          (e.currentTarget.style.color = '#EF4444')
                        }
                        onMouseLeave={(e) =>
                          (e.currentTarget.style.color = '#FCA5A5')
                        }
                      >
                        ×
                      </button>
                    )}
                  </div>
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '1fr 1fr',
                      gap: 12,
                    }}
                  >
                    <div>
                      <label style={labelStyle}>Username / User ID</label>
                      {editPortals ? (
                        <input
                          value={portal.username || ''}
                          onChange={(e) =>
                            updatePortal(i, 'username', e.target.value)
                          }
                          placeholder="Username or email"
                          style={inputStyle}
                          onFocus={(e) =>
                            (e.target.style.borderColor = '#93C5FD')
                          }
                          onBlur={(e) =>
                            (e.target.style.borderColor = '#E2E8F0')
                          }
                        />
                      ) : (
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 6,
                          }}
                        >
                          <span
                            style={{
                              fontSize: 13,
                              color: portal.username ? '#1E293B' : '#CBD5E1',
                              flex: 1,
                            }}
                          >
                            {portal.username || 'Not set'}
                          </span>
                          {portal.username && (
                            <button
                              onClick={() =>
                                copyText(portal.username, `u_${portal.id || i}`)
                              }
                              title="Copy"
                              style={{
                                background:
                                  copied === `u_${portal.id || i}`
                                    ? '#DCFCE7'
                                    : '#F1F5F9',
                                border: 'none',
                                borderRadius: 6,
                                padding: '3px 7px',
                                cursor: 'pointer',
                                fontSize: 11,
                                color:
                                  copied === `u_${portal.id || i}`
                                    ? '#166534'
                                    : '#64748B',
                                fontFamily: 'inherit',
                              }}
                            >
                              {copied === `u_${portal.id || i}` ? '✓' : 'Copy'}
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                    <div>
                      <label style={labelStyle}>Password</label>
                      {editPortals ? (
                        <div
                          style={{
                            display: 'flex',
                            gap: 6,
                            alignItems: 'center',
                          }}
                        >
                          <input
                            type={
                              showPwd[`e_${portal.id || i}`]
                                ? 'text'
                                : 'password'
                            }
                            value={portal.password || ''}
                            onChange={(e) =>
                              updatePortal(i, 'password', e.target.value)
                            }
                            placeholder="Password"
                            style={{ ...inputStyle, flex: 1 }}
                            onFocus={(e) =>
                              (e.target.style.borderColor = '#93C5FD')
                            }
                            onBlur={(e) =>
                              (e.target.style.borderColor = '#E2E8F0')
                            }
                          />
                          <button
                            onClick={() => togglePwd(`e_${portal.id || i}`)}
                            style={{
                              background: '#F1F5F9',
                              border: '1px solid #E2E8F0',
                              borderRadius: 7,
                              padding: '7px 9px',
                              cursor: 'pointer',
                              fontSize: 13,
                              flexShrink: 0,
                            }}
                          >
                            👁
                          </button>
                        </div>
                      ) : (
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 6,
                          }}
                        >
                          <span
                            style={{
                              fontSize: 13,
                              color: portal.password ? '#1E293B' : '#CBD5E1',
                              flex: 1,
                              letterSpacing: showPwd[portal.id || i] ? 0 : 2,
                            }}
                          >
                            {portal.password
                              ? showPwd[portal.id || i]
                                ? portal.password
                                : '••••••••'
                              : 'Not set'}
                          </span>
                          {portal.password && (
                            <>
                              <button
                                onClick={() =>
                                  togglePwd(portal.id || String(i))
                                }
                                title={
                                  showPwd[portal.id || i] ? 'Hide' : 'Show'
                                }
                                style={{
                                  background: '#F1F5F9',
                                  border: 'none',
                                  borderRadius: 6,
                                  padding: '3px 7px',
                                  cursor: 'pointer',
                                  fontSize: 13,
                                }}
                              >
                                👁
                              </button>
                              <button
                                onClick={() =>
                                  copyText(
                                    portal.password,
                                    `p_${portal.id || i}`
                                  )
                                }
                                title="Copy password"
                                style={{
                                  background:
                                    copied === `p_${portal.id || i}`
                                      ? '#DCFCE7'
                                      : '#F1F5F9',
                                  border: 'none',
                                  borderRadius: 6,
                                  padding: '3px 7px',
                                  cursor: 'pointer',
                                  fontSize: 11,
                                  color:
                                    copied === `p_${portal.id || i}`
                                      ? '#166534'
                                      : '#64748B',
                                  fontFamily: 'inherit',
                                }}
                              >
                                {copied === `p_${portal.id || i}`
                                  ? '✓ Copied'
                                  : 'Copy'}
                              </button>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                  {(editPortals || portal.notes) && (
                    <div style={{ marginTop: 10 }}>
                      <label style={labelStyle}>Notes</label>
                      {editPortals ? (
                        <input
                          value={portal.notes || ''}
                          onChange={(e) =>
                            updatePortal(i, 'notes', e.target.value)
                          }
                          placeholder="Any additional notes…"
                          style={inputStyle}
                          onFocus={(e) =>
                            (e.target.style.borderColor = '#93C5FD')
                          }
                          onBlur={(e) =>
                            (e.target.style.borderColor = '#E2E8F0')
                          }
                        />
                      ) : (
                        <div style={{ fontSize: 12, color: '#64748B' }}>
                          {portal.notes}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}

              {/* Add portal */}
              {isAdmin &&
                editPortals &&
                (addingPortal ? (
                  <div
                    style={{
                      padding: 16,
                      borderRadius: 12,
                      border: '1.5px dashed #93C5FD',
                      background: '#EFF6FF',
                    }}
                  >
                    <p
                      style={{
                        margin: '0 0 12px',
                        fontSize: 13,
                        fontWeight: 700,
                        color: '#1D4ED8',
                      }}
                    >
                      New Portal
                    </p>
                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '1fr 1fr',
                        gap: 10,
                        marginBottom: 10,
                      }}
                    >
                      <div>
                        <label style={labelStyle}>Portal Name *</label>
                        <input
                          value={newPortal.name}
                          onChange={(e) =>
                            setNewPortal({ ...newPortal, name: e.target.value })
                          }
                          placeholder="e.g. Traces"
                          style={inputStyle}
                          onFocus={(e) =>
                            (e.target.style.borderColor = '#93C5FD')
                          }
                          onBlur={(e) =>
                            (e.target.style.borderColor = '#E2E8F0')
                          }
                        />
                      </div>
                      <div>
                        <label style={labelStyle}>URL</label>
                        <input
                          value={newPortal.url}
                          onChange={(e) =>
                            setNewPortal({ ...newPortal, url: e.target.value })
                          }
                          placeholder="https://..."
                          style={inputStyle}
                          onFocus={(e) =>
                            (e.target.style.borderColor = '#93C5FD')
                          }
                          onBlur={(e) =>
                            (e.target.style.borderColor = '#E2E8F0')
                          }
                        />
                      </div>
                      <div>
                        <label style={labelStyle}>Username</label>
                        <input
                          value={newPortal.username}
                          onChange={(e) =>
                            setNewPortal({
                              ...newPortal,
                              username: e.target.value,
                            })
                          }
                          style={inputStyle}
                          onFocus={(e) =>
                            (e.target.style.borderColor = '#93C5FD')
                          }
                          onBlur={(e) =>
                            (e.target.style.borderColor = '#E2E8F0')
                          }
                        />
                      </div>
                      <div>
                        <label style={labelStyle}>Password</label>
                        <input
                          value={newPortal.password}
                          onChange={(e) =>
                            setNewPortal({
                              ...newPortal,
                              password: e.target.value,
                            })
                          }
                          style={inputStyle}
                          onFocus={(e) =>
                            (e.target.style.borderColor = '#93C5FD')
                          }
                          onBlur={(e) =>
                            (e.target.style.borderColor = '#E2E8F0')
                          }
                        />
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button
                        onClick={() => setAddingPortal(false)}
                        style={{ ...btnStyle('#F1F5F9'), color: '#374151' }}
                      >
                        Cancel
                      </button>
                      <button onClick={addPortal} style={btnStyle('#2563EB')}>
                        Add Portal
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => setAddingPortal(true)}
                    style={{
                      padding: '12px',
                      borderRadius: 10,
                      border: '1.5px dashed #D1D5DB',
                      background: 'transparent',
                      color: '#64748B',
                      fontSize: 13,
                      cursor: 'pointer',
                      fontFamily: 'inherit',
                      width: '100%',
                    }}
                  >
                    + Add Portal
                  </button>
                ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Settings Panel ────────────────────────────────────────────────────────
function SettingsPanel({ settings, onSave }: any) {
  const [local, setLocal] = useState(() => dc(settings));
  const [active, setActive] = useState('gstClients');
  const [newVal, setNewVal] = useState<any>({});
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    setLocal(dc(settings));
  }, [settings]);
  const secs = [
    {
      id: 'gstClients',
      emoji: '🏢',
      label: 'GST Clients',
      desc: 'Clients for GSTR-1 & GSTR-3B monthly filings',
    },
    {
      id: 'bookkeepingClients',
      emoji: '📚',
      label: 'BK Clients',
      desc: 'Clients for monthly bookkeeping & closing',
    },
    {
      id: 'teamMembers',
      emoji: '👤',
      label: 'Team Members',
      desc: "Names shown in the 'Done by' dropdown",
    },
    {
      id: 'bookkeepingTasks',
      emoji: '✅',
      label: 'BK Tasks',
      desc: 'Monthly closing checklist for all BK clients',
    },
    {
      id: 'adminEmails',
      emoji: '🔐',
      label: 'Admin Emails',
      desc: 'Emails that can edit the Client Vault',
    },
  ];
  const remove = (k: string, i: number) =>
    setLocal((p: any) => ({
      ...p,
      [k]: p[k].filter((_: any, j: number) => j !== i),
    }));
  const add = (k: string) => {
    const v = (newVal[k] || '').trim();
    if (!v || local[k].includes(v)) return;
    setLocal((p: any) => ({ ...p, [k]: [...p[k], v] }));
    setNewVal((p: any) => ({ ...p, [k]: '' }));
  };
  const save = async () => {
    await onSave(local);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };
  const sec = secs.find((s) => s.id === active)!;
  return (
    <div>
      <div style={{ marginBottom: 22 }}>
        <h1
          style={{ margin: 0, fontSize: 22, fontWeight: 800, color: '#0F172A' }}
        >
          Settings
        </h1>
        <p style={{ margin: '4px 0 0', color: '#64748B', fontSize: 13 }}>
          Changes sync instantly to all team members.
        </p>
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '210px 1fr',
          gap: 18,
          alignItems: 'start',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          {secs.map((s) => (
            <button
              key={s.id}
              onClick={() => setActive(s.id)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '12px 14px',
                borderRadius: 10,
                background: active === s.id ? '#EFF6FF' : 'white',
                border:
                  active === s.id ? '1.5px solid #BFDBFE' : '1px solid #E2E8F0',
                color: active === s.id ? '#1E40AF' : '#374151',
                fontWeight: active === s.id ? 700 : 500,
                cursor: 'pointer',
                fontSize: 13,
                fontFamily: 'inherit',
                textAlign: 'left',
              }}
            >
              {s.emoji}
              <span style={{ flex: 1 }}>{s.label}</span>
              <span
                style={{
                  background: active === s.id ? '#DBEAFE' : '#F1F5F9',
                  color: active === s.id ? '#1E40AF' : '#64748B',
                  borderRadius: 10,
                  padding: '1px 7px',
                  fontSize: 11,
                  fontWeight: 700,
                }}
              >
                {local[s.id]?.length || 0}
              </span>
            </button>
          ))}
          <button
            onClick={save}
            style={{
              marginTop: 12,
              padding: '12px',
              borderRadius: 12,
              border: 'none',
              background: saved ? '#16A34A' : '#2563EB',
              color: 'white',
              fontWeight: 700,
              fontSize: 14,
              cursor: 'pointer',
              fontFamily: 'inherit',
              transition: 'background .3s',
            }}
          >
            {saved ? '✓ Saved & Synced!' : 'Save Changes'}
          </button>
        </div>
        <div
          style={{
            background: 'white',
            borderRadius: 14,
            padding: 22,
            border: '1px solid #E2E8F0',
            boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
          }}
        >
          <h2
            style={{
              margin: '0 0 4px',
              fontSize: 17,
              fontWeight: 800,
              color: '#0F172A',
            }}
          >
            {sec.emoji} {sec.label}
          </h2>
          <p style={{ margin: '0 0 20px', fontSize: 13, color: '#64748B' }}>
            {sec.desc}
          </p>
          {local[active]?.length === 0 ? (
            <div
              style={{
                textAlign: 'center',
                padding: '28px',
                background: '#F8FAFC',
                borderRadius: 12,
                border: '1px dashed #CBD5E1',
                marginBottom: 18,
                color: '#94A3B8',
              }}
            >
              <div style={{ fontSize: 30, marginBottom: 8 }}>{sec.emoji}</div>
              <div style={{ fontSize: 14, fontWeight: 600 }}>None yet</div>
            </div>
          ) : (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
                marginBottom: 18,
              }}
            >
              {local[active].map((item: string, i: number) => (
                <div
                  key={i}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '10px 14px',
                    borderRadius: 10,
                    border: '1px solid #F1F5F9',
                    background: '#FAFAFA',
                  }}
                >
                  <span
                    style={{
                      width: 24,
                      height: 24,
                      borderRadius: 7,
                      background: '#EFF6FF',
                      color: '#2563EB',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 11,
                      fontWeight: 800,
                      flexShrink: 0,
                    }}
                  >
                    {i + 1}
                  </span>
                  <span
                    style={{
                      flex: 1,
                      fontSize: 14,
                      color: '#1E293B',
                      fontWeight: 500,
                    }}
                  >
                    {item}
                  </span>
                  <button
                    onClick={() => remove(active, i)}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      color: '#FCA5A5',
                      cursor: 'pointer',
                      padding: '4px 6px',
                      borderRadius: 6,
                      fontSize: 18,
                      lineHeight: 1,
                      fontFamily: 'inherit',
                    }}
                    onMouseEnter={(e) =>
                      (e.currentTarget.style.color = '#EF4444')
                    }
                    onMouseLeave={(e) =>
                      (e.currentTarget.style.color = '#FCA5A5')
                    }
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              value={newVal[active] || ''}
              onChange={(e) =>
                setNewVal((p: any) => ({ ...p, [active]: e.target.value }))
              }
              onKeyDown={(e) => e.key === 'Enter' && add(active)}
              placeholder={`Add new ${sec.label
                .replace(/s$/, '')
                .toLowerCase()}…`}
              style={{
                flex: 1,
                padding: '10px 14px',
                borderRadius: 10,
                border: '1.5px solid #E2E8F0',
                fontSize: 13,
                fontFamily: 'inherit',
                outline: 'none',
                background: 'white',
              }}
              onFocus={(e) => (e.target.style.borderColor = '#93C5FD')}
              onBlur={(e) => (e.target.style.borderColor = '#E2E8F0')}
            />
            <button
              onClick={() => add(active)}
              style={{
                padding: '10px 18px',
                borderRadius: 10,
                border: 'none',
                background: '#2563EB',
                color: 'white',
                fontWeight: 700,
                fontSize: 13,
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              + Add
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Root App ──────────────────────────────────────────────────────────────
export default function App() {
  const [user, setUser] = useState<any>(undefined);
  const [tab, setTab] = useState('dashboard');
  const [settings, setSettings] = useState<any>(DEFAULTS);
  const [gstData, setGstData] = useState<any>({});
  const [bkData, setBkData] = useState<any>({});
  const [vaultData, setVaultData] = useState<any>({});
  const [month, setMonth] = useState(CURRENT_MONTH);
  const [fy, setFy] = useState(CURRENT_FY);
  const [dataReady, setDataReady] = useState(false);
  const [popover, setPopover] = useState<any>(null);

  // Auth
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => setUser(u));
    return unsub;
  }, []);

  // Firestore listeners
  useEffect(() => {
    if (!user) return;
    let count = 0;
    const check = () => {
      count++;
      if (count === 4) setDataReady(true);
    };
    const unsubS = onSnapshot(doc(db, 'tracker', 'settings'), (snap) => {
      if (snap.exists()) setSettings(snap.data());
      else setDoc(doc(db, 'tracker', 'settings'), DEFAULTS);
      check();
    });
    const unsubG = onSnapshot(doc(db, 'tracker', 'gst'), (snap) => {
      if (snap.exists()) setGstData(snap.data());
      else setGstData({});
      check();
    });
    const unsubB = onSnapshot(doc(db, 'tracker', 'bk'), (snap) => {
      if (snap.exists()) setBkData(snap.data());
      else setBkData({});
      check();
    });
    const unsubV = onSnapshot(doc(db, 'tracker', 'vault'), (snap) => {
      if (snap.exists()) setVaultData(snap.data());
      else setVaultData({});
      check();
    });
    return () => {
      unsubS();
      unsubG();
      unsubB();
      unsubV();
    };
  }, [user]);

  const closePopover = useCallback(() => setPopover(null), []);
  const mk = mkKey(fy, month);

  // Check if logged-in user is admin
  const isAdmin = !!(
    user &&
    settings.adminEmails &&
    settings.adminEmails.includes(user.email)
  );

  if (user === undefined) return <Loader text="Checking credentials…" />;
  if (!user) return <LoginScreen />;
  if (!dataReady) return <Loader text="Syncing data…" />;

  return (
    <div
      style={{
        fontFamily: 'system-ui,-apple-system,sans-serif',
        minHeight: '100vh',
        background: '#F8FAFC',
        fontSize: 14,
      }}
      onClick={closePopover}
    >
      <style>{`*{box-sizing:border-box} @keyframes spin{to{transform:rotate(360deg)}}`}</style>
      <Nav tab={tab} setTab={setTab} userEmail={user.email} />
      {(tab === 'gst' || tab === 'bookkeeping') && (
        <MonthBar month={month} setMonth={setMonth} fy={fy} setFy={setFy} />
      )}
      <div style={{ maxWidth: 1200, margin: '0 auto', padding: '28px 20px' }}>
        {tab === 'dashboard' && (
          <Dashboard
            settings={settings}
            gstData={gstData}
            bkData={bkData}
            fy={fy}
            onNavigate={(t: string) => setTab(t)}
          />
        )}
        {tab === 'gst' && (
          <GSTTab
            settings={settings}
            gstData={gstData}
            mk={mk}
            month={month}
            setPopover={setPopover}
          />
        )}
        {tab === 'bookkeeping' && (
          <BKTab
            settings={settings}
            bkData={bkData}
            mk={mk}
            month={month}
            setPopover={setPopover}
          />
        )}
        {tab === 'vault' && (
          <ClientVaultTab
            settings={settings}
            vaultData={vaultData}
            isAdmin={isAdmin}
          />
        )}
        {tab === 'settings' && (
          <SettingsPanel settings={settings} onSave={fbSaveSettings} />
        )}
      </div>
      {popover && (
        <Popover
          {...popover}
          teamMembers={settings.teamMembers}
          onClose={closePopover}
        />
      )}
    </div>
  );
}
