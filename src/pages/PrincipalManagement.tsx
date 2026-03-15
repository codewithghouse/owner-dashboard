import { useState, useEffect } from "react";
import {
  UserPlus, Users, CheckCircle2, Clock, Mail, MoreVertical,
  Building2, Search, X, Send, Shield, RefreshCcw, Ban,
  ChevronRight, AlertTriangle, Phone, MapPin, Calendar,
  Plus, Edit3, Trash2, Globe, Hash, Loader2
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { db, auth } from "@/lib/firebase";
import { 
  collection, addDoc, onSnapshot, query, 
  where, serverTimestamp, getDoc, doc 
} from "firebase/firestore";
import { sendInvitationEmail } from "@/lib/resend";
import { toast } from "sonner";

// Constant options remains same
const branchColorOptions = [
  '#1e3a8a', '#3b82f6', '#22c55e', '#10b981', '#f59e0b', '#f97316',
  '#ef4444', '#ec4899', '#8b5cf6', '#6366f1', '#14b8a6', '#06b6d4',
];

export default function PrincipalManagement() {
  const [activeTab, setActiveTab] = useState<'principals' | 'branches'>('branches');
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [showAddBranchModal, setShowAddBranchModal] = useState(false);
  const [selectedPrincipal, setSelectedPrincipal] = useState<any>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [inviteForm, setInviteForm] = useState({ name: '', email: '', branch: '', branchColor: '#1e3a8a' });
  const [branchForm, setBranchForm] = useState({ name: '', location: '', color: '#3b82f6' });
  const [showActionMenu, setShowActionMenu] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  
  // Real Source Data
  const [branches, setBranches] = useState<any[]>([]);
  const [principals, setPrincipals] = useState<any[]>([]);
  const [schoolInfo, setSchoolInfo] = useState<any>(null);

  useEffect(() => {
    if (!auth.currentUser) return;

    // Fetch School Name for Emails
    const fetchSchool = async () => {
      const docSnap = await getDoc(doc(db, "schools", auth.currentUser!.uid));
      if (docSnap.exists()) setSchoolInfo(docSnap.data());
    };
    fetchSchool();

    // Sync Branches
    const branchesRef = collection(db, "schools", auth.currentUser.uid, "branches");
    const unsubscribeBranches = onSnapshot(branchesRef, (snapshot) => {
      const branchList = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setBranches(branchList);
    });

    // Sync Principals (from a top-level collection or subcollection?)
    // Let's use a root 'principals' collection filtered by schoolId for easier cross-portal access
    const principalsRef = collection(db, "principals");
    const q = query(principalsRef, where("schoolId", "==", auth.currentUser.uid));
    const unsubscribePrincipals = onSnapshot(q, (snapshot) => {
      const principalList = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setPrincipals(principalList);
    });

    return () => {
      unsubscribeBranches();
      unsubscribePrincipals();
    };
  }, []);

  const handleAddBranch = async () => {
    if (!branchForm.name || !branchForm.location || !auth.currentUser) return;
    setLoading(true);
    try {
      await addDoc(collection(db, "schools", auth.currentUser.uid, "branches"), {
        ...branchForm,
        students: 0,
        teachers: 0,
        status: 'Active',
        ahi: 0, // Initial Academic Health Index
        feeCollection: 0,
        passRate: 0,
        attendance: 0,
        established: new Date().getFullYear().toString(),
        createdAt: serverTimestamp()
      });
      toast.success("Branch added successfully!");
      setShowAddBranchModal(false);
      setBranchForm({ name: '', location: '', color: '#3b82f6' });
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleInvitePrincipal = async () => {
    if (!inviteForm.email || !inviteForm.branch || !auth.currentUser) return;
    setLoading(true);
    try {
      // 1. Save to Whitelist in Firestore
      await addDoc(collection(db, "principals"), {
        ...inviteForm,
        schoolId: auth.currentUser.uid,
        schoolName: schoolInfo?.schoolName || "Your School",
        status: 'Invited',
        avatar: inviteForm.name.substring(0, 2).toUpperCase(),
        joinDate: new Date().toLocaleDateString(),
        lastActive: 'Never',
        studentsManaged: 0,
        teachersManaged: 0,
        createdAt: serverTimestamp()
      });

      // 2. Send Real Email via Resend
      const emailRes = await sendInvitationEmail({
        to: inviteForm.email,
        name: inviteForm.name,
        branch: inviteForm.branch,
        schoolName: schoolInfo?.schoolName || "Our School"
      });

      if (emailRes.success) {
        toast.success(`Invitation sent to ${inviteForm.email}!`);
      } else {
        toast.error("Whitelisted, but email failed to send. Please check API Key.");
      }

      setShowInviteModal(false);
      setInviteForm({ name: '', email: '', branch: '', branchColor: '#1e3a8a' });
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  const filteredPrincipals = principals.filter(p =>
    p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    p.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
    p.branch.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const filteredBranches = branches.filter(b =>
    b.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    b.location.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const getStatusConfig = (status: string) => {
    switch(status) {
      case 'Active': return { bg: 'bg-emerald-50', text: 'text-emerald-600', border: 'border-emerald-100', dot: 'bg-emerald-500' };
      case 'Invited': return { bg: 'bg-amber-50', text: 'text-amber-600', border: 'border-amber-100', dot: 'bg-amber-500' };
      case 'Upcoming': return { bg: 'bg-blue-50', text: 'text-blue-600', border: 'border-blue-100', dot: 'bg-blue-500' };
      case 'Planned': return { bg: 'bg-purple-50', text: 'text-purple-600', border: 'border-purple-100', dot: 'bg-purple-500' };
      case 'Deactivated': return { bg: 'bg-slate-50', text: 'text-slate-400', border: 'border-slate-100', dot: 'bg-slate-300' };
      default: return { bg: 'bg-slate-50', text: 'text-slate-400', border: 'border-slate-100', dot: 'bg-slate-300' };
    }
  };

  return (
    <div className="space-y-10 max-w-[1600px] mx-auto animate-in fade-in duration-500 pb-10">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold text-[#111827] tracking-tight">Management Console</h1>
          <p className="text-slate-400 font-medium text-sm">Manage branches & assign principals to control dashboard access</p>
        </div>
        <div className="flex items-center gap-3">
          <Button
            onClick={() => setShowAddBranchModal(true)}
            variant="outline"
            className="h-12 rounded-xl px-6 border-slate-200 font-bold text-sm text-slate-600 hover:bg-slate-50 flex items-center gap-2"
          >
            <Building2 className="w-4 h-4" /> Add Branch
          </Button>
          <Button
            onClick={() => setShowInviteModal(true)}
            className="bg-[#1e294b] hover:bg-[#1e3a8a] text-white font-bold h-12 rounded-xl px-8 shadow-lg shadow-blue-900/10 flex items-center gap-2"
          >
            <UserPlus className="w-4 h-4" /> Invite Principal
          </Button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-5">
        {[
          { label: "Total Branches", value: branches.length.toString(), note: `${branches.filter(b => b.status === 'Active').length} active`, col: "text-blue-500" },
          { label: "Total Principals", value: principals.length.toString(), note: "Across network", col: "text-slate-400" },
          { label: "Active Principals", value: principals.filter(p => p.status === 'Active').length.toString(), note: "Currently managing", col: "text-emerald-500" },
          { label: "Pending Invites", value: principals.filter(p => p.status === 'Invited').length.toString(), note: "Awaiting acceptance", col: "text-amber-500" },
          { label: "Unassigned", value: branches.filter(b => !principals.find(p => p.branch === b.name && p.status === 'Active')).length.toString(), note: "Branches need principal", col: "text-rose-500" },
        ].map((stat, i) => (
          <div key={i} className="bg-white p-7 rounded-[1.8rem] border border-slate-100 shadow-sm transition-all hover:shadow-md">
            <p className="text-slate-400 text-[10px] font-black uppercase tracking-tight mb-3">{stat.label}</p>
            <h3 className="text-3xl font-extrabold text-[#111827] tracking-tighter mb-1.5">{stat.value}</h3>
            <p className={`text-[11px] font-bold ${stat.col}`}>{stat.note}</p>
          </div>
        ))}
      </div>

      {/* Tab Switcher */}
      <div className="flex items-center gap-3">
        {[
          { key: 'branches', label: 'Branches', icon: Building2 },
          { key: 'principals', label: 'Principals', icon: Users },
        ].map(tab => (
          <button
            key={tab.key}
            onClick={() => { setActiveTab(tab.key as any); setSearchQuery(''); }}
            className={`flex items-center gap-2 px-7 py-3 rounded-xl text-sm font-bold transition-all ${
              activeTab === tab.key ? 'bg-[#1e3a8a] text-white shadow-lg shadow-blue-900/10' : 'bg-white text-slate-500 border border-slate-100 hover:bg-slate-50'
            }`}
          >
            <tab.icon className="w-4 h-4" /> {tab.label}
          </button>
        ))}
      </div>

      {/* Search Bar */}
      <div className="relative">
        <Search className="absolute left-5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
        <Input
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="h-14 pl-14 pr-6 bg-white border-slate-100 rounded-2xl shadow-sm focus:ring-blue-900/5 transition-all text-sm font-medium"
          placeholder={activeTab === 'principals' ? "Search principals by name, email, or branch..." : "Search branches by name or location..."}
        />
      </div>

      {/* ==================== BRANCHES TAB ==================== */}
      {activeTab === 'branches' && (
        <>
          {/* Branches Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredBranches.map(branch => {
              const assignedPrincipal = principals.find(p => p.branch === branch.name && (p.status === 'Active' || p.status === 'Invited'));
              const statusConf = getStatusConfig(branch.status);
              return (
                <div key={branch.id} className="bg-white rounded-[2rem] border border-slate-100 shadow-sm overflow-hidden transition-all hover:shadow-lg group">
                  {/* Branch Header Strip */}
                  <div className="h-2" style={{ backgroundColor: branch.color }}></div>
                  <div className="p-8">
                    {/* Top Row */}
                    <div className="flex items-center justify-between mb-6">
                      <div className="flex items-center gap-4">
                        <div className="w-14 h-14 rounded-2xl flex items-center justify-center text-white shadow-lg shrink-0" style={{ backgroundColor: branch.color }}>
                          <Building2 className="w-7 h-7" />
                        </div>
                        <div>
                          <h3 className="text-lg font-bold text-[#111827] group-hover:text-blue-600 transition-colors">{branch.name}</h3>
                          <p className="text-xs text-slate-400 font-medium flex items-center gap-1.5 mt-0.5">
                            <MapPin className="w-3 h-3" /> {branch.location}
                          </p>
                        </div>
                      </div>
                      <span className={`px-3 py-1 rounded-lg text-[9px] font-black uppercase tracking-widest ${statusConf.bg} ${statusConf.text} ${statusConf.border} border`}>
                        {branch.status}
                      </span>
                    </div>

                    {/* Stats */}
                    <div className="grid grid-cols-3 gap-3 mb-6">
                      <div className="bg-[#f8fafc] border border-slate-50 p-4 rounded-xl text-center">
                        <p className="text-xl font-black text-[#111827] tracking-tighter">{branch.students.toLocaleString()}</p>
                        <p className="text-[10px] font-bold text-slate-400 uppercase mt-1">Students</p>
                      </div>
                      <div className="bg-[#f8fafc] border border-slate-50 p-4 rounded-xl text-center">
                        <p className="text-xl font-black text-[#111827] tracking-tighter">{branch.teachers}</p>
                        <p className="text-[10px] font-bold text-slate-400 uppercase mt-1">Teachers</p>
                      </div>
                      <div className="bg-[#f8fafc] border border-slate-50 p-4 rounded-xl text-center">
                        <p className="text-xl font-black text-[#111827] tracking-tighter">{branch.established}</p>
                        <p className="text-[10px] font-bold text-slate-400 uppercase mt-1">Est.</p>
                      </div>
                    </div>

                    {/* Assigned Principal */}
                    <div className={`p-4 rounded-2xl border ${assignedPrincipal ? 'bg-[#f0fdf4] border-emerald-100' : 'bg-[#fef2f2] border-rose-100'}`}>
                      {assignedPrincipal ? (
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <div className="w-9 h-9 rounded-xl flex items-center justify-center text-white font-bold text-[10px] shadow-sm" style={{ backgroundColor: branch.color }}>
                              {assignedPrincipal.avatar}
                            </div>
                            <div>
                              <p className="text-sm font-bold text-[#111827]">{assignedPrincipal.name}</p>
                              <p className="text-[10px] text-slate-400 font-medium">{assignedPrincipal.email}</p>
                            </div>
                          </div>
                          <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-[9px] font-black uppercase tracking-widest ${getStatusConfig(assignedPrincipal.status).bg} ${getStatusConfig(assignedPrincipal.status).text}`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${getStatusConfig(assignedPrincipal.status).dot}`}></span>
                            {assignedPrincipal.status}
                          </span>
                        </div>
                      ) : (
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <AlertTriangle className="w-5 h-5 text-rose-400" />
                            <div>
                              <p className="text-sm font-bold text-rose-600">No Principal Assigned</p>
                              <p className="text-[10px] text-rose-400 font-medium">Dashboard access disabled</p>
                            </div>
                          </div>
                          <button
                            onClick={() => setShowInviteModal(true)}
                            className="px-4 py-1.5 rounded-lg bg-rose-500 text-white text-[10px] font-black uppercase tracking-widest hover:bg-rose-600 transition-colors"
                          >
                            Assign
                          </button>
                        </div>
                      )}
                    </div>

                    {/* Branch Actions */}
                    <div className="flex items-center gap-2 mt-5">
                      <button className="flex-1 flex items-center justify-center gap-2 p-3 rounded-xl border border-slate-100 bg-[#f8fafc] hover:bg-white hover:shadow-md transition-all text-xs font-bold text-slate-500">
                        <Edit3 className="w-3.5 h-3.5" /> Edit
                      </button>
                      <button className="flex-1 flex items-center justify-center gap-2 p-3 rounded-xl border border-slate-100 bg-[#f8fafc] hover:bg-white hover:shadow-md transition-all text-xs font-bold text-slate-500">
                        <Users className="w-3.5 h-3.5" /> Manage
                      </button>
                      {branch.status !== 'Active' && (
                        <button className="p-3 rounded-xl border border-rose-100 bg-[#fef2f2] hover:bg-rose-50 transition-all text-xs font-bold text-rose-400">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}

            {/* Add New Branch Card */}
            <button
              onClick={() => setShowAddBranchModal(true)}
              className="bg-white rounded-[2rem] border-2 border-dashed border-slate-200 p-8 flex flex-col items-center justify-center gap-4 text-slate-400 hover:border-blue-300 hover:text-blue-500 hover:bg-blue-50/30 transition-all min-h-[350px] group"
            >
              <div className="w-16 h-16 rounded-2xl bg-slate-50 border border-slate-100 flex items-center justify-center group-hover:bg-blue-100 group-hover:border-blue-200 transition-all">
                <Plus className="w-8 h-8" />
              </div>
              <div className="text-center">
                <p className="text-base font-bold">Add New Branch</p>
                <p className="text-xs font-medium mt-1">Create and setup a new school branch</p>
              </div>
            </button>
          </div>

          {/* Access Flow Info */}
          <div className="bg-[#1e294b] rounded-[2rem] p-10 text-white shadow-xl overflow-hidden relative">
            <div className="absolute top-0 right-0 w-72 h-72 bg-blue-500/10 rounded-full -translate-y-1/2 translate-x-1/2"></div>
            <div className="relative z-10">
              <h3 className="text-xl font-bold mb-3 tracking-tight">How Dashboard Access Works</h3>
              <p className="text-blue-200/60 text-sm mb-8 max-w-2xl leading-relaxed font-medium">Principals can only access their dashboard after being invited and assigned to a branch by you. Here's the flow:</p>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                {[
                  { step: '1', title: 'Create Branch', desc: 'Add a new school branch with location details' },
                  { step: '2', title: 'Invite Principal', desc: 'Send email invitation to the principal' },
                  { step: '3', title: 'Assign to Branch', desc: 'Link the principal to their branch' },
                  { step: '4', title: 'Access Granted', desc: 'Principal can now login & manage their dashboard' },
                ].map((s, i) => (
                  <div key={i} className="bg-white/5 border border-white/10 p-6 rounded-2xl">
                    <div className="w-10 h-10 rounded-xl bg-blue-500/20 flex items-center justify-center text-blue-300 font-black text-sm mb-4">{s.step}</div>
                    <h4 className="text-sm font-bold text-white mb-1">{s.title}</h4>
                    <p className="text-[11px] text-blue-200/50 font-medium leading-relaxed">{s.desc}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </>
      )}

      {/* ==================== PRINCIPALS TAB ==================== */}
      {activeTab === 'principals' && (
        <>
          {/* Principals Table */}
          <div className="bg-white rounded-[2.5rem] border border-slate-100 shadow-sm overflow-hidden">
            <div className="p-10 border-b border-slate-50 flex items-center justify-between">
              <h3 className="text-xl font-bold text-[#111827]">All Principals</h3>
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                <span className="text-[11px] font-bold text-slate-400 uppercase tracking-widest">Live status</span>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left min-w-[1100px]">
                <thead>
                  <tr className="bg-slate-50/50">
                    {["Principal", "Branch", "Email", "Status", "Joined", "Actions"].map(h => (
                      <th key={h} className="py-6 px-10 text-[11px] font-black text-slate-400 uppercase tracking-[0.2em]">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {filteredPrincipals.map((p) => {
                    const statusConfig = getStatusConfig(p.status);
                    return (
                      <tr key={p.id} className="hover:bg-slate-50/30 transition-colors group cursor-pointer" onClick={() => setSelectedPrincipal(p)}>
                        <td className="py-7 px-10">
                          <div className="flex items-center gap-4">
                            <div className="w-12 h-12 rounded-2xl flex items-center justify-center text-white font-bold text-xs shadow-lg shrink-0" style={{ backgroundColor: p.branchColor }}>
                              {p.avatar}
                            </div>
                            <div>
                              <p className="font-bold text-[#111827] text-[15px] tracking-tight group-hover:text-blue-600 transition-colors">{p.name}</p>
                              <p className="text-slate-400 text-xs font-medium">ID: {p.id}</p>
                            </div>
                          </div>
                        </td>
                        <td className="py-7 px-10">
                          <div className="flex items-center gap-2">
                            <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: p.branchColor }}></div>
                            <span className="text-sm font-bold text-slate-600">{p.branch}</span>
                          </div>
                        </td>
                        <td className="py-7 px-10 text-slate-500 font-medium text-[13px]">{p.email}</td>
                        <td className="py-7 px-10">
                          <span className={`inline-flex items-center gap-2 px-4 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest ${statusConfig.bg} ${statusConfig.text} ${statusConfig.border} border`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${statusConfig.dot}`}></span>
                            {p.status}
                          </span>
                        </td>
                        <td className="py-7 px-10 text-slate-500 font-medium text-[13px]">{p.joinDate}</td>
                        <td className="py-7 px-10">
                          <div className="relative">
                            <button onClick={(e) => { e.stopPropagation(); setShowActionMenu(showActionMenu === p.id ? null : p.id); }} className="p-2 rounded-xl hover:bg-slate-50 text-slate-400 transition-colors">
                              <MoreVertical className="w-4 h-4" />
                            </button>
                            {showActionMenu === p.id && (
                              <div className="absolute right-0 top-10 z-20 w-52 bg-white rounded-2xl border border-slate-100 shadow-2xl shadow-slate-900/10 py-3 animate-in slide-in-from-top-2 duration-200">
                                {p.status === 'Invited' && (
                                  <button className="w-full flex items-center gap-3 px-5 py-3 text-sm font-bold text-slate-600 hover:bg-blue-50 hover:text-blue-600 transition-colors">
                                    <RefreshCcw className="w-4 h-4" /> Resend Invite
                                  </button>
                                )}
                                <button className="w-full flex items-center gap-3 px-5 py-3 text-sm font-bold text-slate-600 hover:bg-blue-50 hover:text-blue-600 transition-colors">
                                  <Building2 className="w-4 h-4" /> Reassign Branch
                                </button>
                                <button className="w-full flex items-center gap-3 px-5 py-3 text-sm font-bold text-slate-600 hover:bg-blue-50 hover:text-blue-600 transition-colors">
                                  <Mail className="w-4 h-4" /> Send Message
                                </button>
                                <div className="border-t border-slate-50 mx-3 my-1"></div>
                                <button className="w-full flex items-center gap-3 px-5 py-3 text-sm font-bold text-rose-500 hover:bg-rose-50 transition-colors">
                                  <Ban className="w-4 h-4" /> {p.status === 'Deactivated' ? 'Reactivate' : 'Deactivate'}
                                </button>
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* ==================== ADD BRANCH MODAL ==================== */}
      {showAddBranchModal && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-300">
          <div className="bg-white rounded-[2.5rem] w-full max-w-lg shadow-2xl animate-in zoom-in-95 duration-300 overflow-hidden">
            <div className="p-8 border-b border-slate-50 flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-2xl bg-emerald-500 flex items-center justify-center text-white shadow-lg">
                  <Building2 className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-xl font-bold text-[#111827]">Add New Branch</h3>
                  <p className="text-slate-400 text-xs font-medium">Create a new school branch</p>
                </div>
              </div>
              <button onClick={() => setShowAddBranchModal(false)} className="p-2 rounded-xl hover:bg-slate-50 text-slate-400 transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-8 space-y-6">
              <div>
                <label className="text-[11px] font-black text-slate-400 uppercase tracking-widest mb-3 block">Branch Name</label>
                <Input
                  value={branchForm.name}
                  onChange={(e) => setBranchForm({ ...branchForm, name: e.target.value })}
                  className="h-14 bg-[#f8fafc] border-slate-100 rounded-2xl text-sm font-medium focus:ring-blue-900/5"
                  placeholder="e.g. West Branch"
                />
              </div>
              <div>
                <label className="text-[11px] font-black text-slate-400 uppercase tracking-widest mb-3 block">Location / Address</label>
                <Input
                  value={branchForm.location}
                  onChange={(e) => setBranchForm({ ...branchForm, location: e.target.value })}
                  className="h-14 bg-[#f8fafc] border-slate-100 rounded-2xl text-sm font-medium focus:ring-blue-900/5"
                  placeholder="e.g. Bandra West, Mumbai"
                />
              </div>
              <div>
                <label className="text-[11px] font-black text-slate-400 uppercase tracking-widest mb-3 block">Branch Color</label>
                <div className="flex flex-wrap gap-3">
                  {branchColorOptions.map((color) => (
                    <button
                      key={color}
                      onClick={() => setBranchForm({ ...branchForm, color })}
                      className={`w-10 h-10 rounded-xl transition-all ${branchForm.color === color ? 'ring-4 ring-offset-2 ring-blue-200 scale-110' : 'hover:scale-105'}`}
                      style={{ backgroundColor: color }}
                    />
                  ))}
                </div>
              </div>

              {/* Preview */}
              <div className="bg-[#f8fafc] border border-slate-100 p-6 rounded-2xl">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-4">Preview</p>
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-2xl flex items-center justify-center text-white shadow-lg" style={{ backgroundColor: branchForm.color }}>
                    <Building2 className="w-6 h-6" />
                  </div>
                  <div>
                    <p className="text-base font-bold text-[#111827]">{branchForm.name || 'Branch Name'}</p>
                    <p className="text-xs text-slate-400 font-medium">{branchForm.location || 'Location'}</p>
                  </div>
                </div>
              </div>
            </div>

            <div className="p-8 border-t border-slate-50 flex items-center justify-between gap-4">
              <Button variant="outline" onClick={() => setShowAddBranchModal(false)} className="h-12 px-6 rounded-xl border-slate-200 text-sm font-bold">
                Cancel
              </Button>
              <Button
                disabled={loading}
                onClick={handleAddBranch}
                className="h-12 px-8 rounded-xl bg-emerald-500 text-white text-sm font-bold hover:bg-emerald-600 shadow-lg flex items-center gap-2"
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Create Branch
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ==================== INVITE PRINCIPAL MODAL ==================== */}
      {showInviteModal && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-300">
          <div className="bg-white rounded-[2.5rem] w-full max-w-lg shadow-2xl animate-in zoom-in-95 duration-300 overflow-hidden max-h-[90vh] overflow-y-auto">
            <div className="p-8 border-b border-slate-50 flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-2xl bg-[#1e3a8a] flex items-center justify-center text-white shadow-lg">
                  <UserPlus className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-xl font-bold text-[#111827]">Invite Principal</h3>
                  <p className="text-slate-400 text-xs font-medium">Send an email invitation & assign branch</p>
                </div>
              </div>
              <button onClick={() => setShowInviteModal(false)} className="p-2 rounded-xl hover:bg-slate-50 text-slate-400 transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-8 space-y-6">
              <div>
                <label className="text-[11px] font-black text-slate-400 uppercase tracking-widest mb-3 block">Full Name</label>
                <Input
                  value={inviteForm.name}
                  onChange={(e) => setInviteForm({ ...inviteForm, name: e.target.value })}
                  className="h-14 bg-[#f8fafc] border-slate-100 rounded-2xl text-sm font-medium focus:ring-blue-900/5"
                  placeholder="e.g. Dr. Kavitha Reddy"
                />
              </div>
              <div>
                <label className="text-[11px] font-black text-slate-400 uppercase tracking-widest mb-3 block">Email Address</label>
                <Input
                  type="email"
                  value={inviteForm.email}
                  onChange={(e) => setInviteForm({ ...inviteForm, email: e.target.value })}
                  className="h-14 bg-[#f8fafc] border-slate-100 rounded-2xl text-sm font-medium focus:ring-blue-900/5"
                  placeholder="e.g. principal@example.com"
                />
              </div>
              <div>
                <label className="text-[11px] font-black text-slate-400 uppercase tracking-widest mb-3 block">Assign to Branch</label>
                <div className="grid grid-cols-1 gap-3">
                  {branches.map((branch, i) => (
                    <button
                      key={i}
                      onClick={() => setInviteForm({ ...inviteForm, branch: branch.name, branchColor: branch.color })}
                      className={`flex items-center gap-4 p-4 rounded-2xl border transition-all text-left ${
                        inviteForm.branch === branch.name
                          ? 'border-blue-300 bg-blue-50/50 shadow-sm'
                          : 'border-slate-100 bg-[#f8fafc] hover:bg-white hover:border-slate-200'
                      }`}
                    >
                      <div className="w-8 h-8 rounded-lg flex items-center justify-center text-white shadow-sm" style={{ backgroundColor: branch.color }}>
                        <Building2 className="w-4 h-4" />
                      </div>
                      <div className="flex-1">
                        <span className="text-sm font-bold text-[#111827]">{branch.name}</span>
                        <p className="text-[10px] text-slate-400 font-medium">{branch.location}</p>
                      </div>
                      {inviteForm.branch === branch.name && (
                        <CheckCircle2 className="w-4 h-4 text-blue-500" />
                      )}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="p-8 border-t border-slate-50 flex items-center justify-between gap-4">
              <Button variant="outline" onClick={() => setShowInviteModal(false)} className="h-12 px-6 rounded-xl border-slate-200 text-sm font-bold">
                Cancel
              </Button>
              <Button
                disabled={loading}
                onClick={handleInvitePrincipal}
                className="h-12 px-8 rounded-xl bg-[#1e294b] text-white text-sm font-bold hover:bg-[#1e3a8a] shadow-lg flex items-center gap-2"
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />} Send Invitation
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ==================== PRINCIPAL DETAIL MODAL ==================== */}
      {selectedPrincipal && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-300">
          <div className="bg-white rounded-[2.5rem] w-full max-w-2xl shadow-2xl animate-in zoom-in-95 duration-300 overflow-hidden max-h-[90vh] overflow-y-auto">
            <div className="p-8 border-b border-slate-50 flex items-center justify-between">
              <div className="flex items-center gap-5">
                <div className="w-16 h-16 rounded-2xl flex items-center justify-center text-white font-bold text-lg shadow-xl" style={{ backgroundColor: selectedPrincipal.branchColor }}>
                  {selectedPrincipal.avatar}
                </div>
                <div>
                  <h3 className="text-2xl font-bold text-[#111827] tracking-tight">{selectedPrincipal.name}</h3>
                  <p className="text-slate-400 text-sm font-medium mt-1">Principal  •  {selectedPrincipal.branch}</p>
                </div>
              </div>
              <button onClick={() => setSelectedPrincipal(null)} className="p-2 rounded-xl hover:bg-slate-50 text-slate-400 transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-8 space-y-8">
              <div className="grid grid-cols-2 gap-5">
                <div className="bg-[#f8fafc] border border-slate-100 p-5 rounded-2xl">
                  <p className="text-slate-400 text-[10px] font-black uppercase tracking-widest mb-2">Status</p>
                  {(() => {
                    const sc = getStatusConfig(selectedPrincipal.status);
                    return (
                      <span className={`inline-flex items-center gap-2 px-4 py-1.5 rounded-lg text-[11px] font-black uppercase tracking-widest ${sc.bg} ${sc.text} ${sc.border} border`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${sc.dot}`}></span>
                        {selectedPrincipal.status}
                      </span>
                    );
                  })()}
                </div>
                <div className="bg-[#f8fafc] border border-slate-100 p-5 rounded-2xl">
                  <p className="text-slate-400 text-[10px] font-black uppercase tracking-widest mb-2">Last Active</p>
                  <p className="text-sm font-bold text-[#111827]">{selectedPrincipal.lastActive}</p>
                </div>
              </div>

              <div className="space-y-4">
                <h4 className="text-sm font-bold text-slate-400 uppercase tracking-widest">Contact Information</h4>
                <div className="space-y-3">
                  <div className="flex items-center gap-4 p-4 rounded-2xl bg-[#f8fafc] border border-slate-100">
                    <Mail className="w-5 h-5 text-slate-400" />
                    <span className="text-sm font-bold text-[#111827]">{selectedPrincipal.email}</span>
                  </div>
                  {selectedPrincipal.phone && (
                    <div className="flex items-center gap-4 p-4 rounded-2xl bg-[#f8fafc] border border-slate-100">
                      <Phone className="w-5 h-5 text-slate-400" />
                      <span className="text-sm font-bold text-[#111827]">{selectedPrincipal.phone}</span>
                    </div>
                  )}
                  <div className="flex items-center gap-4 p-4 rounded-2xl bg-[#f8fafc] border border-slate-100">
                    <Calendar className="w-5 h-5 text-slate-400" />
                    <span className="text-sm font-bold text-[#111827]">{selectedPrincipal.joinDate}</span>
                  </div>
                </div>
              </div>

              {selectedPrincipal.status === 'Active' && (
                <div className="space-y-4">
                  <h4 className="text-sm font-bold text-slate-400 uppercase tracking-widest">Branch Overview</h4>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="p-6 rounded-2xl border border-slate-100 bg-[#f0fdf4] text-center">
                      <p className="text-3xl font-black text-[#111827] tracking-tighter">{selectedPrincipal.studentsManaged.toLocaleString()}</p>
                      <p className="text-xs font-bold text-emerald-600 mt-2">Students Managed</p>
                    </div>
                    <div className="p-6 rounded-2xl border border-slate-100 bg-[#eff6ff] text-center">
                      <p className="text-3xl font-black text-[#111827] tracking-tighter">{selectedPrincipal.teachersManaged}</p>
                      <p className="text-xs font-bold text-blue-600 mt-2">Teachers Managed</p>
                    </div>
                  </div>
                </div>
              )}

              <div className="space-y-3">
                <h4 className="text-sm font-bold text-slate-400 uppercase tracking-widest">Quick Actions</h4>
                <div className="grid grid-cols-2 gap-3">
                  <button className="flex items-center gap-3 p-4 rounded-2xl border border-slate-100 bg-[#f8fafc] hover:bg-white hover:shadow-lg transition-all text-sm font-bold text-slate-600">
                    <Mail className="w-4 h-4 text-blue-500" /> Send Email
                  </button>
                  <button className="flex items-center gap-3 p-4 rounded-2xl border border-slate-100 bg-[#f8fafc] hover:bg-white hover:shadow-lg transition-all text-sm font-bold text-slate-600">
                    <Building2 className="w-4 h-4 text-amber-500" /> Reassign Branch
                  </button>
                  <button className="flex items-center gap-3 p-4 rounded-2xl border border-slate-100 bg-[#f8fafc] hover:bg-white hover:shadow-lg transition-all text-sm font-bold text-slate-600">
                    <Shield className="w-4 h-4 text-emerald-500" /> Edit Permissions
                  </button>
                  <button className="flex items-center gap-3 p-4 rounded-2xl border border-rose-100 bg-[#fef2f2]/50 hover:bg-white hover:shadow-lg transition-all text-sm font-bold text-rose-500">
                    <Ban className="w-4 h-4" /> {selectedPrincipal.status === 'Deactivated' ? 'Reactivate' : 'Deactivate'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
