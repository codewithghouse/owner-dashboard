import { useState, useEffect, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { db, auth } from "@/lib/firebase";
import { collection, getDocs, query, where, doc, getDoc } from "firebase/firestore";
import { ArrowLeft, Loader2, AlertCircle, Users, BookOpen, TrendingUp, Mail, Phone, Calendar, Star, Award, BarChart3, Activity, FileText } from "lucide-react";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar } from "recharts";

// ── Tokens ───────────────────────────────────────────────────────────────────
const T = {
  bg:"#EEF4FF",white:"#fff",ink:"#0f172a",ink2:"#475569",ink3:"#94a3b8",
  bdr:"#e2e8f0",s1:"#f1f5f9",s2:"#e2e8f0",
  blue:"#3B5BDB",blBg:"#EDF2FF",grn:"#16a34a",glBg:"#f0fdf4",
  red:"#dc2626",rlBg:"#fef2f2",amb:"#d97706",alBg:"#fffbeb",
};
const MONTHS=["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];
const toDate=(v:any):Date|null=>{if(!v)return null;if(v?.toDate)return v.toDate();if(v?.seconds)return new Date(v.seconds*1000);const d=new Date(v);return isNaN(d.getTime())?null:d;};

// ── Card with Dashboard-vibe hover (lift + blue halo, no rotation) ───────────
const Card=({children,title,action,style:st}:{children:React.ReactNode;title?:string;action?:React.ReactNode;style?:React.CSSProperties})=>{
  const[hov,setHov]=useState(false);
  return(
    <div onMouseEnter={()=>setHov(true)} onMouseLeave={()=>setHov(false)}
      style={{position:"relative",background:T.white,border:`1px solid ${hov?"rgba(59,91,219,0.25)":T.bdr}`,borderRadius:16,overflow:"hidden",
        transform: hov ? "translate3d(0,-7px,0) scale(1.02)" : "translate3d(0,0,0) scale(1)",
        transition:"transform 0.22s cubic-bezier(0.2,0.8,0.2,1), box-shadow 0.22s ease, border-color 0.3s",
        willChange:"transform", backfaceVisibility:"hidden",
        boxShadow: hov
          ? "0 8px 16px rgba(0,85,255,0.20), 0 24px 40px rgba(0,85,255,0.24), 0 40px 80px rgba(0,85,255,0.26)"
          : "0 4px 8px rgba(0,85,255,0.12), 0 12px 24px rgba(0,85,255,0.16), 0 28px 56px rgba(0,85,255,0.18)",
        ...st}}>
      {title&&<div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"14px 20px",borderBottom:`1px solid ${T.s2}`,position:"relative",zIndex:2}}><span style={{fontSize:14,fontWeight:600,color:T.ink}}>{title}</span>{action||null}</div>}
      <div style={{padding:"16px 20px",position:"relative",zIndex:2}}>{children}</div>
    </div>
  );
};
const DLink=()=><span style={{fontSize:11,color:T.blue,fontWeight:500,cursor:"pointer"}}>Details →</span>;
const StarRow=({rating}:{rating:number})=><div style={{display:"flex",gap:2}}>{[1,2,3,4,5].map(i=><Star key={i} size={14} fill={i<=Math.round(rating)?"#f59e0b":"none"} color={i<=Math.round(rating)?"#f59e0b":"#e2e8f0"}/>)}</div>;

