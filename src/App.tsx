import { useState, useEffect, useRef, useCallback } from 'react';
import { initializeApp, getApps } from 'firebase/app';
import { getFirestore, doc, onSnapshot, setDoc, updateDoc } from 'firebase/firestore';
import { getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged } from 'firebase/auth';

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

const fbApp = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
const db    = getFirestore(fbApp);
const auth  = getAuth(fbApp);

// ── Constants ─────────────────────────────────────────────────────────────
const FY_MONTHS     = ["Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec","Jan","Feb","Mar"];
const CURRENT_FY    = 2026;
const CURRENT_MONTH = "Jun";   // current CALENDAR month

// GST filing period = previous calendar month
// e.g. working in Jun → filing May returns
const PREV_MONTH: Record<string,string> = {
  Apr:"Mar", May:"Apr", Jun:"May", Jul:"Jun", Aug:"Jul", Sep:"Aug",
  Oct:"Sep", Nov:"Oct", Dec:"Nov", Jan:"Dec", Feb:"Jan", Mar:"Feb"
};

const STATUSES: Record<string,any> = {
  pending:     { label:"Pending",     color:"#6B7280", bg:"#F9FAFB", border:"#E5E7EB", dot:"#CBD5E1" },
  in_progress: { label:"In Progress", color:"#92400E", bg:"#FFFBEB", border:"#FCD34D", dot:"#F59E0B" },
  done:        { label:"Done",        color:"#166534", bg:"#F0FDF4", border:"#86EFAC", dot:"#22C55E" },
  na:          { label:"N/A",         color:"#9CA3AF", bg:"#F3F4F6", border:"#E5E7EB", dot:"#D1D5DB" },
};

// ── Your real client data ─────────────────────────────────────────────────
const DEFAULTS = {
  gstClients:           ["Resonics AI","Arion Analytics","Swichh","AR Healthcare","Sanket Salecha & Co."],
  bookkeepingClients:   ["Resonics AI","Arion Analytics","Swichh"],
  teamMembers:          ["Rishabh"],
  bookkeepingTasks:     ["Bank reconciliation","Purchase entries","Sales entries","Expense entries","Payroll entries","Depreciation entry","GST Reconciliation","Month-end closing"],
};

// ── Helpers ───────────────────────────────────────────────────────────────
function mkKey(fy: number, m: string): string {
  const i  = FY_MONTHS.indexOf(m);
  const yr = i <= 8 ? fy : fy + 1;
  const cm = [4,5,6,7,8,9,10,11,12,1,2,3][i];
  return `${yr}-${String(cm).padStart(2,"0")}`;
}

/**
 * Returns the Firestore key for GST data given the calendar month being worked in.
 * Filing period = previous calendar month.
 * e.g. calendarMonth="Jun", fy=2026  →  "2026-05"  (May 2026 returns)
 * e.g. calendarMonth="Apr", fy=2026  →  "2026-03"  (Mar 2026 returns, prev FY)
 */
function gstFilingMk(fy: number, calendarMonth: string): string {
  const filingMonth = PREV_MONTH[calendarMonth];
  if (calendarMonth === "Apr") return mkKey(fy - 1, "Mar"); // crosses FY boundary
  return mkKey(fy, filingMonth);
}

/**
 * Human-readable label for the GST filing period.
 * e.g. calendarMonth="Jun", fy=2026  →  "May 2026"
 */
function gstFilingLabel(fy: number, calendarMonth: string): string {
  const filingMonth = PREV_MONTH[calendarMonth];
  if (calendarMonth === "Apr") return `Mar ${fy}`;
  const i  = FY_MONTHS.indexOf(filingMonth);
  const yr = i <= 8 ? fy : fy + 1;
  return `${filingMonth} ${yr}`;
}

const fyL         = (fy: number) => `FY ${fy}-${String(fy+1).slice(-2)}`;
const dc          = (o: any)    => JSON.parse(JSON.stringify(o));
// Tracker starts Jun 2026 — hide Apr & May for FY 2026
const getAvailableMonths = (fy: number): string[] =>
  fy === 2026 ? FY_MONTHS.slice(2) : FY_MONTHS; // slice(2) = Jun onwards


// ── Firebase write helpers ────────────────────────────────────────────────
async function fbSaveSettings(data: any) {
  await setDoc(doc(db,"tracker","settings"), data);
}
async function fbWriteGst(mk: string, client: string, filing: string, upd: any) {
  const ref = doc(db,"tracker","gst");
  try { await updateDoc(ref, {[`${mk}.${client}.${filing}`]:upd}); }
  catch { await setDoc(ref, {[mk]:{[client]:{[filing]:upd}}}, {merge:true}); }
}
async function fbWriteBk(mk: string, client: string, task: string, upd: any) {
  const ref = doc(db,"tracker","bk");
  try { await updateDoc(ref, {[`${mk}.${client}.${task}`]:upd}); }
  catch { await setDoc(ref, {[mk]:{[client]:{[task]:upd}}}, {merge:true}); }
}

// ── Shared UI ─────────────────────────────────────────────────────────────
function Loader({ text="Loading…" }: { text?: string }) {
  return (
    <div style={{display:"flex",alignItems:"center",justifyContent:"center",height:"100vh",background:"#F8FAFC",flexDirection:"column",gap:14}}>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      <div style={{width:34,height:34,border:"3px solid #E2E8F0",borderTopColor:"#3B82F6",borderRadius:"50%",animation:"spin .8s linear infinite"}}/>
      <span style={{color:"#94A3B8",fontSize:13,fontWeight:500}}>{text}</span>
    </div>
  );
}
function Badge({ status, by, compact, onClick }: any) {
  const s = STATUSES[status]||STATUSES.pending;
  return (
    <button onClick={onClick} title="Click to update" style={{display:"inline-flex",alignItems:"center",gap:5,padding:compact?"3px 9px":"5px 12px",borderRadius:99,background:s.bg,color:s.color,border:`1.5px solid ${s.border}`,fontSize:compact?11:12,fontWeight:600,cursor:"pointer",whiteSpace:"nowrap",fontFamily:"inherit",outline:"none"}}>
      <span style={{width:6,height:6,borderRadius:"50%",background:s.dot,flexShrink:0}}/>
      {s.label}
      {by&&!compact&&<span style={{opacity:.6,fontWeight:400,fontSize:10}}>· {by}</span>}
    </button>
  );
}
function Bar({ done, total, color="#3B82F6", h=6 }: any) {
  const pct = total?(done/total)*100:0;
  return (
    <div style={{display:"flex",alignItems:"center",gap:8}}>
      <div style={{flex:1,height:h,background:"#E2E8F0",borderRadius:99,overflow:"hidden"}}>
        <div style={{height:"100%",width:`${pct}%`,background:color,borderRadius:99,transition:"width .4s ease"}}/>
      </div>
      <span style={{fontSize:11,color:"#94A3B8",minWidth:34,textAlign:"right",flexShrink:0}}>{done}/{total}</span>
    </div>
  );
}
function Empty({ emoji, title, sub }: any) {
  return (
    <div style={{textAlign:"center",padding:"56px 24px",background:"white",borderRadius:16,border:"1.5px dashed #E2E8F0"}}>
      <div style={{fontSize:44,marginBottom:12}}>{emoji}</div>
      <div style={{fontSize:16,fontWeight:700,color:"#374151"}}>{title}</div>
      <div style={{fontSize:13,color:"#94A3B8",marginTop:4}}>{sub}</div>
    </div>
  );
}

