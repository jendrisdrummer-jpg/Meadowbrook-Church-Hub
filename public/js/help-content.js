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
      html`Open ${b('My Schedule')} from the menu (${b('Schedule')} at the bottom of a phone). On Home, you can also tap ${b('Accept')} or ${b('Can’t make it')} right in ${b('Your next times serving')}.`,
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
      html`Open ${b('My Schedule')}.`,
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
    intro: 'You can schedule people on the teams you lead. Nobody hears about it until you send the requests, so you can take your time.',
    hub: [
      html`Open ${b('Services')} and tap the service. Choose the ${b('Who’s serving')} tab.`,
      html`Under your team, tap ${b('Schedule someone')} next to an open position.`,
      html`Pick a person. The best choices are first. Labels warn you if someone is away, already serving at that time, or doesn’t usually serve at this campus.`,
      html`If a warning shows, you’ll be asked to confirm. Tap ${b('Schedule anyway')} only if you’ve already talked with them.`,
      html`Short on time? Tap ${b('Fill open spots')} to add available people fairly. Look the names over and change any you don’t want (tap the ✕ beside a name).`,
      html`People you add show a ${b('Not sent')} label. When you’re happy, tap ${b('Send requests')}, check the list, then tap ${b('Send to')} the people shown.`,
    ],
    note: 'To plan a whole month, open Schedule in the menu and use Fill the month there.',
  },
  {
    id: 'remind', title: 'Remind people who haven’t replied', min: 'leader',
    intro: 'A friendly nudge for people who were asked but haven’t answered yet.',
    hub: [
      html`Open ${b('Services')}, tap the service and choose the ${b('Who’s serving')} tab.`,
      html`People who haven’t answered show ${b('Waiting')}.`,
      html`Tap ${b('Remind')} at the top of the card. It shows how many people haven’t replied.`,
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
    id: 'checkin', title: 'Kids’ check-in', min: 'leader',
    intro: 'Kids’ check-in holds families’ and children’s details, so only some people can use it.',
    hub: [
      html`Staff and admins can use it. Team leaders can use it once the church office has given them access.`,
      html`If you need to use it, ask the church office to give your account access.`,
      html`It’s ${b('Kids Check-in')} in the menu. Without access, it tells you to ask the office.`,
    ],
    note: 'Step-by-step help for check-in is coming separately.',
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
export function helpSections(where, role) {
  const rank = RANK[role] ?? 0;
  return SECTIONS
    .filter((s) => rank >= RANK[s.min] && (where === 'hub' || s.app || s.appSteps))
    .map((s) => ({ ...s, steps: where === 'app' ? (s.appSteps || s.hub) : s.hub }));
}

// The collapsible sections, as html. `first` opens the first one so the page never looks empty.
export function helpList(where, role) {
  return helpSections(where, role).map((s, i) => html`<details class="card help-sec" id="help-${s.id}" ${i === 0 ? html`open` : ''}>
    <summary><b>${s.title}</b></summary>
    <p class="muted" style="margin:8px 0 0">${s.intro}</p>
    <ol class="help-steps">${s.steps.map((st) => html`<li>${st}</li>`)}</ol>
    ${s.note ? html`<p class="muted small" style="margin:0">${s.note}</p>` : ''}
  </details>`);
}
