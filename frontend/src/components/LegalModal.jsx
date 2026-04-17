export default function LegalModal() {
  return (
    <div className="modal-backdrop" id="legalModalBackdrop">
      <div className="modal legal-modal">
        <button className="modal-close" id="legalModalClose" aria-label="Close legal information">
          {'\u2715'}
        </button>

        <h2 className="modal-title">Legal Information</h2>
        <p className="modal-sub" style={{ fontWeight: 500 }}>
          Review our policies and legal terms
        </p>

        <div className="legal-tabs" role="tablist" aria-label="Legal sections">
          <button
            type="button"
            className="legal-tab active"
            data-legal-tab="privacy"
            role="tab"
            aria-selected="true"
          >
            Privacy
          </button>
          <button
            type="button"
            className="legal-tab"
            data-legal-tab="terms"
            role="tab"
            aria-selected="false"
          >
            Terms
          </button>
          <button
            type="button"
            className="legal-tab"
            data-legal-tab="cookies"
            role="tab"
            aria-selected="false"
          >
            Cookies
          </button>
          <button
            type="button"
            className="legal-tab"
            data-legal-tab="notice"
            role="tab"
            aria-selected="false"
          >
            Legal Notice
          </button>
        </div>

        <div className="legal-body">
          {/* Privacy Policy */}
          <section
            className="legal-section active"
            id="legalSection-privacy"
            role="tabpanel"
          >
            <h3 className="legal-heading">Privacy Policy</h3>
            <p className="legal-meta">Last updated: April 2026</p>

            <h4 className="legal-subheading">1. Overview</h4>
            <p>
              This dashboard (the "Service") is operated by a volunteer member
              of the Empire of Sindria guild. This Privacy Policy explains what
              information we collect, the legal basis on which we rely, how we
              use it, and the rights you have under the EU General Data
              Protection Regulation (GDPR). By using the Service, you
              acknowledge the practices described here.
            </p>

            <h4 className="legal-subheading">2. Controller</h4>
            <p>
              The data controller responsible for your personal data is:
            </p>
            <ul className="legal-list">
              <li>190Q</li>
              <li>Rue de Laeken 1, 1000 Bruxelles, Belgium</li>
              <li>
                Email: <a href="mailto:esi.dashboard.support@gmail.com">esi.dashboard.support@gmail.com</a>
              </li>
            </ul>
            <p>
              For any privacy-related request (access, correction, deletion,
              etc.) please use the email address above.
            </p>

            <h4 className="legal-subheading">3. Information We Collect</h4>
            <p>When you use the Service, we may collect:</p>
            <ul className="legal-list">
              <li>
                <strong>Discord account data</strong> - if you choose to log
                in, we receive your Discord user ID, username, avatar, and
                guild role membership through Discord's OAuth2 flow.
              </li>
              <li>
                <strong>User preferences</strong> - settings you configure
                (such as default metrics and ranges) are stored in your
                browser's local storage and, if you are logged in, synced to
                our server under your Discord ID.
              </li>
              <li>
                <strong>Technical data</strong> - standard server access logs
                (truncated IP address, user agent, timestamp, request path).
                Full IP addresses are never written to disk: the last octet of
                IPv4 addresses (or the last 80 bits of IPv6 addresses) is
                zeroed before storage.
              </li>
              <li>
                <strong>Public game data</strong> - the Service queries and
                caches publicly available information from the Wynncraft
                public API. No private game data is collected.
              </li>
            </ul>

            <h4 className="legal-subheading">4. Legal Basis for Processing (GDPR Art. 6)</h4>
            <ul className="legal-list">
              <li>
                <strong>Contract (Art. 6(1)(b))</strong> - authenticating your
                Discord session and storing the preferences required to
                provide the dashboard you requested.
              </li>
              <li>
                <strong>Legitimate interest (Art. 6(1)(f))</strong> - keeping
                short-lived, anonymised access logs to detect abuse, prevent
                fraud, and maintain the security and availability of the
                Service. Our legitimate interest is balanced against your
                rights through IP truncation and a short retention period.
              </li>
              <li>
                <strong>Consent (Art. 6(1)(a))</strong> - where you voluntarily
                choose to log in via Discord, you consent to the transmission
                of the OAuth data described above. You may withdraw this
                consent at any time by logging out.
              </li>
            </ul>

            <h4 className="legal-subheading">5. How We Use Information</h4>
            <ul className="legal-list">
              <li>Authenticate users and determine role-based permissions.</li>
              <li>Provide, maintain, and improve the Service.</li>
              <li>Detect and prevent abuse, spam, and security incidents.</li>
              <li>Sync your preferences across devices when you are logged in.</li>
            </ul>

            <h4 className="legal-subheading">6. Third-Party Processors and Recipients</h4>
            <p>
              We do not sell or rent personal data. The Service relies on the
              following third-party providers; using the Service necessarily
              causes some data (in particular your IP address, as part of any
              standard HTTP request) to be transmitted to them:
            </p>
            <ul className="legal-list">
              <li>
                <strong>Discord</strong> (Discord Inc., United States) -
                OAuth2 authentication and guild role lookup. Processes your
                Discord identifiers and the IP from which you authenticate.
              </li>
              <li>
                <strong>Wynncraft public API</strong> (operated by the
                Wynncraft team) - queried server-side by us; no personal data
                about visitors is shared.
              </li>
              <li>
                <strong>Avatar providers</strong> - avatar images
                are embedded directly from <code>cdn.discordapp.com</code>,
                <code> visage.surgeplay.com</code>, <code>crafatar.com</code>,
                and <code>mc-heads.net</code>. When your browser loads these
                images it transmits your IP address and user agent to the
                relevant provider. These providers act as independent
                controllers under their own terms.
              </li>
              <li>
                <strong>Hosting provider</strong> - our server host processes
                incoming requests on our behalf and may briefly log IP
                addresses for operational and anti-abuse purposes.
              </li>
            </ul>
            <p>
              We do not use third-party advertising, analytics, or tracking
              services. Fonts are served from our own server.
            </p>

            <h4 className="legal-subheading">7. International Transfers</h4>
            <p>
              Some of the recipients listed above (notably Discord and the
              Minecraft avatar providers) are located outside the European
              Economic Area, primarily in the United States. Transfers take
              place on the basis of the European Commission's Standard
              Contractual Clauses and/or the EU-US Data Privacy Framework
              where applicable, as published by each provider.
            </p>

            <h4 className="legal-subheading">8. Retention</h4>
            <ul className="legal-list">
              <li>
                <strong>Access logs</strong> - truncated-IP request logs are
                retained for a maximum of 14 days and then permanently
                deleted.
              </li>
              <li>
                <strong>Session cookie</strong> - deleted when you log out or
                when the session expires.
              </li>
              <li>
                <strong>"Remember me" token</strong> - stored for up to 30
                days after last use, then automatically expired and deleted.
              </li>
              <li>
                <strong>Account and preference data</strong> - retained while
                you continue to use the Service. If you do not log in for 12
                months, or on your request, your stored record is deleted.
              </li>
            </ul>

            <h4 className="legal-subheading">9. Your Rights Under GDPR</h4>
            <p>
              Subject to the conditions set out in the GDPR, you have the
              right to:
            </p>
            <ul className="legal-list">
              <li>
                <strong>Access</strong> the personal data we hold about you
                (Art. 15).
              </li>
              <li>
                <strong>Rectify</strong> inaccurate or incomplete data
                (Art. 16).
              </li>
              <li>
                <strong>Erase</strong> your data ("right to be forgotten",
                Art. 17).
              </li>
              <li>
                <strong>Restrict</strong> the processing of your data
                (Art. 18).
              </li>
              <li>
                <strong>Receive</strong> your data in a portable,
                machine-readable format (Art. 20).
              </li>
              <li>
                <strong>Object</strong> to processing based on legitimate
                interest (Art. 21).
              </li>
              <li>
                <strong>Withdraw consent</strong> at any time where
                processing is based on consent, without affecting the
                lawfulness of processing carried out before withdrawal.
              </li>
              <li>
                <strong>Lodge a complaint</strong> with a supervisory
                authority. In Belgium this is the Autorité de protection des
                données / Gegevensbeschermingsautoriteit
                (<a href="https://www.dataprotectionauthority.be" target="_blank" rel="noopener noreferrer">www.dataprotectionauthority.be</a>).
              </li>
            </ul>
            <p>
              To exercise any of these rights, please contact the controller
              using the email address in section 2.
            </p>

            <h4 className="legal-subheading">10. Security</h4>
            <p>
              We apply appropriate technical and organisational measures to
              protect your data, including HTTPS transport, HttpOnly /
              Secure / SameSite session cookies, a strict Content Security
              Policy, limited IP-based abuse controls, and IP truncation for
              logs.
            </p>

            <h4 className="legal-subheading">11. Changes</h4>
            <p>
              We may update this Privacy Policy from time to time. Material
              changes will be announced in the guild's Discord server and the
              "Last updated" date above will be revised.
            </p>
          </section>

          {/* Terms of Service */}
          <section
            className="legal-section"
            id="legalSection-terms"
            role="tabpanel"
            hidden
          >
            <h3 className="legal-heading">Terms of Service</h3>
            <p className="legal-meta">Last updated: April 2026</p>

            <h4 className="legal-subheading">1. Acceptance</h4>
            <p>
              By accessing or using this dashboard, you agree to be bound by
              these Terms of Service. If you do not agree, do not use the
              Service.
            </p>

            <h4 className="legal-subheading">2. The Service</h4>
            <p>
              The Service is a fan-made tool provided "as is" for the
              convenience of Empire of Sindria guild members and interested
              community members. It is provided free of charge, without any
              warranty of availability, accuracy, or fitness for a particular
              purpose.
            </p>

            <h4 className="legal-subheading">3. Acceptable Use</h4>
            <p>You agree not to:</p>
            <ul className="legal-list">
              <li>
                Attempt to gain unauthorized access to any part of the Service
                or its underlying systems.
              </li>
              <li>
                Probe, scan, or test the vulnerability of the Service without
                permission.
              </li>
              <li>
                Interfere with the Service through denial-of-service attacks,
                excessive scraping, or similar means.
              </li>
              <li>Use the Service to harass, abuse, or impersonate others.</li>
            </ul>

            <h4 className="legal-subheading">4. Third-Party Content</h4>
            <p>
              The Service displays data from Wynncraft's public API. We are not
              responsible for the accuracy, completeness, or availability of
              third-party data.
            </p>

            <h4 className="legal-subheading">5. Limitation of Liability</h4>
            <p>
              To the fullest extent permitted by law, the maintainers shall not
              be liable for any indirect, incidental, special, consequential,
              or punitive damages arising from your use of the Service.
            </p>

            <h4 className="legal-subheading">6. Termination</h4>
            <p>
              We may suspend or terminate access for any user who violates these
              Terms, at our sole discretion, without notice.
            </p>

            <h4 className="legal-subheading">7. Governing Terms</h4>
            <p>
              These Terms are governed by the laws of Belgium. Disputes will be
              resolved informally through the guild's support channels where
              possible, and otherwise by the competent courts of Brussels,
              Belgium.
            </p>
          </section>

          {/* Cookie Policy */}
          <section
            className="legal-section"
            id="legalSection-cookies"
            role="tabpanel"
            hidden
          >
            <h3 className="legal-heading">Cookie Policy</h3>
            <p className="legal-meta">Last updated: April 2026</p>

            <h4 className="legal-subheading">1. What We Use</h4>
            <p>
              The Service uses a small number of cookies and browser storage
              items. All of them are strictly necessary for the dashboard to
              function; we do not set advertising or analytics cookies.
            </p>

            <h4 className="legal-subheading">2. Categories</h4>
            <ul className="legal-list">
              <li>
                <strong>Session cookie</strong> - set after you log in with
                Discord; identifies your browser session so you remain logged
                in between page loads. HttpOnly, Secure, SameSite=Lax.
                Cleared on logout or when the session expires.
              </li>
              <li>
                <strong>"Remember me" cookie (<code>esi_remember</code>)</strong>
                {' '}- set after login so you do not have to re-authenticate on
                every visit. HttpOnly, Secure, SameSite=Lax. Lifetime: up to
                30 days from last use; cleared on logout.
              </li>
              <li>
                <strong>CSRF / security tokens</strong> - used to protect
                authenticated requests against cross-site request forgery.
              </li>
              <li>
                <strong>Local storage</strong> - stores your dashboard
                preferences (such as sidebar state, default metric, and
                graph range) on your device. Never transmitted to third
                parties.
              </li>
            </ul>

            <h4 className="legal-subheading">3. Third-Party Cookies</h4>
            <p>
              We do not use advertising or analytics cookies. Logging in via
              Discord may involve cookies set by Discord on their own domain;
              those are governed by Discord's privacy policy. Images loaded
              from Minecraft avatar providers (<code>cdn.discordapp.com</code>,
              <code> visage.surgeplay.com</code>, <code>crafatar.com</code>,
              <code> mc-heads.net</code>) do not set cookies on this site but
              may expose your IP address to those providers.
            </p>

            <h4 className="legal-subheading">4. Managing Cookies</h4>
            <p>
              You can clear cookies and local storage through your browser
              settings at any time. Doing so will log you out and reset your
              local preferences.
            </p>
          </section>

          {/* Legal Notice / Imprint */}
          <section
            className="legal-section"
            id="legalSection-notice"
            role="tabpanel"
            hidden
          >
            <h3 className="legal-heading">Legal Notice</h3>
            <p className="legal-meta">Last updated: April 2026</p>

            <h4 className="legal-subheading">Operator / Responsible Person</h4>
            <p>
              This Service is operated as a non-commercial, community-run
              project by:
            </p>
            <ul className="legal-list">
              <li><strong>190Q</strong></li>
              <li>Rue de Laeken 1, 1000 Bruxelles, Belgium</li>
              <li>
                Email: <a href="mailto:esi.dashboard.support@gmail.com">esi.dashboard.support@gmail.com</a>
              </li>
            </ul>
            <p>
              The operator is also the data controller within the meaning of
              Article 4(7) GDPR.
            </p>

            <h4 className="legal-subheading">Contact</h4>
            <p>
              For any inquiry (legal, privacy, technical, or otherwise),
              please reach out by email at the address above. You may also
              open an issue on our GitHub repository using the support button
              at the top of the page.
            </p>

            <h4 className="legal-subheading">Disclaimer of Affiliation</h4>
            <p>
              This project is a fan-made tool. It is not affiliated with,
              endorsed by, sponsored by, or specifically approved by Wynncraft,
              Mojang Studios, Microsoft Corporation, or any of their
              subsidiaries or affiliates. All trademarks, logos, and brand
              names are the property of their respective owners and are used
              here for identification purposes only.
            </p>

            <h4 className="legal-subheading">Content Liability</h4>
            <p>
              Data displayed on the dashboard is aggregated from public
              sources, primarily the official Wynncraft API. While we strive
              for accuracy, we cannot guarantee that information is always
              current or error-free.
            </p>

            <h4 className="legal-subheading">External Links</h4>
            <p>
              The Service contains links to external websites (Discord,
              GitHub). We have no control over the content of those sites and
              accept no responsibility for them.
            </p>

            <h4 className="legal-subheading">Open Source</h4>
            <p>
              The source code for this project is available on GitHub under
              the license specified in the repository. Contributions are
              welcome.
            </p>
          </section>
        </div>
      </div>
    </div>
  )
}
