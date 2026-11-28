// Short how-to guides for the Help page in the hub (#/help) and the member app (More → Help).
// One list, two views: `where: 'hub'` or `'app'` picks the wording that matches the screen the
// person is on. `min` is the lowest role that sees a section. Every button name here is the
// real label in the UI; if you rename a button, change it here too.
import { html } from './lib.js';

const RANK = { volunteer: 0, leader: 1, staff: 2, admin: 3 };

const b = (t) => html`<b>${t}</b>`;

// steps: a list of html`` lines. Sections with `app` steps are also shown in the member app.
const SECTIONS = [
  {
    id: 'reply', title: 'Reply to a request to serve', min: 'volunteer', app: true,
    intro: 'When someone schedules you, you get a notification and an email. You can answer from either of them, or from your schedule.',
    hub: [
      html`Open ${b('My schedule')} from the menu (${b('Schedule')} at the bottom of a phone). On Home, you can also tap ${b('Accept')} or ${b('Can’t make it')} right in ${b('Your next times serving')}.`,
      html`Requests waiting for you are at the top, under ${b('Please reply')}.`,
      html`Tap ${b('Accept')} if you can serve.`,
      html`If you can’t, tap ${b('Can’t make it')}, add a short reason if you like, then tap ${b('Let my leader know')}.`,
      html`Tap ${b('Order of service')} on any request to see the plan for that day.`,
      html`From an email instead: tap the link, then ${b('Yes, I’ll be there')} or ${b('I can’t make it')}. You don’t need to sign in, and nothing changes until you tap a button.`,
    ],
    appSteps: [
      html`Open the ${b('Serve')} tab.`,
      html`Requests waiting for you are at the top, under ${b('Please reply')}.`,
      html`Tap ${b('Accept')} if you can serve.`,
      html`If you can’t, tap ${b('Can’t make it')}, add a short reason if you like, then tap ${b('Let my leader know')}.`,
      html`Tap ${b('Order of service')} on any request to see the plan for that day.`,
      html`From an email instead: tap the link, then ${b('Yes, I’ll be there')} or ${b('I can’t make it')}. You don’t need to sign in.`,
    ],
  },
  {
    id: 'away', title: 'Add dates you’re away', min: 'volunteer', app: true,
    intro: 'Tell your leaders when you’re out of town, and you won’t be scheduled on those days.',
    hub: [
      html`Open ${b('My schedule')}.`,
      html`Find the ${b('Dates I’m away')} card and tap ${b('I’ll be away…')}.`,
      html`Choose the ${b('First day')}. If it’s more than one day, choose the ${b('Last day')} too.`,
      html`Add a reason if you like, then tap ${b('Save')}.`,
      html`Plans changed? Tap the bin next to those dates to remove them.`,
    ],
    appSteps: [
      html`Open the ${b('Serve')} tab.`,
      html`Find the ${b('Dates I’m away')} card and tap ${b('I’ll be away…')}.`,
      html`Choose the ${b('First day')}. If it’s more than one day, choose the ${b('Last day')} too.`,
      html`Add a reason if you like, then tap ${b('Save')}.`,
      html`Plans changed? Tap the bin next to those dates to remove them.`,
    ],
  },
  {
    id: 'schedule', title: 'Schedule people for a service', min: 'leader',
    intro: 'You can schedule people on the teams you lead. Nobody hears about it until you send the requests, so you can take your time. For teams you don’t lead you’ll see who has been asked or has accepted, but not who declined or why.',
    hub: [
      html`Open ${b('Services')} and tap the service. Choose the ${b('Who’s serving')} tab.`,
      html`Under your team, tap ${b('Schedule someone')} next to an open position.`,
      html`Pick a person. The best choices are first. Labels warn you if someone is away, already serving at that time, or doesn’t usually serve at this campus.`,
      html`If a warning shows, you’ll be asked to confirm. Tap ${b('Schedule anyway')} only if you’ve already talked with them.`,
      html`Short on time? Under a team, tap ${b('Fill open spots')} to add available people fairly (one team at a time). Look the names over and change any you don’t want (tap the ✕ beside a name).`,
      html`People you add show a ${b('Not asked yet')} label. When you’re happy, tap ${b('Send requests')}, check the list, then tap ${b('Send to')} the people shown.`,
    ],
    note: 'To plan a whole month, open Volunteer schedule in the menu and pick a team and use Fill the month there. Both fill one team at a time.',
  },
  {
    id: 'remind', title: 'Remind people who haven’t replied', min: 'leader',
    intro: 'A friendly nudge for people who were asked but haven’t answered yet.',
    hub: [
      html`Open ${b('Services')}, tap the service and choose the ${b('Who’s serving')} tab.`,
      html`People who haven’t answered show ${b('Waiting')}.`,
      html`Tap ${b('Remind')} at the top of the card. The button says how many people haven’t replied, like ${b('Remind 3 who haven’t replied')}.`,
      html`Check the message, then tap ${b('Send reminder')}.`,
      html`Anyone reminded in the last 12 hours is skipped, so it’s safe to tap again later.`,
    ],
    note: 'The Remind button only shows when someone is waiting, and not for services that have already happened.',
  },
  {
    id: 'team-chat', title: 'Message your team', min: 'leader',
    intro: 'Each team has its own chat, so you can reach everyone in one place.',
    hub: [
      html`Open ${b('Teams')} and tap your team.`,
      html`Tap ${b('Message team')} at the top of the page. (You’ll also find it beside the team’s name on a service’s ${b('Who’s serving')} tab.)`,
      html`Type your message and send it. Everyone on the team can see it.`,
      html`Don’t see the button? The team chat may not be set up yet. Ask the church office.`,
    ],
    note: 'You can also open Chat in the menu to see all your team chats.',
  },
  {
    id: 'group', title: 'Lead a small group', min: 'volunteer',
    intro: 'If you lead a small group, you can add people and message the whole group.',
    hub: [
      html`Open ${b('Groups')} and tap your group.`,
      html`In the ${b('People')} card, tap the box that says ${b('Add someone: type a name')}.`,
      html`Type at least three letters of their name, then tap the right person in the list. They’re added straight away.`,
      html`Tap ${b('Group chat')} at the top to message everyone in the group.`,
      html`To remove someone, tap the ✕ next to their name.`,
      html`To stop leading, tap ${b('Step down as leader')} next to your own name.`,
    ],
    note: 'Phone numbers and emails are kept by the church office. Ask them if you need to reach someone you can’t find in the group chat.',
    appSteps: [
      html`Open the ${b('More')} tab. Your groups are listed under ${b('My groups')}.`,
      html`Tap a group to open its chat and message everyone in it.`,
      html`To add people, remove them or step down as a leader, use the church hub on a computer or tablet, or ask the church office.`,
    ],
  },
  {
    id: 'feedback', title: 'Send feedback', min: 'volunteer', app: true,
    intro: 'Tell us what isn’t working or what would help. It’s read by the people building the Hub.',
    hub: [
      html`Open ${b('Feedback')} from the menu.`,
      html`Choose what kind of feedback it is and how much it matters.`,
      html`Write what happened, or what would help, then tap ${b('Send')}.`,
      html`Below the form, ${b('You said, we did')} shows what we’ve changed because of feedback.`,
      html`Something is stopping you on a Sunday morning? Also tell your contact in person.`,
    ],
    appSteps: [
      html`Open the ${b('More')} tab and tap ${b('Send feedback')}.`,
      html`Choose what kind of feedback it is and how much it matters.`,
      html`Write what happened, or what would help, then tap ${b('Send')}.`,
      html`To see what we’ve changed because of feedback, open the Hub on a computer or tablet and look under ${b('You said, we did')} on the ${b('Feedback')} page.`,
    ],
  },
  {
    id: 'attendance', title: 'Take attendance', min: 'leader', flag: 'attendance',
    intro: 'Mark who is here and enter headcounts on your phone, in the room. Everything saves as you tap, so there’s no Save button.',
    hub: [
      html`Open ${b('Attendance')} (in ${b('More')} on a phone). Leaders and staff then tap ${b('Take attendance')}.`,
      html`Today’s services are at the top. Each shows its campus in bold, and the service closest to the time now has a ${b('Now')} label. Tap the right one.`,
      html`Tap each person you see. A tick appears and the count at the top goes up. Tap again to undo. ${b('Mark family')} ticks a whole family at once.`,
      html`Someone new? Tap ${b('New guest')}, type their name, then tap ${b('Add and mark here')}. They show a ${b('New')} label on the list.`,
      html`For a headcount, tap ${b('Headcount')}, type the number for each room, and wait for ${b('Headcount saved')}.`,
      html`Don’t see the service? Choose ${b('Another date')} and tap ${b('Show services')}.`,
    ],
    note: 'Tapped the wrong person? Tap them again. If your signal is weak and a tap doesn’t stick, you’ll see a message. Try again when you’re back online.',
  },
  {
    id: 'connect', title: 'Follow up with a guest', min: 'leader',
    intro: 'When a guest fills in the connect card in the church app, it lands here so no one is missed.',
    hub: [
      html`Open ${b('Connect cards')} from the menu. A number beside it shows how many are waiting.`,
      html`Cards under ${b('To follow up')} show their name, contact details and anything they wrote. ${b('First time')} marks a first visit.`,
      html`Tap ${b('Add to People')} to make a record for them. If they may already be in People, tap ${b('Already in People…')} and choose them.`,
      html`Call, text or email them, then tap ${b('Followed up')}. It moves to the ${b('Followed up')} tab.`,
      html`People who created their own account in the app are on the ${b('App sign-ups')} tab. Say hello, then tap ${b('Followed up')}.`,
    ],
    note: 'Marked one by mistake? Open the Followed up tab and tap Reopen.',
  },
  {
    id: 'studies', title: 'Look after Bible studies', min: 'staff', flag: 'studies',
    intro: 'For the Bible studies coordinator. Studies are personal, so only the coordinator, the teacher and church staff can see who is studying.',
    hub: [
      html`Open ${b('Bible studies')} from the menu (in ${b('More')} on a phone).`,
      html`Tap ${b('New study')}. Add at least one teacher and one student, and a material if you know it. Tap ${b('Start')} when you’re ready.`,
      html`Someone asked for a study? They appear on ${b('Waiting')}. Tap ${b('Start a study')}, or ${b('Add to an existing study')}.`,
      html`Tap a study on ${b('Studies')} to edit details, ${b('Pause')} it, or tap ${b('Finish the study')} when it’s done.`,
      html`Keep the approved list of books and courses under ${b('Materials')}. Tap ${b('Add a material')} to add one.`,
    ],
    note: 'Please keep personal matters out of the Hub. Notes are for practical things only, like “prefers mornings”.',
  },
  {
    id: 'checkin', title: 'Kids’ check-in', min: 'leader',
    intro: 'Kids’ check-in holds families’ and children’s details, so only some people can use it.',
    hub: [
      html`Staff and admins can use it. Team leaders can use it once the church office has given them access.`,
      html`If you need to use it, ask the church office to give your account access.`,
      html`It’s ${b('Kids Check-in')} in the menu. Without access, it tells you to ask the office.`,
    ],
  },
  {
    id: 'account', title: 'Getting help', min: 'volunteer',
    intro: 'If something looks wrong or missing, here’s what to do.',
    hub: [
      html`No schedule, or a message that your account isn’t connected to you? The church office is told automatically, and they’ll link it. You don’t need to do anything else.`,
      html`Still stuck after a few days, or it’s urgent? Contact the church office.`,
      html`Something broken or confusing? Tell us on the ${b('Feedback')} page.`,
    ],
    appSteps: [
      html`No schedule, or a message that your account isn’t connected to you? The church office is told automatically, and they’ll link it. You don’t need to do anything else.`,
      html`Still stuck after a few days, or it’s urgent? Contact the church office.`,
      html`Something broken or confusing? Open the ${b('More')} tab and tap ${b('Send feedback')}.`,
    ],
  },
];

// Sections this person should see. where: 'hub' | 'app'; role: 'volunteer' | 'leader' | 'staff' | 'admin'.
// flags: the extra switches an account can have, like { attendance: true, studies: true }; a section with a `flag` is also shown to anyone who has it.
export function helpSections(where, role, flags = {}) {
  const rank = RANK[role] ?? 0;
  return SECTIONS
    .filter((s) => (rank >= RANK[s.min] || (s.flag && flags[s.flag])) && (where === 'hub' || s.app || s.appSteps))
    .map((s) => ({ ...s, steps: where === 'app' ? (s.appSteps || s.hub) : s.hub }));
}

// The collapsible sections, as html. `first` opens the first one so the page never looks empty.
export function helpList(where, role, flags = {}) {
  return helpSections(where, role, flags).map((s, i) => html`<details class="card help-sec" id="help-${s.id}" ${i === 0 ? html`open` : ''}>
    <summary><b>${s.title}</b></summary>
    <p class="muted" style="margin:8px 0 0">${s.intro}</p>
    <ol class="help-steps">${s.steps.map((st) => html`<li>${st}</li>`)}</ol>
    ${s.note ? html`<p class="muted small" style="margin:0">${s.note}</p>` : ''}
  </details>`);
}
