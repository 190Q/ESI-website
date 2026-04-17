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
              This dashboard (the "Service") is operated by volunteer members of
              the Empire of Sindria guild. This Privacy Policy explains what
              information we collect, how we use it, and the choices you have.
              By using the Service, you agree to the practices described here.
            </p>

            <h4 className="legal-subheading">2. Information We Collect</h4>
            <p>When you use the Service, we may collect:</p>
            <ul className="legal-list">
              <li>
                <strong>Discord account data</strong> - if you choose to log in,
                we receive your Discord user ID, username, avatar, and guild
                role membership through Discord's OAuth2 flow.
              </li>
              <li>
                <strong>User preferences</strong> - settings you configure (such
                as default metrics and ranges) are stored in your browser's
                local storage and, if you are logged in, synced to our server
                under your Discord ID.
              </li>
              <li>
                <strong>Technical data</strong> - standard server access logs
                (IP address, user agent, timestamp, request path) are retained
                for a limited period for security, abuse prevention, and
                debugging.
              </li>
              <li>
                <strong>Public game data</strong> - the Service queries and
                caches publicly available information from the Wynncraft public
                API. No private game data is collected.
              </li>
            </ul>

            <h4 className="legal-subheading">3. How We Use Information</h4>
            <p>We use collected information to:</p>
            <ul className="legal-list">
              <li>Authenticate users and determine role-based permissions.</li>
              <li>Provide, maintain, and improve the Service.</li>
              <li>Detect and prevent abuse, spam, and security incidents.</li>
              <li>Sync your preferences across devices when you are logged in.</li>
            </ul>

            <h4 className="legal-subheading">4. Sharing</h4>
            <p>
              We do not sell or rent personal data. We do not share data with
              third parties except as required to operate the Service (for
              example, Discord for authentication) or when required by law.
            </p>

            <h4 className="legal-subheading">5. Retention</h4>
            <p>
              Access logs are retained for a short period (typically no more
              than 90 days). Account and preference data are retained while you
              continue to use the Service and may be removed on request.
            </p>

            <h4 className="legal-subheading">6. Your Rights</h4>
            <p>
              You may log out at any time to end your session. You can request
              deletion of your stored preferences and account data by contacting
              the maintainers through the support channel.
            </p>

            <h4 className="legal-subheading">7. Changes</h4>
            <p>
              We may update this Privacy Policy from time to time. Material
              changes will be announced in the guild's Discord server.
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
              These Terms are governed by the laws applicable to the
              maintainers' jurisdiction. Disputes will be resolved informally
              through the guild's support channels where possible.
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
              items that are strictly necessary for the dashboard to function.
            </p>

            <h4 className="legal-subheading">2. Categories</h4>
            <ul className="legal-list">
              <li>
                <strong>Session cookie</strong> - set after you log in with
                Discord; identifies your session so you remain logged in
                between page loads. Cleared on logout.
              </li>
              <li>
                <strong>CSRF / security tokens</strong> - used to protect
                authenticated requests against cross-site forgery.
              </li>
              <li>
                <strong>Local storage</strong> - stores your dashboard
                preferences (such as sidebar state, default metric, and
                graph range) on your device.
              </li>
            </ul>

            <h4 className="legal-subheading">3. Third-Party Cookies</h4>
            <p>
              We do not use advertising or analytics cookies. Logging in via
              Discord may involve cookies set by Discord on their own domain;
              those are governed by Discord's privacy policy.
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

            <h4 className="legal-subheading">Operator</h4>
            <p>
              This Service is operated by volunteer members of the Empire of
              Sindria Wynncraft guild. It is a non-commercial, community-run
              project and generates no revenue.
            </p>

            <h4 className="legal-subheading">Contact</h4>
            <p>
              For inquiries, please reach out through our Discord server or by
              opening an issue on our GitHub repository using the support
              button at the top of the page.
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
              The source code for this project is available on GitHub under the
              license specified in the repository. Contributions are welcome.
            </p>
          </section>
        </div>
      </div>
    </div>
  )
}