// ═══════════════════════════════════════════════════════════════════════════════
export default function TeacherProfile() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [teacher, setTeacher] = useState<any>(null);
  const [timeline, setTimeline] = useState<{month:string;score:number;passRate:number}[]>([]);
  const [classes, setClasses] = useState<any[]>([]);
  const [studentCount, setStudentCount] = useState(0);
  const [attPct, setAttPct] = useState<number|null>(null);
  const [avgScore, setAvgScore] = useState(0);
  const [passRate, setPassRate] = useState(0);
  const [vsBranch, setVsBranch] = useState<{category:string;teacher:number;branchAvg:number}[]>([]);
  const [subjectData, setSubjectData] = useState<{name:string;avg:number}[]>([]);

  useEffect(() => {
    if (!id) { setLoading(false); return; }
    const schoolId = auth.currentUser?.uid;
    if (!schoolId) return;

    const load = async () => {
      try {
        const tDoc = await getDoc(doc(db,"teachers",id));
        if (!tDoc.exists()) { setLoading(false); return; }
        const tData = {id:tDoc.id,...tDoc.data() as any};
        setTeacher(tData);

        // Scores — scoped to this owner's school
        const scSnap = await getDocs(query(
          collection(db,"test_scores"),
          where("schoolId","==",schoolId),
          where("teacherId","==",id),
        ));
        const scores = scSnap.docs.map(d=>d.data() as any);
        const getPct = (s:any) => { const p = parseFloat(s.percentage??s.score??""); return isNaN(p)?0:p; };
        const pcts = scores.map(getPct).filter(v=>v>0);
        const avg = pcts.length ? Math.round(pcts.reduce((a,b)=>a+b,0)/pcts.length) : 0;
        setAvgScore(avg);
        const pass = pcts.length ? Math.round(pcts.filter(v=>v>=60).length/pcts.length*100) : 0;
        setPassRate(pass);

        // Subject breakdown
        const subMap = new Map<string,number[]>();
        scores.forEach(s => { const sub = s.subject||s.subjectName||tData.subject||"General"; const p = getPct(s); if (p>0) { if (!subMap.has(sub)) subMap.set(sub,[]); subMap.get(sub)!.push(p); }});
        setSubjectData(Array.from(subMap.entries()).map(([n,sc])=>({name:n.slice(0,12),avg:Math.round(sc.reduce((a,b)=>a+b,0)/sc.length)})));

        // Timeline
        const now = new Date();
        const months = Array.from({length:6},(_,i)=>{const d=new Date(now.getFullYear(),now.getMonth()-5+i,1);return MONTHS[d.getMonth()];});
        const byMonth = new Map<string,number[]>();
        scores.forEach(s => { const ts = toDate(s.timestamp||s.createdAt); const p = getPct(s); if (ts&&p>0) { const mk=MONTHS[ts.getMonth()]; if(!byMonth.has(mk))byMonth.set(mk,[]); byMonth.get(mk)!.push(p); }});
        setTimeline(months.map(m=>{const sc=byMonth.get(m);if(!sc||!sc.length)return{month:m,score:0,passRate:0};return{month:m,score:Math.round(sc.reduce((a,b)=>a+b,0)/sc.length),passRate:Math.round(sc.filter(v=>v>=60).length/sc.length*100)};}));

        // Attendance
        const attSnap = await getDocs(query(
          collection(db,"attendance"),
          where("schoolId","==",schoolId),
          where("teacherId","==",id),
        ));
        const attDocs = attSnap.docs.map(d=>d.data() as any);
        const attP = attDocs.filter(d=>(d.status||"").toLowerCase()==="present").length;
        setAttPct(attDocs.length>0?Math.round((attP/attDocs.length)*100):null);

        // Classes
        const clSnap = await getDocs(query(
          collection(db,"classes"),
          where("schoolId","==",schoolId),
          where("teacherId","==",id),
        ));
        const tClasses = clSnap.docs.map(d=>({id:d.id,...d.data() as any}));
        setClasses(tClasses);
        if (tClasses.length>0) {
          const cIds = tClasses.map(c=>c.id).slice(0,10);
          const enSnap = await getDocs(query(
            collection(db,"enrollments"),
            where("schoolId","==",schoolId),
            where("classId","in",cIds),
          ));
          setStudentCount(enSnap.size);
        }

        // vs Branch — scope to this owner's school (fixes cross-tenant leak)
        if (tData.branchId||tData.branch) {
          const allT = await getDocs(query(
            collection(db,"teachers"),
            where("schoolId","==",schoolId),
          ));
          const branchTIds = allT.docs.filter(d=>{const bd=d.data() as any;return d.id!==id&&(bd.branchId===tData.branchId||bd.branch===tData.branch);}).map(d=>d.id);
          const allSc = await getDocs(query(
            collection(db,"test_scores"),
            where("schoolId","==",schoolId),
          ));
          const bScores:number[]=[];
          allSc.docs.forEach(d=>{const data=d.data() as any;if(branchTIds.includes(data.teacherId||"")){const p=parseFloat(data.percentage??data.score??"");if(!isNaN(p))bScores.push(p);}});
          const bAvg=bScores.length?Math.round(bScores.reduce((a,b)=>a+b,0)/bScores.length):avg;
          const bPass=bScores.length?Math.round(bScores.filter(v=>v>=60).length/bScores.length*100):pass;

          // Real branch attendance average — aggregate attendance for other teachers in same branch
          const tAttPct = attDocs.length > 0 ? Math.round((attP / attDocs.length) * 100) : 0;
          let bAtt = tAttPct;
          let bClassCount = tClasses.length;
          if (branchTIds.length > 0) {
            const attIdChunks: string[][] = [];
            for (let i = 0; i < branchTIds.length; i += 10) attIdChunks.push(branchTIds.slice(i, i + 10));
            let bPres = 0, bTotal = 0;
            let bClassTotal = 0;
            for (const chunk of attIdChunks) {
              const [brAttSnap, brClSnap] = await Promise.all([
                getDocs(query(
                  collection(db, "attendance"),
                  where("schoolId", "==", schoolId),
                  where("teacherId", "in", chunk),
                )),
                getDocs(query(
                  collection(db, "classes"),
                  where("schoolId", "==", schoolId),
                  where("teacherId", "in", chunk),
                )),
              ]);
              brAttSnap.docs.forEach(d => {
                const data = d.data() as any;
                bTotal++;
                if ((data.status || "").toLowerCase() === "present") bPres++;
              });
              bClassTotal += brClSnap.size;
            }
            if (bTotal > 0) bAtt = Math.round((bPres / bTotal) * 100);
            bClassCount = Math.round(bClassTotal / branchTIds.length);
          }

          setVsBranch([
            {category:"Avg Score",  teacher:avg,            branchAvg:bAvg},
            {category:"Pass Rate",  teacher:pass,           branchAvg:bPass},
            {category:"Attendance", teacher:tAttPct,        branchAvg:bAtt},
            {category:"Classes",    teacher:tClasses.length,branchAvg:Math.max(1,bClassCount)},
          ]);
        }
      } catch(e) { console.error("TeacherProfile load error:",e); }
      setLoading(false);
    };
    load();
  }, [id]);    // auth.currentUser.uid is stable per owner session

  if (loading) return <div style={{display:"flex",alignItems:"center",justifyContent:"center",minHeight:"60vh",gap:10}}><Loader2 className="animate-spin" size={20} color={T.blue}/><span style={{fontSize:13,color:T.ink3}}>Loading teacher profile...</span></div>;
  if (!teacher) return <div style={{textAlign:"center",padding:64}}><AlertCircle size={40} color={T.red} style={{margin:"0 auto 12px"}}/><p style={{fontSize:16,fontWeight:600,color:T.ink,marginBottom:6}}>Teacher not found</p><button onClick={()=>navigate("/teachers")} style={{padding:"8px 20px",borderRadius:10,border:`1px solid ${T.bdr}`,background:T.white,color:T.blue,fontSize:13,fontWeight:500,cursor:"pointer"}}>← Back</button></div>;

  const initials = (teacher.name||"?").split(" ").map((n:string)=>n[0]).join("").toUpperCase().slice(0,2);
  const hasTimeline = timeline.some(t=>t.score>0);

  return (
    <div style={{minHeight:"100vh",background:T.bg,fontFamily:"'Inter',-apple-system,sans-serif",padding:"20px 24px 60px"}}>
      {/* Top */}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:24}}>
        <button onClick={()=>navigate("/teachers")} style={{display:"flex",alignItems:"center",gap:6,padding:"8px 16px",borderRadius:10,border:`1px solid ${T.bdr}`,background:T.white,color:T.ink2,fontSize:13,fontWeight:500,cursor:"pointer"}}><ArrowLeft size={14}/>Back to Teachers</button>
        <button onClick={()=>window.print()} style={{padding:"8px 16px",borderRadius:10,border:`1px solid ${T.bdr}`,background:T.white,color:T.ink2,fontSize:12,fontWeight:500,cursor:"pointer"}}>Export Report</button>
      </div>

      {/* ═══ HERO 3-COL ═══ */}
      <div style={{display:"grid",gridTemplateColumns:"1fr 280px 1fr",gap:20,marginBottom:20}}>
        {/* LEFT */}
        <div style={{display:"flex",flexDirection:"column",gap:16}}>
          <Card title="Teaching Performance">
            <div style={{display:"flex",alignItems:"center",gap:16,marginBottom:16}}>
              <div style={{position:"relative",width:64,height:64}}><svg width="64" height="64" viewBox="0 0 64 64"><circle cx="32" cy="32" r="26" fill="none" stroke={T.s2} strokeWidth="6"/><circle cx="32" cy="32" r="26" fill="none" stroke={T.blue} strokeWidth="6" strokeLinecap="round" strokeDasharray={2*Math.PI*26} strokeDashoffset={2*Math.PI*26*(1-avgScore/100)} transform="rotate(-90 32 32)" style={{transition:"stroke-dashoffset 1s"}}/></svg><div style={{position:"absolute",inset:0,display:"flex",alignItems:"center",justifyContent:"center",fontSize:14,fontWeight:700,color:T.blue}}>{avgScore}%</div></div>
              <div><div style={{fontSize:28,fontWeight:800,color:T.ink}}>{avgScore}%</div><div style={{fontSize:11,color:T.ink3}}>Avg Score // {classes.length} classes</div></div>
            </div>
            {[{l:"Pass Rate",v:passRate,c:passRate>=80?T.grn:T.amb},{l:"Attendance",v:attPct??0,c:(attPct??0)>=85?T.grn:T.amb}].map(r=><div key={r.l} style={{marginBottom:10}}><div style={{display:"flex",justifyContent:"space-between",fontSize:11,marginBottom:4}}><span style={{color:T.ink3}}>{r.l}</span><span style={{fontWeight:600,color:r.c}}>{r.v}%</span></div><div style={{height:6,background:T.s1,borderRadius:3,overflow:"hidden"}}><div style={{height:"100%",width:`${r.v}%`,background:r.c,borderRadius:3,transition:"width 1s"}}/></div></div>)}
          </Card>
          <Card title="Subject Breakdown" action={<DLink/>}>
            {subjectData.length>0?(
              <><div style={{height:160,marginBottom:12}}><ResponsiveContainer width="100%" height="100%"><BarChart data={subjectData}><CartesianGrid strokeDasharray="3 3" stroke={T.s2}/><XAxis dataKey="name" tick={{fill:T.ink3,fontSize:9}}/><YAxis tick={{fill:T.ink3,fontSize:9}} domain={[0,100]}/><Tooltip contentStyle={{background:T.white,border:`1px solid ${T.bdr}`,borderRadius:8,fontSize:11}}/><Bar dataKey="avg" fill={T.blue} radius={[4,4,0,0]}/></BarChart></ResponsiveContainer></div>
              {subjectData.map(s=><div key={s.name} style={{display:"flex",alignItems:"center",gap:8,marginBottom:6}}><span style={{fontSize:11,color:T.ink3,width:80,flexShrink:0}}>{s.name}</span><div style={{flex:1,height:6,background:T.s1,borderRadius:3,overflow:"hidden"}}><div style={{height:"100%",width:`${s.avg}%`,background:s.avg>=75?T.blue:s.avg>=50?T.amb:T.red,borderRadius:3}}/></div><span style={{fontSize:12,fontWeight:600,color:s.avg>=75?T.blue:s.avg>=50?T.amb:T.red,width:30,textAlign:"right"}}>{s.avg}</span></div>)}</>
            ):<p style={{fontSize:12,color:T.ink3,textAlign:"center"}}>No subject data</p>}
          </Card>
        </div>

        {/* CENTER */}
        <div style={{display:"flex",flexDirection:"column",alignItems:"center",paddingTop:20}}>
          <div style={{width:140,height:140,borderRadius:"50%",border:`4px solid ${T.blue}`,background:T.blBg,display:"flex",alignItems:"center",justifyContent:"center",marginBottom:16,boxShadow:"0 8px 30px rgba(59,91,219,0.15)"}}><span style={{fontSize:42,fontWeight:800,color:T.blue}}>{initials}</span></div>
          <h2 style={{fontSize:20,fontWeight:700,color:T.ink,textAlign:"center",marginBottom:4}}>{teacher.name}</h2>
          <p style={{fontSize:12,color:T.ink3,textAlign:"center",marginBottom:4}}>{teacher.subject||"—"} Teacher</p>
          <p style={{fontSize:11,color:T.ink3,textAlign:"center",marginBottom:8}}>{teacher.experience||"—"} exp</p>
          <div style={{display:"flex",gap:6,marginBottom:12}}>
            <span style={{padding:"4px 12px",borderRadius:20,background:teacher.status==="Active"?T.glBg:T.alBg,color:teacher.status==="Active"?T.grn:T.amb,fontSize:10,fontWeight:600}}>{teacher.status||"Active"}</span>
            <span style={{padding:"4px 12px",borderRadius:20,background:avgScore>=75?T.glBg:avgScore>=50?T.alBg:T.rlBg,color:avgScore>=75?T.grn:avgScore>=50?T.amb:T.red,fontSize:10,fontWeight:600}}>{avgScore>=75?"Excellent":avgScore>=60?"Good":avgScore>=40?"Average":"Needs Work"}</span>
          </div>
          <div style={{width:"100%",marginTop:8}}>
            {[{l:"Email",v:teacher.email||"—"},{l:"Phone",v:teacher.phone||"—"},{l:"Classes",v:classes.length},{l:"Students",v:studentCount},{l:"Branch",v:teacher.branchName||teacher.branch||"—"}].map(r=>
              <div key={r.l} style={{display:"flex",justifyContent:"space-between",padding:"6px 0",borderBottom:`1px solid ${T.s2}`,fontSize:11}}>
                <span style={{color:T.ink3}}>{r.l}</span><span style={{color:T.ink,fontWeight:500,maxWidth:140,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{r.v}</span>
              </div>
            )}
          </div>
        </div>

        {/* RIGHT */}
        <div style={{display:"flex",flexDirection:"column",gap:16}}>
          <Card title="Assigned Classes" action={<DLink/>}>
            {classes.length===0?<p style={{fontSize:12,color:T.ink3,textAlign:"center"}}>No classes</p>:
              classes.map(c=><div key={c.id} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"8px 0",borderBottom:`1px solid ${T.s2}`}}>
                <div><div style={{fontSize:13,fontWeight:500,color:T.ink}}>{c.name||c.id}</div><div style={{fontSize:10,color:T.ink3,marginTop:2}}>{c.grade||c.section||"—"}</div></div>
              </div>)}
          </Card>
          {vsBranch.length>0&&(
            <Card title="vs Branch Average" action={<DLink/>}>
              {vsBranch.map(v=><div key={v.category} style={{marginBottom:10}}>
                <div style={{display:"flex",justifyContent:"space-between",fontSize:11,marginBottom:4}}><span style={{color:T.ink3}}>{v.category}</span><span style={{fontWeight:600,color:v.teacher>=v.branchAvg?T.grn:T.red}}>{v.teacher} vs {v.branchAvg}</span></div>
                <div style={{display:"flex",gap:4}}>
                  <div style={{flex:1,height:6,background:T.s1,borderRadius:3,overflow:"hidden"}}><div style={{height:"100%",width:`${Math.min(100,v.teacher)}%`,background:T.blue,borderRadius:3}}/></div>
                  <div style={{flex:1,height:6,background:T.s1,borderRadius:3,overflow:"hidden"}}><div style={{height:"100%",width:`${Math.min(100,v.branchAvg)}%`,background:T.ink3,borderRadius:3,opacity:0.5}}/></div>
                </div>
              </div>)}
              <div style={{display:"flex",gap:12,marginTop:8}}>
                <div style={{display:"flex",alignItems:"center",gap:4}}><div style={{width:10,height:4,background:T.blue,borderRadius:2}}/><span style={{fontSize:10,color:T.ink3}}>Teacher</span></div>
                <div style={{display:"flex",alignItems:"center",gap:4}}><div style={{width:10,height:4,background:T.ink3,borderRadius:2,opacity:0.5}}/><span style={{fontSize:10,color:T.ink3}}>Branch Avg</span></div>
              </div>
            </Card>
          )}
          <Card title="Quick Stats">
            {[{icon:BarChart3,l:"AVG SCORE",v:`${avgScore}%`},{icon:Award,l:"PASS RATE",v:`${passRate}%`},{icon:Calendar,l:"ATTENDANCE",v:attPct!=null?`${attPct}%`:"—"},{icon:Users,l:"STUDENTS",v:studentCount},{icon:BookOpen,l:"CLASSES",v:classes.length}].map(item=>
              <div key={item.l} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"8px 0",borderBottom:`1px solid ${T.s2}`}}>
                <div style={{display:"flex",alignItems:"center",gap:8}}><item.icon size={14} color={T.ink3}/><span style={{fontSize:12,color:T.ink3}}>{item.l}</span></div>
                <span style={{fontSize:13,fontWeight:600,color:T.ink}}>{item.v}</span>
              </div>
            )}
          </Card>
        </div>
      </div>

      {/* ═══ PERFORMANCE TIMELINE ═══ */}
      {hasTimeline&&(
        <Card title="Performance Timeline" action={<DLink/>} style={{marginBottom:20}}>
          <div style={{height:200}}><ResponsiveContainer width="100%" height="100%"><AreaChart data={timeline}><defs><linearGradient id="obg1" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor={T.blue} stopOpacity={0.15}/><stop offset="95%" stopColor={T.blue} stopOpacity={0}/></linearGradient><linearGradient id="obg2" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor={T.grn} stopOpacity={0.15}/><stop offset="95%" stopColor={T.grn} stopOpacity={0}/></linearGradient></defs><CartesianGrid strokeDasharray="3 3" stroke={T.s2}/><XAxis dataKey="month" tick={{fill:T.ink3,fontSize:11}}/><YAxis tick={{fill:T.ink3,fontSize:11}} domain={[0,100]}/><Tooltip contentStyle={{background:T.white,border:`1px solid ${T.bdr}`,borderRadius:8,fontSize:12}}/><Area type="monotone" dataKey="score" stroke={T.blue} fill="url(#obg1)" strokeWidth={2.5}/><Area type="monotone" dataKey="passRate" stroke={T.grn} fill="url(#obg2)" strokeWidth={2} strokeDasharray="5 3"/></AreaChart></ResponsiveContainer></div>
        </Card>
      )}

      {/* Status bar */}
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"10px 20px",background:T.white,border:`1px solid ${T.bdr}`,borderRadius:12,fontSize:10,color:T.ink3}}>
        <span>★ TEACHER ID: {(teacher.id||"").slice(0,8).toUpperCase()}</span><span>★ {classes.length} Classes</span><span>★ {studentCount} Students</span><span>★ Score: {avgScore}%</span>
      </div>
    </div>
  );
}