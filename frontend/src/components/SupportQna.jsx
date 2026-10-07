const QNA_SECTIONS = [
  {
    title: 'Getting started & login',
    items: [
      {
        q: 'Do I need an account to use the dashboard?',
        a: (
          <p>
            No. Player Stats, Guild Stats, the Bot Panel, Events and browsing
            the Shop are open to everyone. You only need to log in to buy
            things, sign up for events, or use any management panel.
          </p>
        ),
      },
      {
        q: 'How do I log in?',
        a: (
          <p>
            Click <strong>Login with Discord</strong> in the top-right. We use
            Discord OAuth2 — we never see your Discord password, only your user
            ID, username, avatar, and your roles in the ESI server.
          </p>
        ),
      },
      {
        q: 'Which Discord account should I use?',
        a: (
          <p>
            The one linked to your guild membership. Your site permissions come
            from your Discord roles, so the wrong account means the wrong
            access.
          </p>
        ),
      },
      {
        q: "I'm logged in but don't see the management panels.",
        a: (
          <p>
            Those are gated by role. If the section isn't there, your Discord
            roles don't grant it — see <strong>Roles, ranks &amp; permissions</strong>{' '}
            below.
          </p>
        ),
      },
      {
        q: 'I got logged out.',
        a: <p>Sessions expire. Just log in again; nothing is lost.</p>,
      },
      {
        q: 'Does it work on mobile?',
        a: <p>Yes. The website has full mobile support.</p>,
      },
    ],
  },
  {
    title: 'Your data (Player & Guild stats)',
    items: [
      {
        q: 'Where do the numbers come from?',
        a: (
          <p>
            Two places: <strong>live lookups</strong> come straight from the
            Wynncraft public API, and <strong>history/points</strong> come from
            the guild's own ESI-Bot snapshots. We cache both so the site stays
            fast and doesn't hammer Wynncraft.
          </p>
        ),
      },
      {
        q: 'Why is some of my history missing or empty?',
        a: (
          <p>
            History only exists for days the bot was running and tracking you.
            If the bot was down, or you weren't in the guild yet, there's simply
            no snapshot for that period. Live stats (rank, playtime, medals)
            will still show.
          </p>
        ),
      },
      {
        q: 'Why does my stat look out of date?',
        a: (
          <p>
            Live data refreshes on its own schedule and is cached for a short
            time; history updates as new daily snapshots come in. A hard refresh
            usually clears up a stale display.
          </p>
        ),
      },
      {
        q: 'Can I compare two players?',
        a: <p>Yes — Player Stats supports a side-by-side comparison view.</p>,
      },
    ],
  },
  {
    title: 'EP & the Shop',
    items: [
      {
        q: 'What is EP?',
        a: (
          <p>
            Experience Points — the guild's internal currency, earned through
            gameplay (wars, guild raids, quests, etc.) and tracked per{' '}
            <strong>cycle</strong>. Cycles are two weeks long.
          </p>
        ),
      },
      {
        q: "What's the difference between Clean EP and Dirty EP?",
        a: (
          <>
            <p>
              EP comes in two pools, shown in the balance bar at the top of the
              Shop:
            </p>
            <ul className="qna-list">
              <li>
                <strong>Clean EP</strong> — the standard pool.
              </li>
              <li>
                <strong>Dirty EP</strong> — a second pool (donated LE also lands
                here).
              </li>
            </ul>
            <p>
              Each item decides which pool it accepts: <strong>Clean EP Only</strong>,
              or <strong>Any EP</strong>. Where both are accepted, items also
              have a spend order (clean-first or dirty-first), so it's always
              clear what gets used.
            </p>
          </>
        ),
      },
      {
        q: 'What does "reserved" mean?',
        a: (
          <p>
            When you bid in an auction, the EP for that bid is{' '}
            <strong>reserved</strong> so you can't spend it elsewhere. Get
            outbid or lose, and it's released. Reserved amounts show under the
            pool they came from.
          </p>
        ),
      },
      {
        q: 'When does the cycle reset?',
        a: (
          <p>
            The balance bar shows a live <strong>End of Cycle</strong> countdown.
          </p>
        ),
      },
      {
        q: 'How do I buy something?',
        a: (
          <p>
            Open the Shop, pick a fixed-price item, or add several to the{' '}
            <strong>cart</strong> and check out. Your balance is checked
            server-side, so you can't accidentally overspend.
          </p>
        ),
      },
      {
        q: 'What are cooldowns?',
        a: (
          <p>
            Some items can only be bought once per cooldown — which can be{' '}
            <strong>N days</strong>, <strong>N cycles</strong>, or{' '}
            <strong>resets each cycle</strong>. The item card shows when you can
            buy it again.
          </p>
        ),
      },
      {
        q: "Why can't I buy an item?",
        a: (
          <p>
            Common reasons: it's on cooldown, out of stock, it needs Clean EP and
            you only have Dirty, it's rank/top-N restricted, it's inactive, or
            the Shop is in maintenance.
          </p>
        ),
      },
      {
        q: "What's a rank/top-N restricted item?",
        a: (
          <p>
            Some items are only visible to certain ranks or to the top N on the
            cycle leaderboard. If you can't see something you expect, that's
            likely why.
          </p>
        ),
      },
      {
        q: 'How do auctions work?',
        a: (
          <p>
            An admin starts an auction; members bid, and each bid reserves EP.
            If you're outbid, your reservation is released. Auctions have{' '}
            <strong>anti-snipe</strong> protection — bids in the closing moments
            extend the end time (capped at two hours before the cycle ends). A
            background worker closes auctions, awards winners, releases losers,
            and sends reminders.
          </p>
        ),
      },
      {
        q: 'Will I get notified about auctions?',
        a: (
          <p>
            Yes, by Discord DM (branded cards): bid placed, outbid, winning,
            won, lost, cancelled, and "ending soon". You can turn off the
            low-urgency ones (bid confirmations, ending-soon reminders,
            extension alerts) in <strong>Settings → Reduce auction DMs</strong>.
            Critical ones (outbid, won, cancelled) are always sent.
          </p>
        ),
      },
      {
        q: 'How do I donate LE for EP?',
        a: (
          <p>
            Submit an LE donation in the Shop. It converts to{' '}
            <strong>dirty EP</strong> (1 LE = 15 dirty EP) and sits{' '}
            <strong>pending</strong> until a Chief/admin confirms it. You can
            only have one pending donation at a time.
          </p>
        ),
      },
      {
        q: 'What\'s the "death tax"?',
        a: (
          <p>
            If you leave the guild, you get a <strong>14-day grace period</strong>.
            Rejoin within it and nothing happens. After 14 days your EP and shop
            state are wiped and you're recorded in the guild's "cemetery". Wiped
            EP doesn't come back if you rejoin later.
          </p>
        ),
      },
      {
        q: 'Where can I see my purchases and refunds?',
        a: (
          <p>
            Your order history is in the Shop. Refunds are handled by shop
            admins — open a ticket if something's wrong with an order.
          </p>
        ),
      },
      {
        q: 'Why is the Shop showing "Under Maintenance" or "Coming Soon"?',
        a: (
          <p>
            Staff can put the Shop into maintenance (sometimes view-only) or hold
            it in a coming-soon state. Nothing is wrong on your end.
          </p>
        ),
      },
    ],
  },
  {
    title: 'Events',
    items: [
      {
        q: 'What do the statuses mean?',
        a: (
          <p>
            Upcoming → Ongoing → Completed, plus Cancelled. They update
            automatically as start/end times pass.
          </p>
        ),
      },
      {
        q: "What's the pinned events banner?",
        a: (
          <p>
            Staff can pin events so they show across every page. You can hide it
            in Settings.
          </p>
        ),
      },
      {
        q: 'Do events connect to Discord?',
        a: (
          <p>
            Yes — events can post to Discord scheduled events and use guild
            voice channels.
          </p>
        ),
      },
      {
        q: "I'm an event manager but don't see Manage Events.",
        a: (
          <p>
            That panel needs the events-access role. See the permissions section.
          </p>
        ),
      },
    ],
  },
  {
    title: 'Roles, ranks & permissions',
    items: [
      {
        q: 'How does the site decide what I can see?',
        a: (
          <p>
            From your Discord roles in the ESI server, plus (for the Shop) a
            per-user admin privilege layer.
          </p>
        ),
      },
      {
        q: 'Roughly, who can do what?',
        a: (
          <ul className="qna-list">
            <li>
              <strong>Everyone (no login):</strong> Player Stats, Guild Stats,
              Bot Panel, Events, browsing the Shop.
            </li>
            <li>
              <strong>Logged-in members:</strong> buying, carts, auctions,
              donations, event sign-ups, Creator Studio if approved.
            </li>
            <li>
              <strong>Juror+:</strong> Promotions.
            </li>
            <li>
              <strong>Parliament+:</strong> Inactivity.
            </li>
            <li>
              <strong>Privileged / Parliament:</strong> Manage Events.
            </li>
            <li>
              <strong>Parliament / Emperor:</strong> Guild Info.
            </li>
            <li>
              <strong>Chief+ / Parliament+:</strong> Manage Shop (catalogue,
              auctions, fulfilment, refunds, user bans/EP adjustments, audit
              log).
            </li>
            <li>
              <strong>Approved Creators:</strong> Creator Studio (apply → submit
              item requests → self-fulfil your own items for commission).
            </li>
            <li>
              <strong>Control Panel (separate site, staff only):</strong> Owner.
            </li>
          </ul>
        ),
      },
      {
        q: 'What is Creator Studio?',
        a: (
          <p>
            A workflow for members who make shop items: apply to become a
            Creator, then submit create/edit requests for review, and self-fulfil
            orders for your own items to earn a commission.
          </p>
        ),
      },
      {
        q: 'What are the "Manage Shop" tools for?',
        a: (
          <p>
            Full catalogue CRUD, stock/active overrides, auction management, the
            fulfilment queue, refunds, user bans/notes/EP adjustments, the
            death-tax graveyard, per-user permissions, and an audit log.
          </p>
        ),
      },
      {
        q: 'Can I be banned from the Shop?',
        a: (
          <p>
            Yes — shop bans are separate from your Discord roles. If you're
            banned, the Shop is hidden for you.
          </p>
        ),
      },
      {
        q: "What's the Control Panel?",
        a: (
          <p>
            A separate staff-only ops dashboard for starting/stopping services,
            running maintenance scripts, and viewing analytics. It works even
            when the main site is down.
          </p>
        ),
      },
    ],
  },
  {
    title: 'Badges & medals',
    items: [
      {
        q: 'How do I earn a badge?',
        a: (
          <p>
            Badges are Discord roles granted automatically at thresholds, in
            five tracks: <strong>War, Quest, Recruitment, Raid, and Event</strong>.
            Each track goes Bronze → Silver → Gold → Platinum → Diamond → Onyx →
            the top "[Name]" badge.
          </p>
        ),
      },
      {
        q: 'Where do I see my progress?',
        a: (
          <p>
            The dashboard shows badge progress against the next tier for your
            track.
          </p>
        ),
      },
      {
        q: 'What are medals?',
        a: (
          <p>
            A separate set of named honours (e.g. Sindrian Eagle, Order of
            Sindria, Medal of Valliance/Brilliance/Inspiration/Benevolence/Fellowship/Allegiance)
            shown on your profile.
          </p>
        ),
      },
    ],
  },
  {
    title: 'Personalisation (Settings)',
    items: [
      {
        q: 'What can I customise?',
        a: (
          <ul className="qna-list">
            <li>
              <strong>Appearance:</strong> colour theme and font.
            </li>
            <li>
              <strong>Search &amp; Lookup:</strong> default player lookup.
            </li>
            <li>
              <strong>Graphs &amp; Metrics:</strong> default player/guild metric
              and day range (2–60).
            </li>
            <li>
              <strong>Notifications:</strong> toast on/off, duration, max
              visible, events nav badge, pinned events banner, reduce auction
              DMs.
            </li>
            <li>
              <strong>Member Management:</strong> default inactivity-checker and
              promotions settings (staff).
            </li>
          </ul>
        ),
      },
      {
        q: 'Can I make my own theme or font?',
        a: (
          <p>
            Yes. Settings → <strong>+ Add Custom</strong>. Upload a{' '}
            <code>.css</code> theme, or a <code>.zip</code> for a custom font
            (CSS + font files). Your custom theme/font is stored{' '}
            <strong>in your browser only</strong> — it's never uploaded to or
            served from our servers. Clear your browser data and you'll need to
            re-add it.
          </p>
        ),
      },
      {
        q: 'Where do I get more themes?',
        a: (
          <p>
            The Settings panel links to the <strong>ESI Dev Discord</strong>,
            where extra themes are shared.
          </p>
        ),
      },
      {
        q: 'Do my settings sync between devices?',
        a: (
          <p>
            Preferences are stored locally and, when you're logged in, synced to
            your account.
          </p>
        ),
      },
    ],
  },
  {
    title: 'Troubleshooting',
    items: [
      {
        q: "Something looks broken / a panel won't load.",
        a: (
          <p>
            Try a hard refresh first. If it persists, open a ticket with the
            panel name and what you expected.
          </p>
        ),
      },
      {
        q: 'A toast/banner is annoying me.',
        a: (
          <p>
            Turn it off in Settings (toasts, events nav badge, pinned banner,
            auction DMs).
          </p>
        ),
      },
      {
        q: 'My balance looks wrong.',
        a: (
          <p>
            Check the Clean/Dirty split and any <strong>reserved</strong> amount
            from active bids — reserved EP isn't spendable. If it's still off,
            open a ticket.
          </p>
        ),
      },
      {
        q: "I uploaded a custom font and it didn't apply.",
        a: (
          <p>
            Font uploads need to be a <code>.zip</code> containing the{' '}
            <code>.css</code> <strong>and</strong> the font files it references;
            large fonts can exceed the browser's ~5 MB storage limit. Plain{' '}
            <code>.css</code> only works if it references no local font files.
          </p>
        ),
      },
      {
        q: 'Why was my request blocked?',
        a: (
          <p>
            The site has an automatic IP-ban system for abusive/automated
            traffic (scanners, exploit probes, excessive 403/429s). Normal
            browsing is unaffected. If you think you were banned by mistake,
            contact staff.
          </p>
        ),
      },
    ],
  },
  {
    title: 'Privacy, data & reporting',
    items: [
      {
        q: 'What data do you keep about me?',
        a: (
          <p>
            Discord account data (if you log in), your preferences,
            truncated/anonymised access logs, and first-party usage analytics.
            Analytics never stores your raw IP — it uses a one-way hash with a
            daily-rotating salt, and it's disabled if your browser sends Do Not
            Track. Full details are in the footer's Privacy/Cookie/Terms/Legal
            Notice.
          </p>
        ),
      },
      {
        q: 'How do I exercise my GDPR rights?',
        a: (
          <p>
            Email <strong>esi.dashboard.support@gmail.com</strong> (the
            controller details are in the Privacy Policy).
          </p>
        ),
      },
      {
        q: 'How do I report a bug or request a feature?',
        a: (
          <p>
            Support → <strong>Open a Ticket</strong> (creates a GitHub issue; you
            need to be logged in), or ask in the Discord.
          </p>
        ),
      },
      {
        q: 'Is this an official Wynncraft/Mojang site?',
        a: (
          <p>
            No. It's a fan-made project by an ESI member and is not affiliated
            with, endorsed by, or sponsored by Wynncraft, Mojang, Microsoft, or
            their subsidiaries.
          </p>
        ),
      },
    ],
  },
]

export default function SupportQna() {
  return (
    <>
      {QNA_SECTIONS.map((section, sIdx) => (
        <div className="qna-section" key={section.title}>
          <div className="qna-section-title">{section.title}</div>
          {section.items.map((item, iIdx) => {
            const questionId = `qna-q-${sIdx}-${iIdx}`
            const answerId = `qna-answer-${sIdx}-${iIdx}`
            return (
              <div className="qna-item" key={item.q}>
                <button
                  type="button"
                  className="qna-question"
                  id={questionId}
                  aria-expanded="false"
                  aria-controls={answerId}
                >
                  {item.q}
                </button>
                <div
                  className="qna-answer-wrap"
                  id={answerId}
                  role="region"
                  aria-labelledby={questionId}
                >
                  <div className="qna-answer">
                    <div className="qna-answer-inner">{item.a}</div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      ))}
    </>
  )
}