// ── Status Popover ────────────────────────────────────────────────────────
function Popover({ rect, status, by, teamMembers, onSave, onClose }: any) {
  const [st, setSt]   = useState(status||"pending");
  const [who, setWho] = useState(by||"");
  const ref = useRef<HTMLDivElement>(null);
  const needsWho = st==="done"||st==="in_progress";
  useEffect(()=>{
    const h=(e:MouseEvent)=>{if(ref.current&&!ref.current.contains(e.target as Node))onClose();};
    const id=setTimeout(()=>document.addEventListener("mousedown",h),80);
    return()=>{clearTimeout(id);document.removeEventListener("mousedown",h);};
  },[onClose]);
  const left=Math.max(8,Math.min(rect.left,window.innerWidth-248));
  const top =window.innerHeight-rect.bottom>290?rect.bottom+6:Math.max(8,rect.top-290);
  return (
    <div ref={ref} onClick={(e)=>e.stopPropagation()} style={{position:"fixed",top,left,zIndex:9999,background:"white",borderRadius:14,boxShadow:"0 20px 48px rgba(0,0,0,0.18)",padding:16,width:236,border:"1px solid #E2E8F0"}}>
      <p style={{fontSize:10,fontWeight:700,color:"#94A3B8",letterSpacing:1.2,margin:"0 0 10px"}}>UPDATE STATUS</p>
      <div style={{display:"flex",flexDirection:"column",gap:5,marginBottom:needsWho?14:0}}>
        {Object.entries(STATUSES).map(([k,s]:any)=>(
          <button key={k} onClick={()=>setSt(k)} style={{background:st===k?s.bg:"transparent",border:`1.5px solid ${st===k?s.border:"#F1F5F9"}`,borderRadius:9,padding:"8px 12px",cursor:"pointer",display:"flex",alignItems:"center",gap:8,color:st===k?s.color:"#374151",fontWeight:st===k?700:400,fontSize:13,fontFamily:"inherit"}}>
            <span style={{width:8,height:8,borderRadius:"50%",background:s.dot,flexShrink:0}}/>{s.label}
          </button>
        ))}
      </div>
      {needsWho&&<div style={{marginTop:14}}>
        <p style={{fontSize:10,fontWeight:700,color:"#94A3B8",letterSpacing:1.2,margin:"0 0 6px"}}>DONE BY</p>
        <select value={who} onChange={(e)=>setWho(e.target.value)} style={{width:"100%",padding:"8px 10px",borderRadius:9,border:"1.5px solid #E2E8F0",fontSize:13,fontFamily:"inherit",background:"white",cursor:"pointer",outline:"none"}}>
          <option value="">Select person…</option>
          {teamMembers.map((m:string)=><option key={m} value={m}>{m}</option>)}
        </select>
      </div>}
      <div style={{display:"flex",gap:8,marginTop:14}}>
        <button onClick={onClose} style={{flex:1,padding:"8px",borderRadius:9,border:"1.5px solid #E2E8F0",background:"white",cursor:"pointer",fontSize:13,fontFamily:"inherit",color:"#374151"}}>Cancel</button>
        <button onClick={()=>{onSave({status:st,by:who});onClose();}} style={{flex:1,padding:"8px",borderRadius:9,border:"none",background:"#2563EB",color:"white",cursor:"pointer",fontSize:13,fontWeight:700,fontFamily:"inherit"}}>Save</button>
      </div>
    </div>
  );
}

// ── Login Screen ──────────────────────────────────────────────────────────
function LoginScreen() {
  const [email,setEmail]       = useState("");
  const [password,setPassword] = useState("");
  const [loading,setLoading]   = useState(false);
  const [error,setError]       = useState("");
  const handleLogin = async () => {
    if(!email||!password){setError("Please enter email and password.");return;}
    setLoading(true);setError("");
    try { await signInWithEmailAndPassword(auth,email,password); }
    catch(e:any){
      const msgs:Record<string,string>={
        "auth/wrong-password":"Incorrect password.",
        "auth/user-not-found":"No account with this email.",
        "auth/invalid-email":"Invalid email address.",
        "auth/too-many-requests":"Too many attempts. Try again later.",
        "auth/invalid-credential":"Incorrect email or password.",
      };
      setError(msgs[e.code]||"Login failed. Please try again.");
    }
    setLoading(false);
  };
  const inp = {width:"100%",padding:"10px 14px",borderRadius:9,border:"1.5px solid #E2E8F0",fontSize:13,fontFamily:"inherit",outline:"none",boxSizing:"border-box" as const};
  return (
    <div style={{display:"flex",alignItems:"center",justifyContent:"center",minHeight:"100vh",background:"linear-gradient(135deg,#1E3A5F 0%,#2563EB 100%)"}}>
      <div style={{background:"white",borderRadius:20,padding:"40px 36px",width:360,boxShadow:"0 24px 64px rgba(0,0,0,0.25)"}}>
        <div style={{textAlign:"center",marginBottom:32}}>
          <div style={{fontSize:44,marginBottom:12}}>🏛️</div>
          <h1 style={{margin:0,fontSize:22,fontWeight:800,color:"#0F172A"}}>Compliance Tracker</h1>
          <p style={{margin:"6px 0 0",color:"#64748B",fontSize:13}}>SS &amp; Co. — Please sign in</p>
        </div>
        {error&&<div style={{background:"#FEF2F2",color:"#DC2626",padding:"10px 14px",borderRadius:9,marginBottom:16,fontSize:13,border:"1px solid #FECACA"}}>{error}</div>}
        <div style={{display:"flex",flexDirection:"column",gap:14}}>
          <div>
            <label style={{fontSize:11,fontWeight:700,color:"#374151",marginBottom:6,display:"block",letterSpacing:.5}}>EMAIL</label>
            <input type="email" value={email} onChange={(e)=>setEmail(e.target.value)} placeholder="you@example.com" style={inp} onFocus={(e)=>e.target.style.borderColor="#93C5FD"} onBlur={(e)=>e.target.style.borderColor="#E2E8F0"}/>
          </div>
          <div>
            <label style={{fontSize:11,fontWeight:700,color:"#374151",marginBottom:6,display:"block",letterSpacing:.5}}>PASSWORD</label>
            <input type="password" value={password} onChange={(e)=>setPassword(e.target.value)} onKeyDown={(e)=>e.key==="Enter"&&handleLogin()} placeholder="••••••••" style={inp} onFocus={(e)=>e.target.style.borderColor="#93C5FD"} onBlur={(e)=>e.target.style.borderColor="#E2E8F0"}/>
          </div>
          <button onClick={handleLogin} disabled={loading} style={{padding:"12px",borderRadius:10,border:"none",background:loading?"#93C5FD":"#2563EB",color:"white",fontWeight:700,fontSize:14,cursor:loading?"default":"pointer",fontFamily:"inherit",marginTop:4}}>
            {loading?"Signing in…":"Sign In →"}
          </button>
        </div>
        <p style={{textAlign:"center",fontSize:11,color:"#CBD5E1",margin:"20px 0 0"}}>Contact your admin to get access</p>
      </div>
    </div>
  );
}

// ── Nav ───────────────────────────────────────────────────────────────────
function Nav({ tab, setTab, userEmail }: any) {
  const items = [
    {id:"dashboard",   icon:"📊",label:"Dashboard"},
    {id:"gst",         icon:"📋",label:"GST Filings"},
    {id:"bookkeeping", icon:"📒",label:"Bookkeeping"},
    {id:"settings",    icon:"⚙️",label:"Settings"},
  ];
  return (
    <nav style={{background:"#1E3A5F",display:"flex",alignItems:"stretch",padding:"0 16px",position:"sticky",top:0,zIndex:100,boxShadow:"0 2px 12px rgba(0,0,0,0.25)",overflowX:"auto"}}>
      <div style={{color:"white",fontWeight:800,fontSize:14,marginRight:"auto",display:"flex",alignItems:"center",gap:10,padding:"0 16px 0 0",borderRight:"1px solid rgba(255,255,255,0.1)",flexShrink:0}}>
        <span style={{fontSize:22}}>🏛️</span>
        <div>
          <div style={{lineHeight:1.2}}>Compliance Tracker</div>
          <div style={{fontSize:9,fontWeight:400,opacity:.4,letterSpacing:1}}>Sanket Salecha &amp; Co.</div>
        </div>
      </div>
      {items.map((it)=>(
        <button key={it.id} onClick={()=>setTab(it.id)} style={{background:tab===it.id?"rgba(255,255,255,0.12)":"transparent",border:"none",color:"white",padding:"18px 14px 14px",cursor:"pointer",fontSize:12,fontWeight:tab===it.id?700:400,borderBottom:tab===it.id?"3px solid #60A5FA":"3px solid transparent",display:"flex",alignItems:"center",gap:5,fontFamily:"inherit",opacity:tab===it.id?1:0.65,flexShrink:0}}>
          {it.icon} {it.label}
        </button>
      ))}
      <div style={{display:"flex",alignItems:"center",gap:8,marginLeft:8,borderLeft:"1px solid rgba(255,255,255,0.1)",paddingLeft:12,flexShrink:0}}>
        <div style={{textAlign:"right"}}>
          <div style={{fontSize:9,color:"rgba(255,255,255,0.4)"}}>Signed in as</div>
          <div style={{fontSize:11,color:"white",fontWeight:600}}>{userEmail?.split("@")[0]}</div>
        </div>
        <button onClick={()=>signOut(auth)} style={{background:"rgba(255,255,255,0.1)",border:"none",color:"white",borderRadius:7,padding:"5px 9px",cursor:"pointer",fontSize:11,fontFamily:"inherit"}}>Sign out</button>
      </div>
    </nav>
  );
}

