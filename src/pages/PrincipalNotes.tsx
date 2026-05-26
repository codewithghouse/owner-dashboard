/**
 * Owner Dashboard — Principal Notes
 *
 * Centralised inbox + composer for owner ↔ principal communication.
 * Reads/writes the `owner_to_principal_notes` collection (the same one the
 * Fee Defaulter "Notify" flow writes to) so an owner can see the full
 * history with each branch principal in one chat thread, plus send new
 * notes (including replies to fee-defaulter notifications already there).
 *
 * Surface:
 *   • Left panel  — list of principals (scoped to owner.uid as schoolId)
 *   • Right panel — chat thread with the selected principal + composer
 *
 * Loop-safe: the writer stamps `ownerUid: auth.uid` so a principal viewing
 * their inbox can filter by ownerUid and never see another owner's notes.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import {
  collection, query, where, onSnapshot, addDoc, serverTimestamp,
  doc, updateDoc, orderBy,
} from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import { useIsMobile } from "@/hooks/use-mobile";
import { toast } from "sonner";
import {
  Send, Loader2, MessageSquare, Search, Mail, ShieldCheck, ChevronLeft,
  CheckCheck,
} from "lucide-react";

interface PrincipalRow {
  id: string;
  name: string;
  email: string;
  branchName?: string;
  branchId?: string;
}

interface NoteDoc {
  id: string;
  principalId?: string;
  principalEmail?: string;
  principalName?: string;
  ownerUid?: string;
  branchName?: string;
  subject?: string;
  message?: string;
  content?: string;
  createdAt?: { toMillis?: () => number; toDate?: () => Date };
  status?: string;
  read?: boolean;
  from?: "owner" | "principal";
  type?: string;
}

const PrincipalNotes = () => {
  const isMobile = useIsMobile();
  const [principals, setPrincipals] = useState<PrincipalRow[]>([]);
  const [notes, setNotes] = useState<NoteDoc[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [composeText, setComposeText] = useState("");
  const [sending, setSending] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [loadingPrincipals, setLoadingPrincipals] = useState(true);
  const [loadingNotes, setLoadingNotes] = useState(true);
  const chatEndRef = useRef<HTMLDivElement>(null);

  const uid = auth.currentUser?.uid;

  // ── 1. Load principals scoped to this owner ────────────────────────────
  useEffect(() => {
    if (!uid) return;
    const q = query(collection(db, "principals"), where("schoolId", "==", uid));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const rows: PrincipalRow[] = snap.docs.map(d => {
          const data = d.data() as any;
          return {
            id: d.id,
            name: (data.name || "").trim() || "Principal",
            email: (data.email || "").trim() || "",
            branchName: (data.branchName || data.branch || "").toString().trim(),
            branchId: (data.branchId || "").toString(),
          };
        });
        rows.sort((a, b) => a.name.localeCompare(b.name));
        setPrincipals(rows);
        setLoadingPrincipals(false);
      },
      (err) => {
        console.error("[PrincipalNotes] principals listener failed", err);
        toast.error("Could not load principals.");
        setLoadingPrincipals(false);
      },
    );
    return () => unsub();
  }, [uid]);

  // ── 2. Load all owner_to_principal_notes for this owner ───────────────
  useEffect(() => {
    if (!uid) return;
    const q = query(
      collection(db, "owner_to_principal_notes"),
      where("ownerUid", "==", uid),
      orderBy("createdAt", "asc"),
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        const docs: NoteDoc[] = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
        setNotes(docs);
        setLoadingNotes(false);
      },
      (err) => {
        // orderBy may need an index; fall back to no-orderBy query so the
        // page still works while the index is being built.
        console.warn("[PrincipalNotes] orderBy listener failed (retry without orderBy)", err);
        const fallback = query(
          collection(db, "owner_to_principal_notes"),
          where("ownerUid", "==", uid),
        );
        const unsub2 = onSnapshot(
          fallback,
          (s) => {
            const docs: NoteDoc[] = s.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
            docs.sort((a, b) => (a.createdAt?.toMillis?.() || 0) - (b.createdAt?.toMillis?.() || 0));
            setNotes(docs);
            setLoadingNotes(false);
          },
          (e) => {
            console.error("[PrincipalNotes] fallback listener failed", e);
            toast.error("Could not load notes history.");
            setLoadingNotes(false);
          },
        );
        // Replace the cleanup by chaining
        (unsub as unknown as { fallback?: () => void }).fallback = unsub2;
      },
    );
    return () => {
      unsub();
      const f = (unsub as unknown as { fallback?: () => void }).fallback;
      if (f) f();
    };
  }, [uid]);

  // ── Derived: principal list with last-msg + unread count ──────────────
  const principalList = useMemo(() => {
    const noteByPrincipal = new Map<string, NoteDoc[]>();
    notes.forEach(n => {
      const pid = n.principalId;
      if (!pid) return;
      const arr = noteByPrincipal.get(pid) || [];
      arr.push(n);
      noteByPrincipal.set(pid, arr);
    });
    const list = principals.map(p => {
      const arr = noteByPrincipal.get(p.id) || [];
      const last = arr[arr.length - 1];
      const unread = arr.filter(n => n.from === "principal" && n.read !== true).length;
      return {
        ...p,
        lastMessage: last,
        unread,
        threadLength: arr.length,
      };
    });
    list.sort((a, b) => {
      // Sort by most-recent activity then by name
      const ta = a.lastMessage?.createdAt?.toMillis?.() || 0;
      const tb = b.lastMessage?.createdAt?.toMillis?.() || 0;
      if (ta !== tb) return tb - ta;
      return a.name.localeCompare(b.name);
    });
    return list.filter(p =>
      !searchQuery.trim() ||
      p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (p.branchName || "").toLowerCase().includes(searchQuery.toLowerCase()),
    );
  }, [principals, notes, searchQuery]);

  const selectedPrincipal = principalList.find(p => p.id === selectedId)
    ?? principals.find(p => p.id === selectedId)
    ?? null;

  const threadNotes = useMemo(() => {
    if (!selectedId) return [];
    return notes
      .filter(n => n.principalId === selectedId)
      .sort((a, b) => (a.createdAt?.toMillis?.() || 0) - (b.createdAt?.toMillis?.() || 0));
  }, [notes, selectedId]);

  // Stats for the page header
  const totalNotes = notes.length;
  const totalUnread = notes.filter(n => n.from === "principal" && n.read !== true).length;

  // Auto-scroll on new messages
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [threadNotes.length, selectedId]);

  // Mark principal's notes as read once thread opens
  const markedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!selectedId) return;
    threadNotes.forEach(n => {
      if (n.from === "principal" && n.read !== true && !markedRef.current.has(n.id)) {
        markedRef.current.add(n.id);
        updateDoc(doc(db, "owner_to_principal_notes", n.id), { read: true })
          .catch(err => {
            markedRef.current.delete(n.id);
            console.warn("[PrincipalNotes] mark-as-read failed", err);
          });
      }
    });
  }, [selectedId, threadNotes]);

  const handleSend = async () => {
    if (!uid) { toast.error("Not authenticated."); return; }
    if (!selectedPrincipal) { toast.error("Select a principal first."); return; }
    const content = composeText.trim();
    if (!content) return;
    setSending(true);
    setComposeText("");
    try {
      await addDoc(collection(db, "owner_to_principal_notes"), {
        schoolId: uid,
        ownerUid: uid,
        principalId: selectedPrincipal.id,
        principalEmail: selectedPrincipal.email,
        principalName: selectedPrincipal.name,
        branchId: selectedPrincipal.branchId || "",
        branchName: selectedPrincipal.branchName || "",
        type: "owner_message",
        subject: `Note from Owner`,
        message: content,
        content,
        from: "owner",
        status: "unread",
        read: false,
        createdAt: serverTimestamp(),
        _lastModifiedAt: serverTimestamp(),
        _lastModifiedBy: uid,
      });
    } catch (err) {
      console.error("[PrincipalNotes] send failed", err);
      toast.error("Couldn't send. Please try again.");
      setComposeText(content);
    } finally {
      setSending(false);
    }
  };

  const fmtTime = (ts: NoteDoc["createdAt"]): string => {
    try {
      const d = ts?.toDate?.();
      if (!d) return "";
      return d.toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
    } catch { return ""; }
  };

  // ── Tokens (Blue Apple, consistent with rest of owner dashboard) ──────
  const T = {
    B1: "#0055FF", B2: "#1166FF",
    BG: "#EEF4FF", SURFACE: "#F4F7FE", CARD: "#FFFFFF",
    T1: "#001040", T3: "#5070B0", T4: "#99AACC",
    BDR: "0.5px solid rgba(0,85,255,0.10)",
    SH: "0 0 0 0.5px rgba(0,85,255,0.08), 0 2px 8px rgba(0,85,255,0.09), 0 10px 28px rgba(0,85,255,0.11)",
    SH_BTN: "0 6px 22px rgba(0,85,255,0.42), 0 2px 6px rgba(0,85,255,0.22)",
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18, padding: 0 }}>
      {/* ── Header ── */}
      <div style={{
        background: "linear-gradient(135deg, #001A4D 0%, #0033CC 55%, #0055FF 100%)",
        borderRadius: 24, padding: "26px 30px", color: "#fff",
        boxShadow: "0 14px 38px rgba(0,8,40,0.30)", position: "relative", overflow: "hidden",
      }}>
        <div style={{
          position: "absolute", top: -40, right: -40, width: 240, height: 240,
          borderRadius: "50%",
          background: "radial-gradient(circle, rgba(255,255,255,0.12) 0%, transparent 65%)",
          pointerEvents: "none",
        }} />
        <div style={{ position: "relative", zIndex: 1, display: "flex", alignItems: "center", gap: 16 }}>
          <div style={{
            width: 54, height: 54, borderRadius: 16,
            background: "rgba(255,255,255,0.18)",
            border: "1px solid rgba(255,255,255,0.28)",
            display: "flex", alignItems: "center", justifyContent: "center",
            flexShrink: 0,
          }}>
            <MessageSquare size={26} color="#fff" strokeWidth={2.2} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase", color: "rgba(255,255,255,0.78)", marginBottom: 4 }}>
              Owner ↔ Principal Communication
            </div>
            <h1 style={{ fontSize: 24, fontWeight: 800, letterSpacing: "-0.4px", margin: 0 }}>Principal Notes</h1>
            <p style={{ fontSize: 13, color: "rgba(255,255,255,0.85)", margin: "4px 0 0", lineHeight: 1.5 }}>
              {totalNotes} note{totalNotes === 1 ? "" : "s"} across {principals.length} principal{principals.length === 1 ? "" : "s"}
              {totalUnread > 0 ? ` · ${totalUnread} unread` : ""}
            </p>
          </div>
        </div>
      </div>

      {/* ── Two-panel chat layout ──
          Desktop: side-by-side (list 320px | chat 1fr).
          Mobile: single column, toggle between list and chat based on
          whether a principal is selected. The chat header already has a
          ChevronLeft back button that clears selectedId, so going back
          to the list works out of the box. */}
      <div style={{
        display: "grid",
        gridTemplateColumns: isMobile ? "1fr" : "320px 1fr",
        gap: isMobile ? 0 : 16,
        minHeight: "calc(100vh - 240px)",
      }}>

        {/* Left — principal list */}
        <div style={{
          background: T.CARD, borderRadius: 18, border: T.BDR, boxShadow: T.SH,
          display: (isMobile && selectedPrincipal) ? "none" : "flex",
          flexDirection: "column", overflow: "hidden",
        }}>
          <div style={{ padding: "14px 14px 10px", borderBottom: T.BDR }}>
            <div style={{ position: "relative" }}>
              <Search size={14} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "rgba(0,85,255,0.45)" }} strokeWidth={2.4} />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search principals or branches"
                style={{
                  width: "100%",
                  padding: "9px 12px 9px 34px",
                  borderRadius: 12,
                  border: "0.5px solid rgba(0,85,255,0.16)",
                  background: T.SURFACE,
                  fontSize: 12, fontWeight: 500, color: T.T1,
                  outline: "none",
                  fontFamily: "inherit",
                }}
              />
            </div>
          </div>
          <div style={{ flex: 1, overflowY: "auto", padding: "8px 8px 16px" }}>
            {loadingPrincipals ? (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: 30 }}>
                <Loader2 size={20} className="animate-spin" color={T.B1} />
              </div>
            ) : principalList.length === 0 ? (
              <div style={{ padding: "30px 16px", textAlign: "center", color: T.T3, fontSize: 12 }}>
                {principals.length === 0
                  ? "No principals onboarded yet. Add one in Principal Management."
                  : "No matches for your search."}
              </div>
            ) : (
              principalList.map(p => {
                const active = selectedId === p.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setSelectedId(p.id)}
                    style={{
                      width: "100%",
                      display: "flex", alignItems: "center", gap: 10,
                      padding: "10px 12px",
                      marginBottom: 4,
                      borderRadius: 12,
                      background: active ? "rgba(0,85,255,0.10)" : "transparent",
                      border: active ? "0.5px solid rgba(0,85,255,0.22)" : "0.5px solid transparent",
                      cursor: "pointer",
                      fontFamily: "inherit",
                      textAlign: "left",
                      transition: "background 160ms ease",
                    }}
                  >
                    <div style={{
                      width: 36, height: 36, borderRadius: 10,
                      background: `linear-gradient(135deg, ${T.B1}, ${T.B2})`,
                      color: "#fff",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      fontWeight: 800, fontSize: 12, letterSpacing: 0.5,
                      flexShrink: 0,
                    }}>
                      {(p.name || "P").slice(0, 2).toUpperCase()}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <span style={{ fontSize: 13, fontWeight: 700, color: T.T1, letterSpacing: "-0.2px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, minWidth: 0 }}>
                          {p.name}
                        </span>
                        {p.unread > 0 && (
                          <span style={{
                            background: "#FF3355", color: "#fff",
                            borderRadius: 999, minWidth: 18, height: 18,
                            display: "inline-flex", alignItems: "center", justifyContent: "center",
                            fontSize: 10, fontWeight: 800, padding: "0 5px",
                            flexShrink: 0,
                          }}>{p.unread}</span>
                        )}
                      </div>
                      <div style={{ fontSize: 11, color: T.T3, marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {p.branchName || "—"} · {p.threadLength} note{p.threadLength === 1 ? "" : "s"}
                      </div>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* Right — chat thread (hidden on mobile until a principal is selected). */}
        <div style={{
          background: T.CARD, borderRadius: 18, border: T.BDR, boxShadow: T.SH,
          display: (isMobile && !selectedPrincipal) ? "none" : "flex",
          flexDirection: "column", overflow: "hidden", minWidth: 0,
        }}>
          {!selectedPrincipal ? (
            <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 40, textAlign: "center", color: T.T3 }}>
              <div style={{
                width: 80, height: 80, borderRadius: 24,
                background: "rgba(0,85,255,0.08)",
                display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 16,
              }}>
                <MessageSquare size={36} color={T.B1} strokeWidth={1.8} />
              </div>
              <div style={{ fontSize: 16, fontWeight: 800, color: T.T1, marginBottom: 6, letterSpacing: "-0.2px" }}>
                Select a principal
              </div>
              <div style={{ fontSize: 13, maxWidth: 320, lineHeight: 1.5 }}>
                Pick a principal from the list to see your conversation history and send a new note. Notes you send here are also routed to their email.
              </div>
            </div>
          ) : (
            <>
              {/* Chat header */}
              <div style={{
                padding: "14px 18px", borderBottom: T.BDR,
                display: "flex", alignItems: "center", gap: 12,
                background: T.SURFACE,
              }}>
                <button
                  type="button"
                  onClick={() => setSelectedId(null)}
                  style={{
                    width: 32, height: 32, borderRadius: 10, border: "none", background: "rgba(0,85,255,0.08)",
                    display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer",
                  }}
                  aria-label="Back to list"
                >
                  <ChevronLeft size={16} color={T.B1} strokeWidth={2.4} />
                </button>
                <div style={{
                  width: 40, height: 40, borderRadius: 12,
                  background: `linear-gradient(135deg, ${T.B1}, ${T.B2})`,
                  color: "#fff",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontWeight: 800, fontSize: 13,
                  flexShrink: 0,
                }}>
                  {(selectedPrincipal.name || "P").slice(0, 2).toUpperCase()}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 15, fontWeight: 800, color: T.T1, letterSpacing: "-0.2px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {selectedPrincipal.name}
                  </div>
                  <div style={{ fontSize: 11, color: T.T3, display: "flex", alignItems: "center", gap: 6, marginTop: 2 }}>
                    <ShieldCheck size={11} color={T.B1} strokeWidth={2.4} />
                    {selectedPrincipal.branchName || "—"}
                    {selectedPrincipal.email && (
                      <>
                        <span style={{ width: 3, height: 3, borderRadius: "50%", background: T.T4 }} />
                        <Mail size={11} color={T.T3} strokeWidth={2.4} />
                        {selectedPrincipal.email}
                      </>
                    )}
                  </div>
                </div>
              </div>

              {/* Messages */}
              <div style={{
                flex: 1, overflowY: "auto", padding: "20px 22px",
                background: T.BG,
                display: "flex", flexDirection: "column", gap: 10,
              }}>
                {loadingNotes ? (
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: 40 }}>
                    <Loader2 size={20} className="animate-spin" color={T.B1} />
                  </div>
                ) : threadNotes.length === 0 ? (
                  <div style={{ textAlign: "center", padding: "50px 20px", color: T.T3, fontSize: 13 }}>
                    No notes yet with this principal. Start the conversation below.
                  </div>
                ) : (
                  threadNotes.map(n => {
                    const isOwner = n.from === "owner" || !n.from;
                    return (
                      <div key={n.id} style={{
                        display: "flex",
                        justifyContent: isOwner ? "flex-end" : "flex-start",
                      }}>
                        <div style={{
                          maxWidth: "70%", minWidth: 80,
                          padding: "10px 14px 8px",
                          borderRadius: 14,
                          borderTopLeftRadius: isOwner ? 14 : 4,
                          borderTopRightRadius: isOwner ? 4 : 14,
                          background: isOwner
                            ? "linear-gradient(135deg, #0055FF, #2277FF)"
                            : T.CARD,
                          color: isOwner ? "#fff" : T.T1,
                          boxShadow: isOwner
                            ? "0 2px 8px rgba(0,85,255,0.22)"
                            : "0 1px 2px rgba(11,20,26,0.06), 0 0 0 0.5px rgba(0,85,255,0.06)",
                        }}>
                          {n.subject && n.subject !== "Note from Owner" && (
                            <div style={{
                              fontSize: 10, fontWeight: 800, letterSpacing: "0.08em",
                              textTransform: "uppercase",
                              color: isOwner ? "rgba(255,255,255,0.78)" : T.T3,
                              marginBottom: 4,
                            }}>
                              {n.subject}
                            </div>
                          )}
                          <div style={{
                            fontSize: 13.5, lineHeight: 1.5, fontWeight: 500,
                            whiteSpace: "pre-wrap", wordBreak: "break-word",
                            color: isOwner ? "#fff" : T.T1,
                          }}>
                            {n.message || n.content || ""}
                          </div>
                          <div style={{
                            fontSize: 10, fontWeight: 500,
                            color: isOwner ? "rgba(255,255,255,0.78)" : T.T4,
                            marginTop: 4,
                            display: "flex", alignItems: "center", gap: 4,
                            justifyContent: "flex-end",
                          }}>
                            {fmtTime(n.createdAt)}
                            {isOwner && <CheckCheck size={12} strokeWidth={2.4} />}
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
                <div ref={chatEndRef} />
              </div>

              {/* Composer */}
              <div style={{
                padding: "12px 16px", borderTop: T.BDR, background: T.SURFACE,
                display: "flex", alignItems: "center", gap: 10,
              }}>
                <input
                  type="text"
                  value={composeText}
                  onChange={(e) => setComposeText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      handleSend();
                    }
                  }}
                  placeholder={`Message ${selectedPrincipal.name}…`}
                  disabled={sending}
                  style={{
                    flex: 1, minWidth: 0,
                    height: 42, padding: "0 16px", lineHeight: "42px",
                    borderRadius: 14,
                    border: "0.5px solid rgba(0,85,255,0.18)",
                    background: "#fff",
                    boxShadow: "inset 0 0 0 0.5px rgba(0,85,255,0.04)",
                    fontSize: 13.5, color: T.T1,
                    fontFamily: "inherit", outline: "none",
                    boxSizing: "border-box",
                  }}
                />
                <button
                  type="button"
                  onClick={handleSend}
                  disabled={sending || !composeText.trim()}
                  style={{
                    width: 44, height: 44, borderRadius: "50%",
                    background: composeText.trim() && !sending
                      ? "linear-gradient(135deg, #0055FF, #1166FF)"
                      : "rgba(0,85,255,0.25)",
                    border: "none",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    cursor: composeText.trim() && !sending ? "pointer" : "default",
                    flexShrink: 0,
                    boxShadow: composeText.trim() && !sending ? T.SH_BTN : "none",
                    transition: "background 160ms ease",
                  }}
                  aria-label="Send"
                >
                  {sending ? (
                    <Loader2 size={18} color="#fff" className="animate-spin" />
                  ) : (
                    <Send size={18} color="#fff" strokeWidth={2.4} />
                  )}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default PrincipalNotes;
