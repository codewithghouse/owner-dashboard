/**
 * Privacy Policy — public route (no auth required).
 *
 * Required for Google Play Store TWA submission. Must be reachable via a
 * direct URL link. The Play Console DataSafety form references this page.
 *
 * Last revised: 2026-05-20. Update the `LAST_UPDATED` constant whenever the
 * substantive policy changes (not just typos).
 */
const LAST_UPDATED = "2026-05-20";

export default function PrivacyPolicy() {
  return (
    <div
      style={{
        fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
        background: "#EEF4FF",
        minHeight: "100vh",
        padding: "48px 20px",
      }}
    >
      <div
        style={{
          maxWidth: 760,
          margin: "0 auto",
          background: "#fff",
          borderRadius: 16,
          padding: "40px 36px",
          boxShadow: "0 1px 2px rgba(0,0,0,0.04), 0 8px 32px rgba(0,16,64,0.06)",
          border: "0.5px solid rgba(0,16,64,0.08)",
          color: "#0F172A",
          lineHeight: 1.7,
        }}
      >
        <a
          href="/"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            color: "#1e3a8a",
            fontSize: 13,
            fontWeight: 600,
            textDecoration: "none",
            marginBottom: 24,
          }}
        >
          ← Back to Edullent
        </a>

        <h1 style={{ fontSize: 28, fontWeight: 800, marginBottom: 8, color: "#001040" }}>
          Privacy Policy
        </h1>
        <p style={{ color: "#64748B", fontSize: 13, marginBottom: 32 }}>
          Last updated: {LAST_UPDATED}
        </p>

        <Section title="Who we are">
          Edullent is a school management SaaS operated by the Edullent team
          (contact: <a href="mailto:edullentofficial@gmail.com">edullentofficial@gmail.com</a>).
          This policy describes how the <strong>Owner Dashboard</strong> (web app
          and Play Store TWA) collects, uses, and protects information.
        </Section>

        <Section title="What we collect">
          We collect the following information so the dashboard can function:
          <ul>
            <li>
              <strong>Account data</strong> from the user signing in: email
              address, display name, profile photo URL (when signing in with
              Google), and Firebase Authentication user id.
            </li>
            <li>
              <strong>School data</strong> entered by school owners, principals,
              teachers, and staff: school + branch names, addresses, student
              records (name, grade, attendance, marks, behavioral notes), teacher
              records (name, contact, subject, performance metrics), parent
              contact details, financial entries (fees, invoices, ledgers), and
              uploaded documents (timetables, exam papers, scanned answer sheets).
            </li>
            <li>
              <strong>Usage signals</strong> needed for app integrity: device type
              (mobile/desktop heuristic), timestamps of writes, audit log entries
              (who changed what, when), and PWA install/update events.
            </li>
            <li>
              <strong>Optional content</strong> sent via support tickets: free-text
              issue descriptions and screenshots the user attaches.
            </li>
          </ul>
          We do <strong>not</strong> collect: precise location, device contact
          lists, microphone or camera streams, browsing history outside this app,
          or financial card numbers (payments, when added, are processed by a PCI-
          compliant external processor — see "Third parties" below).
        </Section>

        <Section title="Why we collect it">
          <ul>
            <li>To render the dashboards and reports for which the user logged in.</li>
            <li>To enforce per-tenant security boundaries (we only show one school's data to that school's authorized users).</li>
            <li>To audit changes for accountability (Edullent surfaces an audit log to school owners).</li>
            <li>To send invitation, reset, and report-share emails when an action requires it.</li>
            <li>To respond to support requests.</li>
            <li>To improve product reliability via crash and performance metrics (aggregate, non-identifying).</li>
          </ul>
          We do <strong>not</strong> sell personal data, share it with advertisers, or
          use it to train external AI models. AI features ship summaries to OpenAI's
          API for inference only; data is not retained by OpenAI for training (per
          OpenAI's enterprise terms).
        </Section>

        <Section title="Where it lives">
          <ul>
            <li>
              <strong>Google Firebase (Firestore, Cloud Storage, Authentication,
              App Check)</strong> — primary database and auth. Data resides in Google
              Cloud's <code>asia-south1</code> region by default. Firebase is
              subject to Google's Cloud Privacy Notice.
            </li>
            <li>
              <strong>Vercel</strong> — serverless edge that hosts the web app +
              `/api/*` Vercel functions. No persistent customer data is stored at
              Vercel; functions are stateless.
            </li>
            <li>
              <strong>OpenAI</strong> — receives prompts containing aggregated /
              de-identified context when the user invokes AI features (e.g., AI
              Predictor, Concept Mastery summaries). No raw student PII is sent
              by design — student data is summarised first.
            </li>
            <li>
              <strong>Resend</strong> — sends transactional email (invitations,
              report shares). Receives only the recipient address + email body we
              construct.
            </li>
          </ul>
        </Section>

        <Section title="Who can see your data">
          Access is strictly scoped per-school via Firestore security rules. Within
          a school:
          <ul>
            <li>Owners see all branches + all student / teacher / financial data.</li>
            <li>Principals see their assigned branch only.</li>
            <li>Teachers see their assigned classes only.</li>
            <li>Parents see only their own child's records.</li>
          </ul>
          Edullent staff cannot read your school's records unless you explicitly
          file a support ticket with attachments — and even then, access is
          minimised and logged.
        </Section>

        <Section title="Retention">
          Active school data is retained for the lifetime of the subscription.
          When a school deletes their account, the records are soft-deleted for
          30 days (recovery window) and then hard-deleted from Firestore + Cloud
          Storage within 60 days. Backup snapshots roll off within 90 days.
          Audit logs are retained for 2 years for compliance.
        </Section>

        <Section title="Children's data">
          Edullent handles records of students under 18 ("children's data") at
          schools' direction. Schools are the controllers; Edullent is the
          processor. Per applicable law (India: DPDP Act; EU: GDPR Art. 8 if
          ever deployed there), schools must obtain parental consent before
          enrolling minors. Edullent does not market to or directly engage with
          children; the parent-portal app is the only child-facing surface and
          is read-only.
        </Section>

        <Section title="Security">
          <ul>
            <li>All traffic is HTTPS only (HSTS preload).</li>
            <li>Firebase App Check (reCAPTCHA v3) blocks abuse from non-app callers.</li>
            <li>Authentication uses Firebase ID tokens; sessions expire and refresh automatically.</li>
            <li>Server-side keys (Resend, OpenAI, etc.) are stored in Vercel env vars; never bundled in the client.</li>
            <li>Content Security Policy headers limit script + connect sources.</li>
          </ul>
          Despite this, no online service is 100% secure. Notify
          <a href="mailto:edullentofficial@gmail.com"> edullentofficial@gmail.com</a>
          immediately if you suspect a breach.
        </Section>

        <Section title="Your rights">
          You may request: access, correction, export, or deletion of your data
          by emailing <a href="mailto:edullentofficial@gmail.com">edullentofficial@gmail.com</a>
          from the address associated with your account. We respond within 30
          days. Schools may self-serve most of these via the dashboard (Settings).
          For full account deletion (account credentials + school records),
          use the self-serve form at{" "}
          <a href="/delete-account"><strong>edullent.com/delete-account</strong></a>{" "}
          — requests are processed within 7 business days.
        </Section>

        <Section title="Changes">
          We may revise this policy. Material changes will be notified inside the
          app at least 14 days before they take effect. The "Last updated" date
          at the top always reflects the latest revision.
        </Section>

        <Section title="Contact">
          Edullent · <a href="mailto:edullentofficial@gmail.com">edullentofficial@gmail.com</a>
        </Section>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: 28 }}>
      <h2 style={{ fontSize: 17, fontWeight: 800, marginBottom: 10, color: "#001040" }}>{title}</h2>
      <div style={{ fontSize: 14, color: "#334155" }}>{children}</div>
    </section>
  );
}