// ── Month Bar ─────────────────────────────────────────────────────────────
function MonthBar({ month, setMonth, fy, setFy }: any) {
  return (
    <div style={{background:"#162d50",borderBottom:"1px solid rgba(255,255,255,0.07)",padding:"0 24px",display:"flex",alignItems:"center",overflowX:"auto"}}>
      <select value={fy} onChange={(e)=>setFy(Number(e.target.value))} style={{background:"rgba(255,255,255,0.1)",color:"white",border:"1px solid rgba(255,255,255,0.15)",borderRadius:6,padding:"3px 8px",fontSize:11,marginRight:14,cursor:"pointer",fontFamily:"inherit",flexShrink:0}}>
        {[2026,2027,2028,2029,2030].map((y)=><option key={y} value={y} style={{background:"#162d50"}}>{fyL(y)}</option>)}
      </select>
      {getAvailableMonths(fy).map((m)=>{
        const isCur=m===CURRENT_MONTH&&fy===CURRENT_FY, isSel=m===month;
        return (
          <button key={m} onClick={()=>setMonth(m)} style={{background:isSel?"rgba(255,255,255,0.12)":"transparent",border:"none",color:"white",padding:"10px 14px",cursor:"pointer",fontSize:12,fontWeight:isSel?700:400,borderBottom:isSel?"2px solid #60A5FA":"2px solid transparent",whiteSpace:"nowrap",fontFamily:"inherit",flexShrink:0,opacity:isSel?1:0.55,display:"inline-flex",alignItems:"center",gap:5}}>
            {m}{isCur&&<span style={{background:"#EF4444",borderRadius:3,padding:"1px 4px",fontSize:8,fontWeight:800}}>NOW</span>}
          </button>
        );
      })}
    </div>
  );
}

// ── Sync to Google Sheet Modal (OTP flow) ────────────────────────────────
function SyncModal({ onClose }: any) {
  const [step, setStep] = useState<'confirm'|'otp'|'syncing'|'done'|'error'>('confirm');
  const [otp, setOtp] = useState('');
  const [error, setError] = useState('');
  const [rowsUpdated, setRowsUpdated] = useState(0);

  const sendOtp = async () => {
    setStep('otp'); setError('');
    try {
      const res = await fetch('/.netlify/functions/send-otp', { method:'POST' });
      if(!res.ok) throw new Error('Failed to send OTP');
    } catch(e:any) { setError(e.message); setStep('confirm'); }
  };

  const verifyAndSync = async () => {
    if(!otp.trim()) { setError('Enter the OTP sent to your email.'); return; }
    setStep('syncing'); setError('');
    try {
      const vRes = await fetch('/.netlify/functions/verify-otp', {
        method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({otp:otp.trim()})
      });
      const vData = await vRes.json();
      if(!vData.valid) { setError(vData.error||'Invalid OTP'); setStep('otp'); return; }

      const sRes = await fetch('/.netlify/functions/sync-to-sheet', {
        method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({syncToken:vData.syncToken})
      });
      const sData = await sRes.json();
      if(!sRes.ok) throw new Error(sData.error||'Sync failed');
      setRowsUpdated(sData.rowsUpdated||0);
      setStep('done');
    } catch(e:any) { setError(e.message); setStep('otp'); }
  };

  const inp = {width:'100%',padding:'12px 14px',borderRadius:10,border:'1.5px solid #E2E8F0',fontSize:18,fontFamily:'inherit',outline:'none',textAlign:'center' as const,letterSpacing:8,fontWeight:800 as const,boxSizing:'border-box' as const};
  const btnPrimary = {flex:1,padding:'11px',borderRadius:10,border:'none',background:'#2563EB',color:'white',fontWeight:700 as const,fontSize:13,cursor:'pointer' as const,fontFamily:'inherit'};
  const btnGhost   = {flex:1,padding:'11px',borderRadius:10,border:'1.5px solid #E2E8F0',background:'white',color:'#374151',fontWeight:600 as const,fontSize:13,cursor:'pointer' as const,fontFamily:'inherit'};

  return (
    <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.5)',zIndex:9999,display:'flex',alignItems:'center',justifyContent:'center'}} onClick={step==='syncing'?undefined:onClose}>
      <div style={{background:'white',borderRadius:16,padding:32,width:420,boxShadow:'0 24px 64px rgba(0,0,0,0.25)'}} onClick={e=>e.stopPropagation()}>

        {step==='confirm' && (<>
          <div style={{display:'flex',alignItems:'center',gap:12,marginBottom:6}}>
            <span style={{fontSize:28}}>🔄</span>
            <h2 style={{margin:0,fontSize:18,fontWeight:800,color:'#0F172A'}}>Push to Google Sheet</h2>
          </div>
          <p style={{margin:'0 0 20px',color:'#64748B',fontSize:13}}>This will overwrite GST Filings and Bookkeeping data in your Google Sheet with the current data from this tracker. A one-time code will be sent to your email to confirm.</p>
          {error && <div style={{background:'#FEF2F2',color:'#DC2626',padding:'10px 14px',borderRadius:9,marginBottom:16,fontSize:13,border:'1px solid #FECACA'}}>{error}</div>}
          <div style={{display:'flex',gap:10}}>
            <button onClick={onClose} style={btnGhost}>Cancel</button>
            <button onClick={sendOtp} style={btnPrimary}>Send OTP &amp; Continue</button>
          </div>
        </>)}

        {step==='otp' && (<>
          <div style={{display:'flex',alignItems:'center',gap:12,marginBottom:6}}>
            <span style={{fontSize:28}}>📧</span>
            <h2 style={{margin:0,fontSize:18,fontWeight:800,color:'#0F172A'}}>Enter OTP</h2>
          </div>
          <p style={{margin:'0 0 20px',color:'#64748B',fontSize:13}}>A 6-digit code was sent to your email. It expires in 5 minutes.</p>
          <input value={otp} onChange={e=>setOtp(e.target.value.replace(/\D/g,'').slice(0,6))} onKeyDown={e=>e.key==='Enter'&&verifyAndSync()} placeholder="000000" maxLength={6} style={{...inp,marginBottom:16}} autoFocus/>
          {error && <div style={{background:'#FEF2F2',color:'#DC2626',padding:'10px 14px',borderRadius:9,marginBottom:16,fontSize:13,border:'1px solid #FECACA'}}>{error}</div>}
          <div style={{display:'flex',gap:10}}>
            <button onClick={onClose} style={btnGhost}>Cancel</button>
            <button onClick={verifyAndSync} style={btnPrimary}>Verify &amp; Sync</button>
          </div>
        </>)}

        {step==='syncing' && (
          <div style={{textAlign:'center',padding:'20px 0'}}>
            <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
            <div style={{width:40,height:40,border:'3px solid #E2E8F0',borderTopColor:'#2563EB',borderRadius:'50%',animation:'spin .8s linear infinite',margin:'0 auto 16px'}}/>
            <p style={{fontSize:14,color:'#374151',fontWeight:600}}>Syncing to Google Sheet…</p>
            <p style={{fontSize:12,color:'#94A3B8',marginTop:4}}>This may take a few seconds</p>
          </div>
        )}

        {step==='done' && (<>
          <div style={{textAlign:'center',padding:'12px 0'}}>
            <div style={{fontSize:44,marginBottom:12}}>✅</div>
            <h2 style={{margin:0,fontSize:18,fontWeight:800,color:'#0F172A'}}>Synced Successfully</h2>
            <p style={{margin:'8px 0 20px',color:'#64748B',fontSize:13}}>{rowsUpdated} row ranges updated in your Google Sheet.</p>
            <button onClick={onClose} style={{...btnPrimary,width:'100%'}}>Done</button>
          </div>
        </>)}
      </div>
    </div>
  );
}

// ── Export Helpers ────────────────────────────────────────────────────────
function getMonthsInRange(startFY:number, startMonth:string, endFY:number, endMonth:string) {
  const result: any[] = [];
  let curFY = startFY;
  let curIdx = FY_MONTHS.indexOf(startMonth);
  const endIdx = FY_MONTHS.indexOf(endMonth);
  for (let safety = 0; safety < 60; safety++) {
    const m = FY_MONTHS[curIdx];
    const calYear = curIdx <= 8 ? curFY : curFY + 1;
    const calMonthNum = [4,5,6,7,8,9,10,11,12,1,2,3][curIdx];
    const bkMk = `${calYear}-${String(calMonthNum).padStart(2,'0')}`;
    result.push({ label:`${m} ${calYear}`, month:m, fy:curFY, bkMk, gstMk:gstFilingMk(curFY,m), filingLabel:gstFilingLabel(curFY,m) });
    if (curFY===endFY && curIdx===endIdx) break;
    curIdx++;
    if (curIdx>=12) { curIdx=0; curFY++; }
    if (curFY>endFY+1) break;
  }
  return result;
}

