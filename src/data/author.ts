/**
 * Who made this, and how to reach them.
 *
 * Kept in one place so the credit on the map, the outreach page and the drafted
 * message cannot drift apart. Everything here ends up in the client bundle and
 * is therefore public and scrapable, which is why there is no phone number: an
 * email address in the open is a nuisance, a personal mobile is worse.
 */
export const AUTHOR = {
  name: 'Almas Ansari',
  email: 'itsmealmas.ansari@gmail.com',
  github: 'https://github.com/Almas-ansari',
  githubHandle: 'github.com/Almas-ansari',
  portfolio: 'https://almas-ansari-i2oeimx.gamma.site',
  portfolioLabel: 'almas-ansari-i2oeimx.gamma.site',
} as const;

export interface CollegeRequest {
  readonly college: string;
  readonly city: string;
  readonly name: string;
  readonly contact: string;
  readonly note: string;
}

export const EMAIL_SUBJECT = (college: string): string =>
  `The Grounds — please plan this for ${college.trim()}`;

/**
 * The message the form drafts. Written as a note from the sender to the author,
 * because that is what it becomes the moment it lands in a mail client — there
 * is no server in the middle rewriting it.
 */
export function draftMessage(request: CollegeRequest, origin: string): string {
  const college = request.college.trim();
  const where = request.city.trim() ? `${college}, ${request.city.trim()}` : college;

  const lines = [
    `Hello ${AUTHOR.name.split(' ')[0]},`,
    '',
    `I came across The Grounds at Jamia and I would like it built for ${where}.`,
  ];

  if (request.name.trim()) lines.push('', `My name is ${request.name.trim()}.`);
  if (request.contact.trim()) lines.push(`You can reach me at ${request.contact.trim()}.`);
  if (request.note.trim()) lines.push('', request.note.trim());

  lines.push('', '—', `Sent from the map at ${origin}`);
  return lines.join('\n');
}

export function mailtoLink(request: CollegeRequest, origin: string): string {
  const subject = encodeURIComponent(EMAIL_SUBJECT(request.college));
  const body = encodeURIComponent(draftMessage(request, origin));
  return `mailto:${AUTHOR.email}?subject=${subject}&body=${body}`;
}