function doExport(settings:any, gstData:any, bkData:any, months:any[]) {
  const esc = (v:any) => String(v==null?'':v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const statusLabel = (s:string) => ({done:'Done',in_progress:'In Progress',na:'N/A',pending:'Pending'}[s]||'Pending');
  const periodFrom = months[0]?.label||'', periodTo = months[months.length-1]?.label||'';
  const filename   = `SanketSalechaAndCo_${periodFrom.replace(' ','_')}_to_${periodTo.replace(' ','_')}`;
  const today      = new Date().toLocaleDateString('en-IN');

  const makeTable = (rows:any[][]) =>
    `<table border="1"><tbody>${rows.map(r=>`<tr>${r.map((c,ci)=>`<td style="mso-number-format:'@'">${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;

  // ── Summary sheet ──────────────────────────────────────────────────────
  const sumRows:any[][] = [
    ['Sanket Salecha & Co. — Compliance Tracker'],
    [`Period: ${periodFrom} to ${periodTo}  |  Generated: ${today}`],
    [],
    ['CLIENT','TYPE',...months.map(m=>m.label),'TOTAL'],
  ];
  settings.gstClients.forEach((c:string)=>{
    let done=0;
    const row=[c,'GST'];
    months.forEach((m:any)=>{
      const s1=gstData[m.gstMk]?.[c]?.['GSTR-1']?.status||'pending';
      const s3=gstData[m.gstMk]?.[c]?.['GSTR-3B']?.status||'pending';
      const both=s1==='done'&&s3==='done';
      const isNA=s1==='na'&&s3==='na';
      row.push(isNA?'N/A':both?'Filed':(['done','in_progress'].includes(s1)||['done','in_progress'].includes(s3))?'Partial':'Pending');
      if(both) done++;
    });
    const eligible=months.filter((m:any)=>{const s1=gstData[m.gstMk]?.[c]?.['GSTR-1']?.status||'pending';const s3=gstData[m.gstMk]?.[c]?.['GSTR-3B']?.status||'pending';return!(s1==='na'&&s3==='na');}).length;
    row.push(`${done}/${eligible}`);
    sumRows.push(row);
  });
  sumRows.push([]);
  settings.bookkeepingClients.forEach((c:string)=>{
    let td=0,tt=0;
    const row=[c,'Bookkeeping'];
    months.forEach((m:any)=>{
      const d=settings.bookkeepingTasks.filter((t:string)=>bkData[m.bkMk]?.[c]?.[t]?.status==='done').length;
      const tot=settings.bookkeepingTasks.filter((t:string)=>(bkData[m.bkMk]?.[c]?.[t]?.status||'pending')!=='na').length;
      row.push(`${d}/${tot}`); td+=d; tt+=tot;
    });
    row.push(`${td}/${tt}`);
    sumRows.push(row);
  });

  // ── GST Filings sheet ──────────────────────────────────────────────────
  const gstRows:any[][] = [
    ['Sanket Salecha & Co. — GST Filings'],
    [`Period: ${periodFrom} to ${periodTo}  |  Each month = returns filed in that month (prev month returns)`],
    [],
    ['CLIENT',...months.flatMap((m:any)=>[`${m.filingLabel} GSTR-1`,`GSTR-1 By`,`GSTR-3B`,`GSTR-3B By`])],
  ];
  settings.gstClients.forEach((c:string)=>{
    const row=[c];
    months.forEach((m:any)=>{
      const e1=gstData[m.gstMk]?.[c]?.['GSTR-1']||{};
      const e3=gstData[m.gstMk]?.[c]?.['GSTR-3B']||{};
      row.push(statusLabel(e1.status||'pending'),e1.by||'',statusLabel(e3.status||'pending'),e3.by||'');
    });
    gstRows.push(row);
  });

  // ── Bookkeeping sheet ──────────────────────────────────────────────────
  const bkRows:any[][] = [
    ['Sanket Salecha & Co. — Bookkeeping Closing'],
    [`Period: ${periodFrom} to ${periodTo}`],
    [],
    ['CLIENT','TASK',...months.map((m:any)=>m.label),'DONE / TOTAL'],
  ];
  settings.bookkeepingClients.forEach((c:string)=>{
    settings.bookkeepingTasks.forEach((task:string,ti:number)=>{
      let done=0;
      const row=[ti===0?c:'',task];
      months.forEach((m:any)=>{
        const e=bkData[m.bkMk]?.[c]?.[task]||{};
        const st=e.status||'pending';
        row.push(st==='done'?`Done${e.by?` (${e.by})`:''}`:`${statusLabel(st)}`);
        if(st==='done') done++;
      });
      const eligible=months.filter((m:any)=>(bkData[m.bkMk]?.[c]?.[task]?.status||'pending')!=='na').length;
      row.push(`${done}/${eligible}`);
      bkRows.push(row);
    });
    bkRows.push([]);
  });

  // ── Generate multi-sheet Excel HTML file ───────────────────────────────
  const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office"
xmlns:x="urn:schemas-microsoft-com:office:excel"
xmlns="http://www.w3.org/TR/REC-html40">
<head><meta charset="UTF-8">
<!--[if gte mso 9]><xml><x:ExcelWorkbook><x:ExcelWorksheets>
<x:ExcelWorksheet><x:Name>Summary</x:Name><x:WorksheetOptions><x:Selected/></x:WorksheetOptions></x:ExcelWorksheet>
<x:ExcelWorksheet><x:Name>GST Filings</x:Name></x:ExcelWorksheet>
<x:ExcelWorksheet><x:Name>Bookkeeping</x:Name></x:ExcelWorksheet>
</x:ExcelWorksheets></x:ExcelWorkbook></xml><![endif]-->
<style>td{font-family:Calibri;font-size:11pt} tr:first-child td{font-weight:bold;background:#1E3A5F;color:white}</style>
</head><body>
${makeTable(sumRows)}
<br>
${makeTable(gstRows)}
<br>
${makeTable(bkRows)}
</body></html>`;

  const blob = new Blob(['﻿'+html], {type:'application/vnd.ms-excel;charset=UTF-8'});
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href=url; a.download=filename+'.xls';
  document.body.appendChild(a); a.click();
  document.body.removeChild(a); URL.revokeObjectURL(url);
}


// ── Export Modal ──────────────────────────────────────────────────────────
function ExportModal({ settings, gstData, bkData, onClose }: any) {
  const [startFY,    setStartFY]    = useState(CURRENT_FY);
  const [startMonth, setStartMonth] = useState('Jun');
  const [endFY,      setEndFY]      = useState(CURRENT_FY);
  const [endMonth,   setEndMonth]   = useState(CURRENT_MONTH);
  const [exporting,  setExporting]  = useState(false);
  const [error,      setError]      = useState('');

  const months = getMonthsInRange(startFY, startMonth, endFY, endMonth);
  const valid  = months.length > 0 && months.length <= 36;

  const handleExport = () => {
    if (!valid) { setError('Invalid date range — make sure From is before To.'); return; }
    setExporting(true); setError('');
    try { doExport(settings, gstData, bkData, months); }
    catch(e) { setError('Export failed. Make sure xlsx is installed (npm install xlsx).'); }
    setExporting(false);
    onClose();
  };

  const selStyle = { padding:'8px 10px', borderRadius:8, border:'1.5px solid #E2E8F0', fontSize:13, fontFamily:'inherit', outline:'none', background:'white', cursor:'pointer' };
  const lbl = { fontSize:11, fontWeight:700 as const, color:'#94A3B8' as const, letterSpacing:.8, marginBottom:6, display:'block' as const, textTransform:'uppercase' as const };

  return (
    <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.5)',zIndex:9999,display:'flex',alignItems:'center',justifyContent:'center'}} onClick={onClose}>
      <div style={{background:'white',borderRadius:16,padding:32,width:500,boxShadow:'0 24px 64px rgba(0,0,0,0.25)'}} onClick={e=>e.stopPropagation()}>
        <div style={{display:'flex',alignItems:'center',gap:12,marginBottom:6}}>
          <span style={{fontSize:28}}>📊</span>
          <h2 style={{margin:0,fontSize:18,fontWeight:800,color:'#0F172A'}}>Export to Excel</h2>
        </div>
        <p style={{margin:'0 0 24px',color:'#64748B',fontSize:13}}>Select a period to export. Generates 3 sheets: Summary, GST Filings, Bookkeeping.</p>

        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:20,marginBottom:20}}>
          <div>
            <label style={lbl}>From</label>
            <div style={{display:'flex',gap:8}}>
              <select value={startMonth} onChange={e=>setStartMonth(e.target.value)} style={{...selStyle,flex:1}}>
                {FY_MONTHS.map(m=><option key={m} value={m}>{m}</option>)}
              </select>
              <select value={startFY} onChange={e=>setStartFY(Number(e.target.value))} style={{...selStyle,flex:1}}>
                {[2026,2027,2028,2029,2030].map(y=><option key={y} value={y}>{fyL(y)}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label style={lbl}>To</label>
            <div style={{display:'flex',gap:8}}>
              <select value={endMonth} onChange={e=>setEndMonth(e.target.value)} style={{...selStyle,flex:1}}>
                {FY_MONTHS.map(m=><option key={m} value={m}>{m}</option>)}
              </select>
              <select value={endFY} onChange={e=>setEndFY(Number(e.target.value))} style={{...selStyle,flex:1}}>
                {[2026,2027,2028,2029,2030].map(y=><option key={y} value={y}>{fyL(y)}</option>)}
              </select>
            </div>
          </div>
        </div>

        <div style={{background:'#F8FAFC',borderRadius:10,padding:'12px 16px',marginBottom:20,fontSize:12,color:'#64748B',border:'1px solid #E2E8F0'}}>
          {valid ? (
            <>
              <span style={{color:'#166534',fontWeight:700}}>✓ {months.length} month{months.length!==1?'s':''}</span>
              {' · '}{months[0]?.label} → {months[months.length-1]?.label}
              <br/>
              <span style={{fontSize:11}}>Includes {settings.gstClients?.length} GST clients · {settings.bookkeepingClients?.length} BK clients · {settings.bookkeepingTasks?.length} tasks</span>
            </>
          ) : <span style={{color:'#EF4444'}}>⚠ Invalid range — From must be before To</span>}
        </div>

        {error && <div style={{background:'#FEF2F2',color:'#DC2626',padding:'10px 14px',borderRadius:9,marginBottom:16,fontSize:13,border:'1px solid #FECACA'}}>{error}</div>}

        <div style={{display:'flex',gap:10}}>
          <button onClick={onClose} style={{flex:1,padding:'10px',borderRadius:10,border:'1.5px solid #E2E8F0',background:'white',cursor:'pointer',fontSize:13,fontFamily:'inherit',color:'#374151'}}>
            Cancel
          </button>
          <button onClick={handleExport} disabled={!valid||exporting} style={{flex:2,padding:'10px',borderRadius:10,border:'none',background:!valid||exporting?'#93C5FD':'#2563EB',color:'white',fontWeight:700,fontSize:13,cursor:!valid||exporting?'default':'pointer',fontFamily:'inherit'}}>
            {exporting?'Generating…':'⬇️ Download Excel'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Dashboard ─────────────────────────────────────────────────────────────
function Dashboard({ settings, gstData, bkData, fy, onNavigate, onExport, onSync }: any) {
  const {gstClients,bookkeepingClients,bookkeepingTasks} = settings;

  // GST done count: uses FILING PERIOD of current calendar month
  const gstCurrMk   = gstFilingMk(fy, CURRENT_MONTH);
  const gstPeriodLbl = gstFilingLabel(fy, CURRENT_MONTH);   // "May 2026"
  const doneGst  = gstClients.reduce((a:number,c:string)=>
    a+["GSTR-1","GSTR-3B"].filter((f)=>gstData[gstCurrMk]?.[c]?.[f]?.status==="done").length, 0);
  const totalGst = gstClients.reduce((a:number,c:string)=>
    a+["GSTR-1","GSTR-3B"].filter((f)=>(gstData[gstCurrMk]?.[c]?.[f]?.status||"pending")!=="na").length, 0);

  // BK done count: uses current calendar month key
  const bkCurrMk = mkKey(fy, CURRENT_MONTH);
  const doneBk   = bookkeepingClients.reduce((a:number,c:string)=>
    a+bookkeepingTasks.filter((t:string)=>bkData[bkCurrMk]?.[c]?.[t]?.status==="done").length, 0);
  const totalBk  = bookkeepingClients.reduce((a:number,c:string)=>
    a+bookkeepingTasks.filter((t:string)=>(bkData[bkCurrMk]?.[c]?.[t]?.status||"pending")!=="na").length, 0);

  // GST heat map: for each calendar month, look up the FILING PERIOD data
  const gstCell = (client:string, calMonth:string) => {
    const mk = gstFilingMk(fy, calMonth);
    const s1 = gstData[mk]?.[client]?.["GSTR-1"]?.status||"pending";
    const s3 = gstData[mk]?.[client]?.["GSTR-3B"]?.status||"pending";
    if(s1==="done"&&s3==="done") return "done";
    if(s1==="na"&&s3==="na")    return "na";
    if(["done","in_progress"].includes(s1)||["done","in_progress"].includes(s3)) return "in_progress";
    return "pending";
  };

  const bkProg = (client:string, m:string) => {
    const mk = mkKey(fy,m);
    const done  = bookkeepingTasks.filter((t:string)=>bkData[mk]?.[client]?.[t]?.status==="done").length;
    const total = bookkeepingTasks.filter((t:string)=>(bkData[mk]?.[client]?.[t]?.status||"pending")!=="na").length;
    return { done, total };
  };

  const HeatCell = ({status}:any)=>{
    const s=STATUSES[status];
    const sym=status==="done"?"✓":status==="in_progress"?"~":status==="na"?"–":"";
    return <td style={{padding:"4px 2px",textAlign:"center"}}><div title={s.label} style={{width:20,height:20,borderRadius:4,margin:"0 auto",background:s.bg,border:`1px solid ${s.border}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,color:s.color,fontWeight:700}}>{sym}</div></td>;
  };

  const cards = [
    {emoji:"🏢",val:gstClients.length,        label:"GST Clients",                        sub:"Monthly filers",       prog:null},
    {emoji:"📚",val:bookkeepingClients.length, label:"BK Clients",                         sub:"Monthly closing",      prog:null},
    {emoji:"📋",val:doneGst,                   label:`GST Filings — ${CURRENT_MONTH}`,     sub:`${gstPeriodLbl} return period`, prog:["#2563EB",totalGst]},
    {emoji:"📒",val:doneBk,                    label:`BK Tasks — ${CURRENT_MONTH}`,        sub:null,                   prog:["#16A34A",totalBk]},
  ];

  return (
    <div style={{paddingBottom:40}}>
      <div style={{marginBottom:24,display:"flex",alignItems:"flex-start",justifyContent:"space-between",flexWrap:"wrap",gap:12}}>
        <div>
          <h1 style={{margin:0,fontSize:24,fontWeight:800,color:"#0F172A"}}>Overview</h1>
          <p style={{margin:"4px 0 0",color:"#64748B",fontSize:14}}>{fyL(fy)} · Current month: {CURRENT_MONTH} 2026</p>
        </div>
        <div style={{display:"flex",gap:10,flexShrink:0}}>
          <button onClick={onSync} style={{padding:"9px 18px",borderRadius:10,border:"1.5px solid #2563EB",background:"white",color:"#2563EB",fontWeight:700,fontSize:13,cursor:"pointer",fontFamily:"inherit",display:"flex",alignItems:"center",gap:6}}>Push to Sheet</button>
          <button onClick={onExport} style={{padding:"9px 18px",borderRadius:10,border:"none",background:"#2563EB",color:"white",fontWeight:700,fontSize:13,cursor:"pointer",fontFamily:"inherit",display:"flex",alignItems:"center",gap:6}}>Export to Excel</button>
        </div>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(180px,1fr))",gap:14,marginBottom:28}}>
        {cards.map((c)=>(
          <div key={c.label} style={{background:"white",borderRadius:14,padding:"18px 20px",border:"1px solid #E2E8F0",boxShadow:"0 1px 3px rgba(0,0,0,0.06)"}}>
            <div style={{fontSize:24,marginBottom:8}}>{c.emoji}</div>
            {c.prog?(
              <>
                <div style={{display:"flex",alignItems:"baseline",gap:3,marginBottom:4}}>
                  <span style={{fontSize:28,fontWeight:800,color:c.val===(c.prog as any)[1]?"#166534":"#1D4ED8",lineHeight:1}}>{c.val}</span>
                  <span style={{fontSize:14,color:"#CBD5E1"}}>/{(c.prog as any)[1]}</span>
                </div>
                <div style={{fontSize:13,fontWeight:600,color:"#1E293B",marginBottom:2}}>{c.label}</div>
                {c.sub&&<div style={{fontSize:10,color:"#94A3B8",marginBottom:6}}>{c.sub}</div>}
                <Bar done={c.val} total={(c.prog as any)[1]} color={(c.prog as any)[0]}/>
              </>
            ):(
              <>
                <div style={{fontSize:28,fontWeight:800,color:"#1E3A5F",lineHeight:1}}>{c.val}</div>
                <div style={{fontSize:13,fontWeight:600,color:"#1E293B",marginTop:4}}>{c.label}</div>
                <div style={{fontSize:11,color:"#94A3B8",marginTop:2}}>{c.sub}</div>
              </>
            )}
          </div>
        ))}
      </div>

      {/* GST heat map — each column shows the filing period of that calendar month */}
      <div style={{background:"white",borderRadius:14,padding:24,border:"1px solid #E2E8F0",marginBottom:18,boxShadow:"0 1px 3px rgba(0,0,0,0.06)"}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8}}>
          <div>
            <h2 style={{margin:0,fontSize:15,fontWeight:700,color:"#0F172A"}}>📋 GST Annual Status — {fyL(fy)}</h2>
            <p style={{margin:"3px 0 0",fontSize:11,color:"#94A3B8"}}>Each month column shows the return period filed in that month (previous month's returns)</p>
          </div>
          <button onClick={()=>onNavigate("gst")} style={{background:"#EFF6FF",border:"none",color:"#2563EB",borderRadius:8,padding:"5px 12px",fontSize:12,fontWeight:700,cursor:"pointer",fontFamily:"inherit",flexShrink:0}}>Open →</button>
        </div>
        <div style={{overflowX:"auto"}}>
          <table style={{borderCollapse:"collapse",fontSize:12,width:"100%"}}>
            <thead>
              <tr>
                <th style={{textAlign:"left",padding:"4px 10px 8px",color:"#94A3B8",fontWeight:600,minWidth:130,fontSize:11}}>Client</th>
                {FY_MONTHS.map((m)=>(
                  <th key={m} style={{padding:"4px 2px 8px",color:m===CURRENT_MONTH?"#2563EB":"#CBD5E1",fontWeight:m===CURRENT_MONTH?700:500,fontSize:10,textAlign:"center",minWidth:24}}>
                    {m}
                    {m===CURRENT_MONTH&&<div style={{width:3,height:3,background:"#2563EB",borderRadius:"50%",margin:"2px auto 0"}}/>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {gstClients.map((c:string,i:number)=>(
                <tr key={c} style={{background:i%2===0?"white":"#FAFAFA"}}>
                  <td style={{padding:"5px 10px",fontWeight:500,color:"#1E293B",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",maxWidth:150,fontSize:12}}>{c}</td>
                  {FY_MONTHS.map((m)=><HeatCell key={m} status={gstCell(c,m)}/>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{display:"flex",gap:16,marginTop:12,flexWrap:"wrap"}}>
          {Object.entries(STATUSES).map(([k,s]:any)=>(
            <span key={k} style={{display:"inline-flex",alignItems:"center",gap:5,fontSize:11,color:"#64748B"}}>
              <span style={{width:10,height:10,borderRadius:3,background:s.bg,border:`1px solid ${s.border}`,display:"inline-block"}}/>{s.label}
            </span>
          ))}
        </div>
      </div>

      {/* BK summary */}
      {bookkeepingClients.length>0&&(
        <div style={{background:"white",borderRadius:14,padding:24,border:"1px solid #E2E8F0",boxShadow:"0 1px 3px rgba(0,0,0,0.06)"}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16}}>
            <h2 style={{margin:0,fontSize:15,fontWeight:700,color:"#0F172A"}}>📒 Bookkeeping Annual — {fyL(fy)}</h2>
            <button onClick={()=>onNavigate("bookkeeping")} style={{background:"#F0FDF4",border:"none",color:"#16A34A",borderRadius:8,padding:"5px 12px",fontSize:12,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>Open →</button>
          </div>
          <div style={{overflowX:"auto"}}>
            <table style={{borderCollapse:"collapse",fontSize:12,width:"100%"}}>
              <thead><tr>
                <th style={{textAlign:"left",padding:"4px 10px 8px",color:"#94A3B8",fontWeight:600,minWidth:130,fontSize:11}}>Client</th>
                {FY_MONTHS.map((m)=><th key={m} style={{padding:"4px 2px 8px",color:m===CURRENT_MONTH?"#16A34A":"#CBD5E1",fontWeight:m===CURRENT_MONTH?700:500,fontSize:10,textAlign:"center",minWidth:36}}>{m}</th>)}
              </tr></thead>
              <tbody>{bookkeepingClients.map((c:string,i:number)=>(
                <tr key={c} style={{background:i%2===0?"white":"#FAFAFA"}}>
                  <td style={{padding:"5px 10px",fontWeight:500,color:"#1E293B",whiteSpace:"nowrap",fontSize:12}}>{c}</td>
                  {FY_MONTHS.map((m)=>{
                    const {done,total}=bkProg(c,m);const pct=total?done/total:0;
                    return <td key={m} style={{padding:"4px 2px",textAlign:"center"}}><span style={{display:"inline-block",padding:"2px 5px",borderRadius:5,background:pct===1?"#F0FDF4":pct>0?"#FFFBEB":"#F9FAFB",color:pct===1?"#166534":pct>0?"#92400E":"#9CA3AF",fontSize:10,fontWeight:600}}>{done}/{total}</span></td>;
                  })}
                </tr>
              ))}</tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ── GST Tab ───────────────────────────────────────────────────────────────
// Uses FILING PERIOD: when calendar month = Jun, works on May returns
function GSTTab({ settings, gstData, month, fy, setPopover }: any) {
  const {gstClients} = settings;
  const FILINGS = ["GSTR-1","GSTR-3B"];

  // Key for GST data = filing period (previous month)
  const gstMk    = gstFilingMk(fy, month);
  const periodLbl = gstFilingLabel(fy, month);   // e.g. "May 2026"

  const getE = (c:string,f:string) => gstData[gstMk]?.[c]?.[f]||{};

  const openPicker = (e:any, client:string, filing:string) => {
    e.stopPropagation();
    const rect  = e.currentTarget.getBoundingClientRect();
    const entry = getE(client, filing);
    setPopover({ rect, status:entry.status||"pending", by:entry.by||"",
      onSave:(u:any) => fbWriteGst(gstMk, client, filing, u) });
  };

  const doneCount = gstClients.reduce((a:number,c:string)=>
    a+FILINGS.filter((f)=>getE(c,f).status==="done").length, 0);
  const total = gstClients.reduce((a:number,c:string)=>
    a+FILINGS.filter((f)=>(getE(c,f).status||"pending")!=="na").length, 0);

  return (
    <div>
      <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",marginBottom:6,flexWrap:"wrap",gap:10}}>
        <div>
          <h1 style={{margin:0,fontSize:22,fontWeight:800,color:"#0F172A"}}>GST Filings — {month} {fy}</h1>
          {/* Filing period banner */}
          <div style={{display:"inline-flex",alignItems:"center",gap:6,marginTop:6,background:"#EFF6FF",border:"1px solid #BFDBFE",borderRadius:8,padding:"5px 12px"}}>
            <span style={{fontSize:12,color:"#1D4ED8"}}>📅 Filing period:</span>
            <span style={{fontSize:13,fontWeight:700,color:"#1D4ED8"}}>{periodLbl} Returns</span>
          </div>
          <p style={{margin:"8px 0 0",color:"#64748B",fontSize:13}}>
            GSTR-1 due 11 {month} · GSTR-3B due 20 {month}
          </p>
        </div>
        <div style={{background:doneCount===total?"#F0FDF4":"#EFF6FF",border:`1px solid ${doneCount===total?"#86EFAC":"#BFDBFE"}`,borderRadius:9,padding:"6px 14px",fontSize:13,alignSelf:"flex-start"}}>
          <span style={{fontWeight:700,color:doneCount===total?"#166534":"#1D4ED8"}}>{doneCount}</span>
          <span style={{color:"#64748B"}}> / {total} done</span>
        </div>
      </div>
      <div style={{marginBottom:22}}><Bar done={doneCount} total={total} color="#2563EB" h={8}/></div>

      {gstClients.length===0
        ? <Empty emoji="📋" title="No GST clients" sub="Add in Settings"/>
        : (
          <div style={{display:"flex",flexDirection:"column",gap:10}}>
            {gstClients.map((client:string,i:number)=>{
              const allDone=FILINGS.every((f)=>getE(client,f).status==="done");
              const anyProg=FILINGS.some((f)=>["done","in_progress"].includes(getE(client,f).status));
              return (
                <div key={client} style={{background:"white",borderRadius:14,padding:"16px 22px",border:allDone?"1.5px solid #86EFAC":"1px solid #E2E8F0",boxShadow:"0 1px 3px rgba(0,0,0,0.06)",display:"flex",alignItems:"center",gap:14}}>
                  <div style={{width:32,height:32,borderRadius:10,flexShrink:0,background:allDone?"#DCFCE7":anyProg?"#DBEAFE":"#F1F5F9",color:allDone?"#166534":anyProg?"#1D4ED8":"#94A3B8",display:"flex",alignItems:"center",justifyContent:"center",fontSize:13,fontWeight:800}}>{allDone?"✓":i+1}</div>
                  <div style={{flex:1,minWidth:140}}>
                    <div style={{fontWeight:700,color:"#0F172A",fontSize:14}}>{client}</div>
                    {allDone&&<div style={{fontSize:11,color:"#16A34A",marginTop:1}}>All {periodLbl} filings complete ✓</div>}
                  </div>
                  <div style={{display:"flex",gap:16,flexShrink:0}}>
                    {FILINGS.map((f)=>{
                      const e=getE(client,f);
                      return (
                        <div key={f} style={{display:"flex",flexDirection:"column",gap:4,alignItems:"center",minWidth:145}}>
                          <span style={{fontSize:10,fontWeight:700,color:"#94A3B8",letterSpacing:.5}}>{f}</span>
                          <Badge status={e.status||"pending"} by={e.by} onClick={(ev:any)=>openPicker(ev,client,f)}/>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )
      }
    </div>
  );
}

// ── Bookkeeping Tab ───────────────────────────────────────────────────────
function BKTab({ settings, bkData, mk, month, setPopover }: any) {
  const {bookkeepingClients,bookkeepingTasks,teamMembers} = settings;
  const [expanded,setExpanded] = useState(()=>new Set(bookkeepingClients));
  const [qc,setQc]     = useState<any>(null);
  const [qWho,setQWho] = useState("");
  const getE=(c:string,t:string)=>bkData[mk]?.[c]?.[t]||{};
  const openPicker=(e:any,client:string,task:string)=>{e.stopPropagation();const entry=getE(client,task);const rect=e.currentTarget.getBoundingClientRect();setPopover({rect,status:entry.status||"pending",by:entry.by||"",onSave:(u:any)=>fbWriteBk(mk,client,task,u)});};
  const toggle=(c:string)=>setExpanded((p:any)=>{const s=new Set(p);s.has(c)?s.delete(c):s.add(c);return s;});
  const markAll=(client:string,who:string)=>{bookkeepingTasks.forEach((t:string)=>{if(!["done","na"].includes(getE(client,t).status))fbWriteBk(mk,client,t,{status:"done",by:who});});setQc(null);setQWho("");};
  const totalAll=bookkeepingClients.reduce((a:number,c:string)=>
    a+bookkeepingTasks.filter((t:string)=>(getE(c,t).status||"pending")!=="na").length,0);
  const doneAll=bookkeepingClients.reduce((a:number,c:string)=>a+bookkeepingTasks.filter((t:string)=>getE(c,t).status==="done").length,0);
  return (
    <div>
      <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",marginBottom:14,flexWrap:"wrap",gap:10}}>
        <div>
          <h1 style={{margin:0,fontSize:22,fontWeight:800,color:"#0F172A"}}>Bookkeeping Closing — {month}</h1>
          <p style={{margin:"4px 0 0",color:"#64748B",fontSize:13}}>{bookkeepingTasks.length} tasks · {bookkeepingClients.length} clients</p>
        </div>
        <div style={{background:"#F0FDF4",border:"1px solid #86EFAC",borderRadius:9,padding:"6px 14px",fontSize:13,alignSelf:"flex-start"}}>
          <span style={{fontWeight:700,color:"#166534"}}>{doneAll}</span><span style={{color:"#64748B"}}> / {totalAll} done</span>
        </div>
      </div>
      <div style={{marginBottom:22}}><Bar done={doneAll} total={totalAll} color="#16A34A" h={8}/></div>
      {bookkeepingClients.length===0?<Empty emoji="📒" title="No BK clients" sub="Add in Settings"/>:(
        <div style={{display:"flex",flexDirection:"column",gap:10}}>
          {bookkeepingClients.map((client:string)=>{
            const done=bookkeepingTasks.filter((t:string)=>getE(client,t).status==="done").length;
            const total=bookkeepingTasks.filter((t:string)=>(getE(client,t).status||"pending")!=="na").length;
            const allDone=done===total&&total>0,isOpen=expanded.has(client);
            return (
              <div key={client} style={{background:"white",borderRadius:14,border:allDone?"1.5px solid #86EFAC":"1px solid #E2E8F0",boxShadow:"0 1px 3px rgba(0,0,0,0.06)",overflow:"hidden"}}>
                <div style={{padding:"14px 20px",display:"flex",alignItems:"center",gap:12,cursor:"pointer",background:allDone?"#F9FFFE":"white",borderBottom:isOpen?"1px solid #F1F5F9":"none"}} onClick={()=>toggle(client)}>
                  <div style={{width:36,height:36,borderRadius:11,flexShrink:0,background:allDone?"#DCFCE7":"#EFF6FF",display:"flex",alignItems:"center",justifyContent:"center",fontSize:18}}>{allDone?"✅":"📒"}</div>
                  <div style={{flex:1,minWidth:0}}><div style={{fontWeight:700,fontSize:14,color:"#0F172A"}}>{client}</div><div style={{marginTop:5}}><Bar done={done} total={total} color={allDone?"#16A34A":"#2563EB"}/></div></div>
                  {!allDone&&<div onClick={(e)=>e.stopPropagation()}>{qc?.client===client?(
                    <div style={{display:"flex",gap:6,alignItems:"center"}}>
                      <select value={qWho} onChange={(e)=>setQWho(e.target.value)} style={{padding:"5px 8px",borderRadius:7,border:"1.5px solid #E2E8F0",fontSize:12,fontFamily:"inherit"}}><option value="">Who?</option>{teamMembers.map((m:string)=><option key={m} value={m}>{m}</option>)}</select>
                      <button onClick={()=>markAll(client,qWho)} disabled={!qWho} style={{padding:"5px 10px",borderRadius:7,border:"none",background:qWho?"#16A34A":"#E2E8F0",color:qWho?"white":"#9CA3AF",fontSize:11,fontWeight:700,cursor:qWho?"pointer":"default",fontFamily:"inherit"}}>Mark Done</button>
                      <button onClick={()=>{setQc(null);setQWho("");}} style={{padding:"4px 7px",borderRadius:7,border:"1px solid #E2E8F0",background:"white",fontSize:13,cursor:"pointer",color:"#64748B",fontFamily:"inherit"}}>✕</button>
                    </div>
                  ):<button onClick={()=>{setQc({client});setQWho("");}} style={{padding:"6px 12px",borderRadius:8,border:"1.5px solid #E2E8F0",background:"white",color:"#374151",fontSize:11,fontWeight:600,cursor:"pointer",fontFamily:"inherit",whiteSpace:"nowrap"}}>⚡ Quick Close</button>}</div>}
                  <span style={{color:"#CBD5E1",fontSize:18,flexShrink:0,display:"inline-block",transform:isOpen?"rotate(90deg)":"rotate(0)",transition:"transform .2s"}}>›</span>
                </div>
                {isOpen&&<div>{bookkeepingTasks.map((task:string,ti:number)=>{
                  const e=getE(client,task);const isDone=e.status==="done";const isNA=e.status==="na";
                  return <div key={task} style={{display:"flex",alignItems:"center",gap:12,padding:"10px 20px",background:isDone?"#FAFFFE":ti%2===0?"white":"#FAFAFA",borderBottom:ti<bookkeepingTasks.length-1?"1px solid #F8FAFC":"none"}}>
                    <div style={{width:20,height:20,borderRadius:6,flexShrink:0,background:isDone?"#DCFCE7":isNA?"#F3F4F6":"white",border:`1.5px solid ${isDone?"#86EFAC":isNA?"#E5E7EB":"#D1D5DB"}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,color:"#166534",fontWeight:800}}>{isDone?"✓":""}</div>
                    <span style={{flex:1,fontSize:13,color:isDone||isNA?"#94A3B8":"#1E293B",textDecoration:isDone||isNA?"line-through":"none",fontWeight:isDone||isNA?400:500}}>{task}</span>
                    {e.by&&<span style={{fontSize:11,color:"#CBD5E1",flexShrink:0}}>{e.by}</span>}
                    <Badge compact status={e.status||"pending"} onClick={(ev:any)=>openPicker(ev,client,task)}/>
                  </div>;
                })}</div>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}


// ── Settings Panel ────────────────────────────────────────────────────────
function SettingsPanel({ settings, onSave }: any) {
  const [local,setLocal]   = useState(()=>dc(settings));
  const [active,setActive] = useState("gstClients");
  const [newVal,setNewVal] = useState<any>({});
  const [saved,setSaved]   = useState(false);
  useEffect(()=>{setLocal(dc(settings));},[settings]);
  const secs = [
    {id:"gstClients",        emoji:"🏢",label:"GST Clients",  desc:"Clients for GSTR-1 & GSTR-3B monthly filings"},
    {id:"bookkeepingClients",emoji:"📚",label:"BK Clients",   desc:"Clients for monthly bookkeeping & closing"},
    {id:"teamMembers",       emoji:"👤",label:"Team Members", desc:"Names shown in the 'Done by' dropdown"},
    {id:"bookkeepingTasks",  emoji:"✅",label:"BK Tasks",     desc:"Monthly closing checklist for all BK clients"},

  ];
  const remove=(k:string,i:number)=>setLocal((p:any)=>({...p,[k]:p[k].filter((_:any,j:number)=>j!==i)}));
  const add=(k:string)=>{const v=(newVal[k]||"").trim();if(!v||local[k].includes(v))return;setLocal((p:any)=>({...p,[k]:[...p[k],v]}));setNewVal((p:any)=>({...p,[k]:""}));};
  const save=async()=>{await onSave(local);setSaved(true);setTimeout(()=>setSaved(false),2500);};
  const sec=secs.find((s)=>s.id===active)!;
  return (
    <div>
      <div style={{marginBottom:22}}><h1 style={{margin:0,fontSize:22,fontWeight:800,color:"#0F172A"}}>Settings</h1><p style={{margin:"4px 0 0",color:"#64748B",fontSize:13}}>Changes sync instantly to all team members.</p></div>
      <div style={{display:"grid",gridTemplateColumns:"210px 1fr",gap:18,alignItems:"start"}}>
        <div style={{display:"flex",flexDirection:"column",gap:5}}>
          {secs.map((s)=>(
            <button key={s.id} onClick={()=>setActive(s.id)} style={{display:"flex",alignItems:"center",gap:10,padding:"12px 14px",borderRadius:10,background:active===s.id?"#EFF6FF":"white",border:active===s.id?"1.5px solid #BFDBFE":"1px solid #E2E8F0",color:active===s.id?"#1E40AF":"#374151",fontWeight:active===s.id?700:500,cursor:"pointer",fontSize:13,fontFamily:"inherit",textAlign:"left"}}>
              {s.emoji}<span style={{flex:1}}>{s.label}</span>
              <span style={{background:active===s.id?"#DBEAFE":"#F1F5F9",color:active===s.id?"#1E40AF":"#64748B",borderRadius:10,padding:"1px 7px",fontSize:11,fontWeight:700}}>{local[s.id]?.length||0}</span>
            </button>
          ))}
          <button onClick={save} style={{marginTop:12,padding:"12px",borderRadius:12,border:"none",background:saved?"#16A34A":"#2563EB",color:"white",fontWeight:700,fontSize:14,cursor:"pointer",fontFamily:"inherit",transition:"background .3s"}}>
            {saved?"✓ Saved & Synced!":"Save Changes"}
          </button>
        </div>
        <div style={{background:"white",borderRadius:14,padding:22,border:"1px solid #E2E8F0",boxShadow:"0 1px 3px rgba(0,0,0,0.06)"}}>
          <h2 style={{margin:"0 0 4px",fontSize:17,fontWeight:800,color:"#0F172A"}}>{sec.emoji} {sec.label}</h2>
          <p style={{margin:"0 0 20px",fontSize:13,color:"#64748B"}}>{sec.desc}</p>
          {local[active]?.length===0?(
            <div style={{textAlign:"center",padding:"28px",background:"#F8FAFC",borderRadius:12,border:"1px dashed #CBD5E1",marginBottom:18,color:"#94A3B8"}}>
              <div style={{fontSize:30,marginBottom:8}}>{sec.emoji}</div>
              <div style={{fontSize:14,fontWeight:600}}>None added yet</div>
            </div>
          ):(
            <div style={{display:"flex",flexDirection:"column",gap:6,marginBottom:18}}>
              {local[active].map((item:string,i:number)=>(
                <div key={i} style={{display:"flex",alignItems:"center",gap:10,padding:"10px 14px",borderRadius:10,border:"1px solid #F1F5F9",background:"#FAFAFA"}}>
                  <span style={{width:24,height:24,borderRadius:7,background:"#EFF6FF",color:"#2563EB",display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:800,flexShrink:0}}>{i+1}</span>
                  <span style={{flex:1,fontSize:14,color:"#1E293B",fontWeight:500}}>{item}</span>
                  <button onClick={()=>remove(active,i)} style={{background:"transparent",border:"none",color:"#FCA5A5",cursor:"pointer",padding:"4px 6px",borderRadius:6,fontSize:18,lineHeight:1,fontFamily:"inherit"}} onMouseEnter={(e)=>e.currentTarget.style.color="#EF4444"} onMouseLeave={(e)=>e.currentTarget.style.color="#FCA5A5"}>×</button>
                </div>
              ))}
            </div>
          )}
          <div style={{display:"flex",gap:8}}>
            <input value={newVal[active]||""} onChange={(e)=>setNewVal((p:any)=>({...p,[active]:e.target.value}))} onKeyDown={(e)=>e.key==="Enter"&&add(active)}
              placeholder={`Add new ${sec.label.replace(/s$/,"").toLowerCase()}…`}
              style={{flex:1,padding:"10px 14px",borderRadius:10,border:"1.5px solid #E2E8F0",fontSize:13,fontFamily:"inherit",outline:"none",background:"white"}}
              onFocus={(e)=>e.target.style.borderColor="#93C5FD"} onBlur={(e)=>e.target.style.borderColor="#E2E8F0"}/>
            <button onClick={()=>add(active)} style={{padding:"10px 18px",borderRadius:10,border:"none",background:"#2563EB",color:"white",fontWeight:700,fontSize:13,cursor:"pointer",fontFamily:"inherit"}}>+ Add</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Root App ──────────────────────────────────────────────────────────────
export default function App() {
  const [user,        setUser]        = useState<any>(undefined);
  const [tab,         setTab]         = useState("dashboard");
  const [settings,    setSettings]    = useState<any>(DEFAULTS);
  const [gstData,     setGstData]     = useState<any>({});
  const [bkData,      setBkData]      = useState<any>({});
  const [month,       setMonth]       = useState(CURRENT_MONTH);
  const [fy,          setFy]          = useState(CURRENT_FY);
  const [dataReady,   setDataReady]   = useState(false);
  const [popover,     setPopover]     = useState<any>(null);
  const [showExport,  setShowExport]  = useState(false);
  const [idleWarning, setIdleWarning] = useState(false);
  const [showSync,    setShowSync]    = useState(false);

  useEffect(()=>{ const u=onAuthStateChanged(auth,(u)=>setUser(u)); return u; },[]);

  useEffect(()=>{
    if(!user) return;
    const WARN = 9*60*1000, IDLE = 10*60*1000;
    let wT: ReturnType<typeof setTimeout>, iT: ReturnType<typeof setTimeout>;
    const reset=()=>{
      clearTimeout(wT); clearTimeout(iT); setIdleWarning(false);
      wT=setTimeout(()=>setIdleWarning(true), WARN);
      iT=setTimeout(()=>{ setIdleWarning(false); signOut(auth); }, IDLE);
    };
    const EVT=['mousedown','mousemove','keydown','scroll','touchstart','click'];
    EVT.forEach(e=>document.addEventListener(e,reset,{passive:true}));
    reset();
    return()=>{ clearTimeout(wT); clearTimeout(iT); EVT.forEach(e=>document.removeEventListener(e,reset)); };
  },[user]);

  useEffect(()=>{
    if(!user) return;
    let count=0;
    const check=()=>{ count++; if(count===3) setDataReady(true); };
    const uS=onSnapshot(doc(db,"tracker","settings"),(s)=>{ if(s.exists()) setSettings(s.data()); else setDoc(doc(db,"tracker","settings"),DEFAULTS); check(); });
    const uG=onSnapshot(doc(db,"tracker","gst"),    (s)=>{ if(s.exists()) setGstData(s.data());   else setGstData({});   check(); });
    const uB=onSnapshot(doc(db,"tracker","bk"),     (s)=>{ if(s.exists()) setBkData(s.data());    else setBkData({});    check(); });
    return()=>{ uS();uG();uB(); };
  },[user]);

  const closePopover = useCallback(()=>setPopover(null),[]);
  const mk = mkKey(fy, month); // BK uses calendar month key


  if(user===undefined) return <Loader text="Checking credentials…"/>;
  if(!user)            return <LoginScreen/>;
  if(!dataReady)       return <Loader text="Syncing data…"/>;

  return (
    <div style={{fontFamily:"system-ui,-apple-system,sans-serif",minHeight:"100vh",background:"#F8FAFC",fontSize:14}} onClick={closePopover}>
      <style>{`*{box-sizing:border-box} @keyframes spin{to{transform:rotate(360deg)}}`}</style>
      <Nav tab={tab} setTab={setTab} userEmail={user.email}/>
      {(tab==="gst"||tab==="bookkeeping")&&<MonthBar month={month} setMonth={setMonth} fy={fy} setFy={setFy}/>}
      <div style={{maxWidth:1200,margin:"0 auto",padding:"28px 20px"}}>
        {tab==="dashboard"   && <Dashboard    settings={settings} gstData={gstData} bkData={bkData} fy={fy} onNavigate={(t:string)=>setTab(t)} onExport={()=>setShowExport(true)} onSync={()=>setShowSync(true)}/>}
        {tab==="gst"         && <GSTTab       settings={settings} gstData={gstData} month={month} fy={fy} setPopover={setPopover}/>}
        {tab==="bookkeeping" && <BKTab        settings={settings} bkData={bkData} mk={mk} month={month} setPopover={setPopover}/>}
        {tab==="settings"    && <SettingsPanel  settings={settings} onSave={fbSaveSettings}/>}
      </div>
      {popover&&<Popover {...popover} teamMembers={settings.teamMembers} onClose={closePopover}/>}
      {showExport&&<ExportModal settings={settings} gstData={gstData} bkData={bkData} onClose={()=>setShowExport(false)}/>}
      {showSync&&<SyncModal onClose={()=>setShowSync(false)}/>}
      {idleWarning&&(
        <div style={{position:"fixed",bottom:24,left:"50%",transform:"translateX(-50%)",zIndex:9999,background:"#1E3A5F",color:"white",borderRadius:12,padding:"14px 24px",boxShadow:"0 8px 32px rgba(0,0,0,0.3)",display:"flex",alignItems:"center",gap:16,fontSize:13,whiteSpace:"nowrap"}}>
          <span>You will be signed out in <strong>1 minute</strong> due to inactivity.</span>
          <button onClick={()=>setIdleWarning(false)} style={{background:"#60A5FA",border:"none",color:"white",borderRadius:8,padding:"6px 14px",cursor:"pointer",fontWeight:700,fontFamily:"inherit",fontSize:12}}>I am here</button>
        </div>
      )}
    </div>
  );
}