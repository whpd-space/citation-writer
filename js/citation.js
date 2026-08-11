export const CITATION_FOOTER = '<font color="#ffffff"><a href="showinfo:16159//99010102">The Wormhole Police</a></font> ( <a href="https://whpd.space">Website</a> )<br><font color="#ffffffff">"</font><font color="#ff00ff00">Decloak</font><font color="#ffffffff">. </font><font color="#ffff0000">Detain</font><font color="#ffffffff">. </font><font color="#ffffff00">Discipline!</font><font color="#ffffffff">"</font>';

export const CITATION_HEADERS = Object.freeze({
  charges: '<a href="https://whpd.space/LegalLibrary.html"><font color="red"><b>Misdemeanors & Felonies:</b></font></a>',
  evidence: '<font color="#ff007fff"><b>Evidence:</b></font>',
  officerComments: '<font color="#ff007fff"><b>Officer Comments:</b></font>',
  note: '<font color="#ff007fff"><b>Final WHPD Note:</b></font>',
  disclaimer: '<font color="#ff007fff"><b>WHPD Disclaimer:</b></font>'
});

const DISCLAIMER = '<font color="white">If you\'re taking any of this seriously you\'re doing it wrong!</font>';

export const LEGAL_OFFENSES = Object.freeze([
  { id: 'reckless-damage', classification: 'Misdemeanor', code: 'IUS Lex Penal Code - PENAL § 28.04', title: 'Reckless Damage or Destruction' },
  { id: 'criminal-trespass', classification: 'Misdemeanor', code: 'IUS Lex Penal Code - PENAL § 30.05', title: 'Criminal Trespass' },
  { id: 'theft', classification: 'Misdemeanor', code: 'IUS Lex Penal Code - PENAL § 31.03', title: 'Theft' },
  { id: 'speeding', classification: 'Misdemeanor', code: 'IUS Lex Penal Code - PENAL § 32.76', title: 'Speeding' },
  { id: 'flying-intoxicated', classification: 'Misdemeanor', code: 'IUS Lex Penal Code - PENAL § 49.05', title: 'Flying While Intoxicated' },
  { id: 'illegal-dumping', classification: 'Misdemeanor', code: 'IUS Lex Health and Safety Code - HEALTH & SAFETY § 365.012', title: 'Illegal Dumping' },
  { id: 'garbage-disposal', classification: 'Misdemeanor', code: 'IUS LEX - Sec. 365.004', title: 'Disposal of Garbage, Refuse, and Sewage in Certain Areas Under Control of Parks and Wildlife Department' },
  { id: 'animal-cruelty', classification: 'Misdemeanor', code: 'IUS Lex Penal Code - PENAL § 42.092', title: 'Cruelty to Nonlivestock Animals' },
  { id: 'passage-obstruction', classification: 'Misdemeanor', code: 'IUS Lex Penal Code - PENAL § 42.03', title: 'Obstructing Highway or Other Passageway' },
  { id: 'bribery', classification: 'Felony', code: 'IUS Lex Penal Code - PENAL § 36.02', title: 'Bribery' },
  { id: 'obstruction-retaliation', classification: 'Felony', code: 'IUS Lex Penal Code - PENAL § 36.06', title: 'Obstruction or Retaliation' },
  { id: 'evading-arrest', classification: 'Felony', code: 'IUS Lex Penal Code - PENAL § 38.04', title: 'Evading Arrest or Detention' },
  { id: 'unlawful-weapons', classification: 'Felony', code: 'IUS Lex Penal Code - PENAL § 46.02', title: 'Unlawful Carrying Weapons' },
  { id: 'organized-crime', classification: 'Felony', code: 'IUS Lex Penal Code - PENAL § 71.02', title: 'Engaging in Organized Criminal Activity' },
  { id: 'officer-assault', classification: 'Felony', code: 'IUS Lex Penal Code - PENAL § 22.02 (b.2.B)', title: 'Aggravated Assault on an Officer on Duty' },
  { id: 'murder', classification: 'Felony', code: 'IUS Lex Penal Code - PENAL § 19.02', title: 'Murder' },
  { id: 'capital-murder', classification: 'Felony', code: 'IUS Lex Penal Code - PENAL § 19.03', title: 'Capital Murder' }
]);

export const DEFAULT_OFFENSE_IDS = Object.freeze([]);

export const DEFAULT_CITATION_TEMPLATE_ID = 'whpd-standard';
export const MINIMAL_CITATION_TEMPLATE_ID = 'whpd-minimal';

export const DEFAULT_CITATION_SECTION_IDS = Object.freeze({
  opening: 'opening-narrative',
  charges: 'charges',
  evidence: 'evidence',
  officerComments: 'officer-comments',
  finalNote: 'final-note',
  disclaimer: 'disclaimer',
  footer: 'footer'
});

export const DEFAULT_CITATION_TEMPLATE = Object.freeze({
  id: DEFAULT_CITATION_TEMPLATE_ID,
  name: 'WHPD Squizz Standard',
  subject: 'Citation Issued: {{title}}',
  sections: Object.freeze([
    Object.freeze({
      id: DEFAULT_CITATION_SECTION_IDS.opening,
      name: 'Opening narrative',
      body: '{{openingNarrative}}',
      editor: 'text',
      defaultValue: '{{randomHumor}}',
      optional: false
    }),
    Object.freeze({
      id: DEFAULT_CITATION_SECTION_IDS.charges,
      name: 'Misdemeanors & Felonies',
      body: `${CITATION_HEADERS.charges}\n{{charges}}`,
      editor: 'none',
      defaultValue: '',
      optional: false
    }),
    Object.freeze({
      id: DEFAULT_CITATION_SECTION_IDS.evidence,
      name: 'Evidence',
      body: `${CITATION_HEADERS.evidence}\n{{evidence}}`,
      editor: 'list',
      defaultValue: '{{defaultEvidence}}',
      optional: false
    }),
    Object.freeze({
      id: DEFAULT_CITATION_SECTION_IDS.officerComments,
      name: 'Officer Comments',
      body: `${CITATION_HEADERS.officerComments}\n{{contentBullets}}`,
      editor: 'list',
      defaultValue: '',
      optional: true
    }),
    Object.freeze({
      id: DEFAULT_CITATION_SECTION_IDS.finalNote,
      name: 'Final WHPD Note',
      body: `${CITATION_HEADERS.note}\n{{contentWhite}}`,
      editor: 'text',
      defaultValue: '{{randomFinalNote}}',
      optional: false
    }),
    Object.freeze({
      id: DEFAULT_CITATION_SECTION_IDS.disclaimer,
      name: 'WHPD Disclaimer',
      body: `${CITATION_HEADERS.disclaimer}\n${DISCLAIMER}`,
      editor: 'none',
      defaultValue: '',
      optional: false
    }),
    Object.freeze({
      id: DEFAULT_CITATION_SECTION_IDS.footer,
      name: 'WHPD Footer',
      body: CITATION_FOOTER,
      editor: 'none',
      defaultValue: '',
      optional: false
    })
  ])
});

export const MINIMAL_CITATION_TEMPLATE = Object.freeze({
  id: MINIMAL_CITATION_TEMPLATE_ID,
  name: 'WHPD Minimal',
  subject: 'Citation: {{pilotName}}',
  sections: Object.freeze([
    Object.freeze({
      id: 'minimal-citation',
      name: 'Citation',
      body: '<font color="white">Citation issued to {{pilotName}}.</font>',
      editor: 'none',
      defaultValue: '',
      optional: false
    })
  ])
});

export function isProtectedCitationTemplateId(templateId) {
  return templateId === DEFAULT_CITATION_TEMPLATE_ID || templateId === MINIMAL_CITATION_TEMPLATE_ID;
}

function withoutEmoji(value) {
  return value
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '')
    .replace(/\uFE0F/gu, '');
}

export function cleanCitationText(value) {
  return withoutEmoji(String(value ?? ''))
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/[—–]/g, '-')
    .replace(/\r?\n/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function escapeHtml(value) {
  return withoutEmoji(String(value ?? ''))
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/[—–]/g, '-')
    .replace(/\r?\n/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function font(color, value) {
  return `<font color="${color}">${escapeHtml(value)}</font>`;
}

function white(value) {
  return font('white', value);
}

function green(value) {
  return font('green', value);
}

function magenta(value) {
  return font('#ff007fff', value);
}

function safeHttpsUrl(value) {
  try {
    const url = new URL(String(value || ''));
    return url.protocol === 'https:' ? url.href : '';
  } catch (_) {
    return '';
  }
}

function safeKillReportUrl(killmailId, killmailHash) {
  const id = Number(killmailId);
  const hash = String(killmailHash || '').trim();
  if (!Number.isSafeInteger(id) || id <= 0 || !/^[a-f0-9]{40}$/i.test(hash)) return '';
  return `killReport:${id}:${hash}`;
}

function normalizedList(values, fallback) {
  const clean = (Array.isArray(values) ? values : [])
    .map(cleanCitationText)
    .filter(Boolean);
  return clean.length ? clean : [fallback];
}

function openingNarrative(data, humor = data.humor) {
  const alliance = cleanCitationText(data.allianceName);
  const officerName = cleanCitationText(data.officerName);
  const attackerType = ['officer', 'deputy', 'fleet', 'memefleet'].includes(data.attackerType)
    ? data.attackerType
    : 'officer';
  const rolePrefix = attackerType === 'deputy'
    ? (officerName.toLowerCase().startsWith('deputy ') ? '' : 'Deputy ')
    : (attackerType === 'officer' && !officerName.toLowerCase().startsWith('officer ') ? 'Officer ' : '');
  const parts = [
    white('Pilot '),
    white(data.pilotName),
    white(' of '),
    white(data.corporationName)
  ];

  if (alliance) {
    parts.push(white(', operating under '), white(alliance));
  }

  parts.push(
    white(', was detained in '),
    magenta(data.systemName),
    white(' while conducting '),
    white(data.activity),
    white(`. ${rolePrefix}`),
    green(officerName)
  );

  if (attackerType === 'fleet' || attackerType === 'memefleet') {
    parts.push(white(' arrived and dismantled the suspect\'s '));
  } else {
    parts.push(
      white(' arrived in their '),
      white(data.officerShipName),
      white(' and dismantled the suspect\'s ')
    );
  }

  parts.push(
    white(data.destroyedShipName),
    white(', assessed at '),
    magenta(data.totalValue),
    white('. '),
    white(humor)
  );

  return parts.join('');
}

function chargeBullets(charges) {
  return normalizedList(charges, 'IUS § 000.0 | Unspecified administrative enthusiasm')
    .map((charge) => {
      const separator = charge.indexOf('|');
      const code = separator === -1 ? charge : charge.slice(0, separator);
      const description = separator === -1 ? 'Unauthorized activity in WHPD jurisdiction' : charge.slice(separator + 1);
      return `- ${green(code.trim())}${white(`: ${description.trim()}`)}`;
    });
}

function whiteBullets(items, fallback) {
  return normalizedList(items, fallback).map((item) => `- ${white(item)}`);
}

function evidenceBullets(data, evidence = data.evidence) {
  const bullets = whiteBullets(evidence, 'Patrol telemetry was reviewed and entered into evidence.');
  const records = Array.isArray(data.zkillRecords) && data.zkillRecords.length
    ? data.zkillRecords
    : [{ zkillUrl: data.zkillUrl, label: 'zKillboard combat record' }];
  records.forEach((record) => {
    const zkillUrl = safeHttpsUrl(record?.zkillUrl || record?.url);
    if (!zkillUrl) return;
    const label = cleanCitationText(record?.label) || 'zKillboard combat record';
    const killReportUrl = safeKillReportUrl(record?.killmailId, record?.killmailHash);
    const killmailLabel = killReportUrl
      ? `<a href="${escapeHtml(killReportUrl)}">${white(label)}</a>`
      : white(label);
    bullets.push(`- ${killmailLabel} (<a href="${escapeHtml(zkillUrl)}">${white('zkill')}</a>)`);
  });
  return bullets;
}

export function validateCitation(data) {
  const errors = [];
  const template = templateForCitation(data);
  if (!citationSubject(data, template)) errors.push('EVE Mail subject is required.');
  const templateSource = template.sections.map((section) => `${section.body}\n${section.defaultValue}`).join('\n');
  const usesOpeningNarrative = templateSource.includes('{{openingNarrative}}');
  const required = usesOpeningNarrative
    ? [
      ['pilotName', 'Pilot name'],
      ['corporationName', 'Corporation'],
      ['systemName', 'System'],
      ['activity', 'Activity'],
      ['officerName', 'Attacker'],
      ['destroyedShipName', 'Destroyed ship'],
      ['totalValue', 'Total value']
    ]
    : [
      ['pilotName', 'Pilot name'],
      ...[
        ['corporationName', 'Corporation'],
        ['systemName', 'System'],
        ['activity', 'Activity'],
        ['officerName', 'Attacker'],
        ['officerShipName', 'Officer ship'],
        ['destroyedShipName', 'Destroyed ship'],
        ['totalValue', 'Total value']
      ].filter(([key]) => templateSource.includes(`{{${key}}}`))
    ];

  required.forEach(([key, label]) => {
    if (!cleanCitationText(data[key])) errors.push(`${label} is required.`);
  });

  if (usesOpeningNarrative && !['fleet', 'memefleet'].includes(data.attackerType) && !cleanCitationText(data.officerShipName)) {
    errors.push('Officer ship is required.');
  }

  if (templateSource.includes('{{charges}}') && (!Array.isArray(data.charges) || !data.charges.some((item) => cleanCitationText(item)))) {
    errors.push('At least one charge is required.');
  }

  const values = citationSectionValues(data, template);
  template.sections.forEach((section) => {
    if (section.editor !== 'none' && !section.optional && !cleanCitationText(values[section.id])) {
      errors.push(`${section.name} is required.`);
    }
  });

  return errors;
}

export function buildCitation(data) {
  const template = templateForCitation(data);
  const subject = citationSubject(data, template);
  const values = citationSectionValues(data, template);
  const sections = template.sections
    .filter((section) => !(section.optional && !cleanCitationText(values[section.id])))
    .map((section) => renderCitationSection(section, data, values[section.id]));

  const body = sections.join('\n\n===\n\n');

  return { subject, body };
}

export function formatIsk(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) return '';
  return `${new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(Math.round(amount))} ISK`;
}

function pluralizeShipType(shipName) {
  if (/(?:s|x|z|ch|sh)$/i.test(shipName)) return `${shipName}es`;
  if (/[^aeiou]y$/i.test(shipName)) return `${shipName.slice(0, -1)}ies`;
  return `${shipName}s`;
}

export function formatShipTypeCounts(shipNames) {
  const counts = new Map();
  for (const value of shipNames || []) {
    const shipName = cleanCitationText(value) || 'unknown vessel';
    const key = shipName.toLowerCase();
    const existing = counts.get(key);
    if (existing) existing.count += 1;
    else counts.set(key, { name: shipName, count: 1 });
  }

  const orderedShips = [...counts.values()].sort((left, right) => (
    Number(/^(?:capsule|pod)\b/i.test(left.name)) - Number(/^(?:capsule|pod)\b/i.test(right.name))
  ));
  const labels = orderedShips.map(({ name, count }) => (
    count === 1 ? name : `${count} ${pluralizeShipType(name)}`
  ));
  return labels.length
    ? new Intl.ListFormat('en', { style: 'long', type: 'conjunction' }).format(labels)
    : 'unknown vessel';
}

export function availableOffenses(customOffenses = []) {
  const knownIds = new Set(LEGAL_OFFENSES.map((offense) => offense.id));
  const custom = [];
  for (const value of Array.isArray(customOffenses) ? customOffenses : []) {
    const id = cleanCitationText(value?.id);
    const title = cleanCitationText(value?.title);
    const code = cleanCitationText(value?.code);
    const classification = value?.classification === 'Felony' ? 'Felony' : 'Misdemeanor';
    if (!id.startsWith('custom-') || !title || !code || knownIds.has(id)) continue;
    knownIds.add(id);
    custom.push({ id, classification, code, title, custom: true });
  }
  return [...LEGAL_OFFENSES, ...custom];
}

export function sortOffensesAlphabetically(offenses = []) {
  return [...offenses].sort((left, right) => String(left?.title || '').localeCompare(
    String(right?.title || ''),
    'en',
    { sensitivity: 'base', numeric: true }
  ));
}

export function selectedOffenses(offenseIds = [], customOffenses = []) {
  const selected = new Set(Array.isArray(offenseIds) ? offenseIds : []);
  return availableOffenses(customOffenses).filter((offense) => selected.has(offense.id));
}

export function chargesForOffenses(offenseIds = [], customOffenses = []) {
  return selectedOffenses(offenseIds, customOffenses).map((offense) => `${offense.code} | ${offense.title}`);
}

export function activityForOffenses(offenseIds = [], customOffenses = []) {
  const titles = selectedOffenses(offenseIds, customOffenses).map((offense) => offense.title.toLowerCase());
  if (!titles.length) return '';
  return new Intl.ListFormat('en', { style: 'long', type: 'conjunction' }).format(titles);
}

export const HUMOR = [
  'The permit inspection was brief because the vessel had already become several smaller vessels.',
  'The patrol found the paperwork missing, but located every other component across a surprisingly wide area.',
  'WHPD reminds visitors that cloaking is not a substitute for filing the proper forms.',
  'The suspect submitted an involuntary application for the rapid hull disassembly program.',
  'Navigation records indicate the vessel mistook a weapons timer for an appointment reminder.',
  'The hull failed its inspection after inspectors discovered a severe shortage of hull.',
  'The suspect attempted to present a cloak as proof of diplomatic immunity.',
  'Local gravity assisted by keeping the evidence conveniently nearby.',
  'The permit office confirms that ammunition is not an acceptable filing fee.',
  'The vessel achieved full regulatory compliance shortly after reaching zero structural integrity.',
  'The patrol requested identification, and the ship responded by becoming unidentified debris.',
  'A routine traffic stop became considerably easier once all traffic stopped.',
  'The suspect tested the emergency disassembly procedure without completing the required waiver.',
  'The enforcement beacon was clearly visible from every piece of the vessel.',
  'The ship entered the inspection queue at warp speed and left it at salvage speed.',
  'The pilot demonstrated that optimism is not a recognized defensive subsystem.',
  'Investigators found no permit, but they did find an impressive collection of expired excuses.',
  'The vessel was cited for carrying more confidence than tank.',
  'WHPD accepted the wreck as a handwritten confession.',
  'The pilot selected the expedited inspection option by locking the patrol first.',
  'The ship passed through the checkpoint, although not in the same number of pieces.',
  'The suspect claimed diplomatic status on behalf of a corporation nobody had heard of.',
  'The patrol issued a verbal warning, several missiles, and a receipt.',
  'The vessel complied with the order to power down in a remarkably permanent fashion.',
  'The safety demonstration concluded when the capacitor and the argument ran out together.',
  'The pilot discovered that wormhole law has excellent scan resolution.',
  'The inspection uncovered unauthorized modules, contraband confidence, and no exit plan.',
  'The patrol was unable to locate the registration plate after it entered low orbit around the wreck.',
  'The suspect attempted to evade paperwork by creating significantly more paperwork.',
  'The vessel received a passing grade in rapid conversion to recyclable materials.',
  'The pilot requested trial by combat and appeared surprised when the request was approved.',
  'WHPD radar detected a suspicious concentration of optimism around an under-tanked hull.',
  'The ship was stopped for questioning and remained stopped for the rest of the shift.',
  'The suspect provided thermal signatures in place of identification.',
  'The vessel entered J-space as a ship and departed the report as an inventory list.',
  'The patrol confirmed that passive alignment is not a legally recognized alibi.',
  'The pilot filed a complaint using drones, so the patrol returned it using ammunition.',
  'The inspection was delayed while officers counted how many pieces qualified as carry-on luggage.',
  'The vessel failed to maintain a safe distance from law enforcement and from being intact.',
  'The suspect insisted the site was public right up to the private enforcement portion.',
  'The ship attempted to bribe the patrol with loot that became available moments later.',
  'Officers found the emergency exit, though it was roughly ship-shaped and expanding.',
  'The pilot mistook local silence for an absence of local regulations.',
  'The vessel was operating without lights, permits, or a sustainable capacitor.',
  'The patrol issued a citation after determining that explosions were the clearest available language.',
  'The suspect tried to hide behind a signature that every scanner in system could see.',
  'The ship was detained pending an investigation into why it had so many loose components.',
  'WHPD appreciates the vessel for labeling all evidence with convenient item IDs.',
  'The pilot attempted to remain calm while the damage notifications handled the screaming.',
  'The inspection revealed a critical paperwork leak near the engineering section.',
  'The suspect received a complimentary lesson in the difference between cloaked and unscannable.',
  'The vessel stopped resisting once resistance required a functioning power grid.',
  'The patrol found the flight plan ambitious, creative, and entirely incompatible with survival.',
  'The ship was cited for excessive speed, then helped achieve a speed of zero.',
  'The pilot presented a mining permit for an activity that looked suspiciously like trespassing.',
  'The vessel qualified for the WHPD single-use ship recycling incentive.',
  'The patrol requested the cargo manifest and received the cargo instead.',
  'The suspect attempted to negotiate after all negotiating modules had been disabled.',
  'The ship entered the system quietly but left a very loud administrative record.',
  'Officers noted that the vessel had excellent escape velocity and no escape route.',
  'The pilot relied on surprise, which had already been requisitioned by WHPD.',
  'The inspection team discovered that reinforced confidence does not receive resistance bonuses.',
  'The vessel was cited for improper parking in a location where parking became unavoidable.',
  'The suspect demonstrated advanced evasive maneuvers around every exit except the correct one.',
  'The patrol verified the hull number by collecting it from several nearby containers.',
  'The ship responded to a lawful stop order with an unlawful amount of overheating.',
  'The pilot attempted to outsource compliance to drones, but the drones declined.',
  'The vessel was carrying sufficient ammunition for every contingency except this one.',
  'The patrol found the suspect guilty of operating a ship while dramatically outnumbered.',
  'The inspection became contactless when the ship ceased to have a continuous surface.',
  'The pilot declined to answer questions, and the wreck was equally uncooperative.',
  'The vessel was detained for lacking both authorization and an adequate buffer tank.',
  'WHPD determined that the safest place for the ship was evenly distributed across the grid.',
  'The suspect mistook a polarized fit for a strong legal position.',
  'The patrol admired the ship fit briefly before converting it into public evidence.',
  'The vessel submitted its insurance claim before officers had finished writing the citation.',
  'The pilot attempted to invoke local custom without first checking who defines local custom.',
  'The ship was operating under the influence of a dangerously optimistic directional scan.',
  'The inspection team found every required document except the ones that existed.',
  'The suspect chose not to stop, so WHPD arranged a more dependable stopping method.',
  'The vessel demonstrated excellent agility after being reduced to massless paperwork.',
  'The pilot asked whether this would go on the permanent record, which amused the permanent record.',
  'The patrol identified several safety violations and one rapidly growing cloud of proof.',
  'The ship entered the engagement with a plan and left it with a lesson.',
  'The suspect attempted to tank the citation but had fitted for the wrong damage type.',
  'Officers found the vessel suspicious because it was the only thing in system pretending not to be suspicious.',
  'The inspection concluded ahead of schedule after the ship waived all remaining hit points.',
  'The pilot offered a perfectly reasonable explanation at a perfectly unreasonable range.',
  'The vessel was cited for failure to yield to blue lights, webs, and overwhelming evidence.',
  'The patrol recovered the missing permits from the same location as the surviving hull sections: nowhere.',
  'The suspect relied on local chat for legal advice in a system without local chat.',
  'The ship was found guilty by a jury of its peers, most of which were combat probes.',
  'The pilot attempted a tactical withdrawal that became an archaeological deposit.',
  'The vessel received immediate roadside assistance from the salvage department.',
  'The patrol requested that the suspect remain on grid, and the warp disruptor handled the scheduling.',
  'The inspection found the ship fit for purpose, provided the purpose was producing a wreck.',
  'The suspect entered without permission and exited without a ship.',
  'The vessel was cited for an unsafe quantity of faith in directional scan.',
  'The pilot discovered that hole control also includes control over who keeps a hull.',
  'The patrol documented the event using high-resolution sensors and low-resolution diplomacy.',
  'The ship attempted to conceal evidence by turning all of it into loot.',
  'The suspect asked for a warning, but the weapons systems had already selected a different template.',
  'The vessel completed a mandatory conversion from private property to public safety exhibit.',
  'WHPD found the pilot cooperative once the propulsion, weapons, and remaining objections were offline.'
];

export const FINAL_NOTES = [
  'WHPD appreciates the pilot\'s enthusiastic participation in today\'s unannounced safety demonstration.',
  'Compliance remains optional right up until the patrol arrives, at which point it becomes extremely fashionable.',
  'Fly curious, file your permits, and remember that local law travels at warp speed.',
  'Thank you for helping WHPD keep wormhole paperwork exciting and salvage crews employed.',
  'Thank you for visiting J-space; your feedback has been converted into combat telemetry.',
  'Please retain this citation for your records, assuming the wreck did not already retain it.',
  'WHPD wishes you a safer return trip with more permits and fewer target locks.',
  'Your cooperation helps keep wormhole space orderly, mysterious, and adequately salvaged.',
  'We hope this experience inspires a lasting commitment to paperwork and better scouting.',
  'Thank you for supporting local law enforcement through your generous module donation.',
  'Please fly safely, scan often, and yield promptly to authorized blue lights.',
  'WHPD looks forward to reviewing your improved compliance fit on a future visit.',
  'Your citation is valid throughout J-space and invalid as an excuse everywhere.',
  'We appreciate your contribution to officer training and the regional scrap supply.',
  'May your next route contain fewer patrols and considerably more completed forms.',
  'Please remember that good bookmarks prevent bad meetings with government officials.',
  'WHPD remains available around the clock because wormholes refuse to observe office hours.',
  'Thank you for choosing the official WHPD rapid inspection service.',
  'We hope your next vessel arrives equipped with permits in the appropriate slots.',
  'This matter is considered closed, unlike the wormhole you entered through.',
  'Your prompt payment in modules has been noted with sincere departmental gratitude.',
  'Please share this safety lesson with friends before they become separate case numbers.',
  'WHPD encourages all pilots to practice responsible scanning and irresponsible amounts of paperwork.',
  'We wish you good luck, good probes, and better judgment on your next excursion.',
  'Thank you for helping demonstrate why local regulations include an enforcement section.',
  'May this citation guide you toward safer fits and more respectful trespassing.',
  'The department appreciates your patience during the involuntary portion of the inspection.',
  'Please keep a copy of this notice somewhere more durable than the previous ship.',
  'WHPD hopes your replacement vessel enjoys a longer and more compliant service life.',
  'Your case has been filed under lessons that were technically optional.',
  'Thank you for adding valuable data to the WHPD public safety archive.',
  'We trust the next directional scan will receive the attention it deserves.',
  'Please remember that every unexplained combat probe is a potential government survey.',
  'WHPD wishes you a pleasant medical clone activation and a productive rest of the day.',
  'This citation concludes the formalities; salvage operations may continue without applause.',
  'Thank you for respecting the authority that became apparent during the engagement.',
  'Future compliance may be submitted electronically, preferably before weapons cycle.',
  'We appreciate your role in making wormhole enforcement both necessary and entertaining.',
  'Please consider fitting a permit where the misplaced confidence module used to be.',
  'WHPD encourages you to return after reviewing the Legal Library and upgrading the tank.',
  'Your participation has improved local safety statistics by one entire wreck.',
  'May your next site remain peaceful, profitable, and conspicuously permitted.',
  'Thank you for testing the patrol response time under realistic conditions.',
  'WHPD has completed the inspection and found the resulting wreck fully transparent.',
  'Please inform your corporation that group permit rates may be available upon surrender.',
  'We hope this notice reaches you before the insurance payout encourages another experiment.',
  'Your cooperation will be remembered until the local database is cleared or civilization ends.',
  'Thank you for keeping our officers current on practical hull disassembly techniques.',
  'WHPD wishes you smooth connections and a healthy suspicion of scanner silence.',
  'Please treat this citation as a friendly reminder with unusually high application damage.',
  'The department values your business and your former high slots.',
  'We hope your next encounter with local government involves fewer ammunition charges.',
  'Thank you for demonstrating the importance of reading signs that are not physically posted.',
  'WHPD remains committed to protecting J-space from unlicensed enthusiasm.',
  'Please conduct all future trespassing in accordance with posted imaginary regulations.',
  'Your case is now closed, indexed, cross-referenced, and probably being laughed about.',
  'Thank you for selecting the premium enforcement package with complimentary evidence links.',
  'WHPD wishes your crew a swift recovery and your quartermaster a patient afternoon.',
  'Please note that repeat customers may qualify for increasingly personalized citations.',
  'We appreciate your effort to keep local salvage professionals gainfully employed.',
  'May your next clone remember the paperwork even if the previous ship did not.',
  'Thank you for confirming that the patrol doctrine continues to function as advertised.',
  'WHPD hopes this administrative experience was as educational as it was expensive.',
  'Please scan both sides before crossing any unmarked jurisdictional boundary.',
  'Your compliance rating may improve automatically after several incident-free minutes.',
  'Thank you for your generous and entirely involuntary support of community policing.',
  'WHPD recommends a balanced diet of probes, patience, and properly filed travel plans.',
  'Please remember that absence of visible officers is not evidence of absent officers.',
  'We hope your next visit includes advance notice and fewer overheated modules.',
  'The department has accepted your wreck as proof of receipt.',
  'Thank you for participating in the J-space consequences awareness program.',
  'Please direct any appeal to the nearest officer currently holding grid control.',
  'WHPD wishes you better fortune and substantially better reconnaissance.',
  'Your incident has been resolved to the satisfaction of everyone still on grid.',
  'Thank you for making local enforcement metrics look especially productive today.',
  'Please consider this notice both a citation and a strongly worded fitting recommendation.',
  'WHPD encourages you to bookmark the lesson, not merely the route home.',
  'We hope the next wormhole you enter contains exactly the amount of police you expect.',
  'Thank you for your calm professionalism during the parts when calm professionalism was possible.',
  'Your contribution to the evidence locker is appreciated and may already be on contract.',
  'Please allow several business seconds for the lesson to appear on zKillboard.',
  'WHPD wishes you a speedy reship and a slow, careful return.',
  'This citation may be shown to future patrols as evidence that you were warned very thoroughly.',
  'Thank you for proving that public safety can also be publicly entertaining.',
  'Please keep all future hulls inside the permitted quantity of explosions.',
  'WHPD remains grateful for every pilot who makes the regulations feel necessary.',
  'We hope this outcome encourages thoughtful route planning and tasteful defensive modules.',
  'Your paperwork has been completed using the traditional high-velocity signature method.',
  'Thank you for contributing one practical example to the next officer briefing.',
  'Please remember that a clean record begins immediately after the most recent citation.',
  'WHPD wishes you success in all lawful, permitted, and adequately scouted endeavors.',
  'Your visit has been recorded as brief, memorable, and administratively complete.',
  'Thank you for choosing J-space, where even the citations require scanning.',
  'Please accept our best wishes and this nontransferable reminder to check directional scan.',
  'WHPD hopes your next encounter is with a customs form rather than a combat patrol.',
  'Your case officer reports that the regulations performed exactly as designed.',
  'Thank you for leaving the system cleaner, quieter, and short one unauthorized vessel.',
  'Please fly with care; replacement paperwork can be harder to source than replacement hulls.',
  'WHPD appreciates the opportunity to combine public service with practical education.',
  'We hope your corporation recognizes this citation as a valuable training expense.',
  'Your next permit application will be reviewed with the warmth reserved for repeat visitors.',
  'Thank you for helping preserve the sanctity of J-space one cautionary example at a time.',
  'Please remember that WHPD is always nearby in the administrative sense.',
  'Fly prepared, remain curious, and keep the permit office out of weapons range.'
];

function randomLibraryEntry(entries, random = Math.random) {
  const roll = Number(random());
  const normalizedRoll = Number.isFinite(roll) ? Math.min(Math.max(roll, 0), 0.9999999999999999) : 0;
  return entries[Math.floor(normalizedRoll * entries.length)];
}

function cleanTemplateText(value, maximumLength = 4000) {
  return withoutEmoji(String(value ?? ''))
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/[—–]/g, '-')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, maximumLength);
}

function cleanTemplateBody(value, maximumLength = 12000) {
  const clean = withoutEmoji(String(value ?? ''))
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/[—–]/g, '-')
    .replace(/\r\n?/g, '\n')
    .trim()
    .slice(0, maximumLength);
  const allowedTag = (tag) => (
    /^<\/?b>$/i.test(tag)
    || /^<br\s*\/?>$/i.test(tag)
    || /^<\/font>$/i.test(tag)
    || /^<font color="(?:#[a-f0-9]{6,8}|red|white|green)">$/i.test(tag)
    || /^<\/a>$/i.test(tag)
    || /^<a href="(?:https:\/\/[^"<>\s]+|showinfo:\d+\/\/\d+)">$/i.test(tag)
  );
  return clean.replace(/<[^>]*>|[<>]/g, (tag) => (allowedTag(tag) ? tag : escapeHtml(tag)));
}

function legacyTemplateSections(value) {
  const defaults = DEFAULT_CITATION_TEMPLATE.sections.map((section) => ({ ...section }));
  const values = {
    [DEFAULT_CITATION_SECTION_IDS.opening]: value?.humor,
    [DEFAULT_CITATION_SECTION_IDS.evidence]: value?.evidence,
    [DEFAULT_CITATION_SECTION_IDS.officerComments]: value?.officerComments,
    [DEFAULT_CITATION_SECTION_IDS.finalNote]: value?.finalNote
  };
  return defaults.map((section) => (
    Object.prototype.hasOwnProperty.call(values, section.id)
      ? { ...section, defaultValue: values[section.id] ?? section.defaultValue }
      : section
  ));
}

export function normalizeCitationSection(value) {
  const id = cleanCitationText(value?.id).toLowerCase();
  const name = cleanCitationText(value?.name).slice(0, 100);
  const body = cleanTemplateBody(value?.body);
  const editor = ['none', 'text', 'list'].includes(value?.editor) ? value.editor : 'none';
  if (!/^[a-z0-9][a-z0-9-]{2,127}$/.test(id) || !name || !body) return null;
  return {
    id,
    name,
    body,
    editor,
    defaultValue: editor === 'none' ? '' : cleanTemplateText(value?.defaultValue),
    optional: editor === 'none' ? false : Boolean(value?.optional)
  };
}

export function normalizeCitationTemplate(value) {
  const id = cleanCitationText(value?.id).toLowerCase();
  const name = cleanCitationText(value?.name).slice(0, 80);
  const subject = cleanTemplateText(value?.subject ?? DEFAULT_CITATION_TEMPLATE.subject, 300);
  if (!/^[a-z0-9][a-z0-9-]{2,127}$/.test(id) || !name || !subject) return null;
  const sourceSections = Array.isArray(value?.sections) ? value.sections : legacyTemplateSections(value);
  const sections = sourceSections.map(normalizeCitationSection).filter(Boolean);
  if (!sections.length
    || sections.length !== sourceSections.length
    || new Set(sections.map((section) => section.id)).size !== sections.length) return null;
  return { id, name, subject, sections };
}

export function citationTemplateUsesOffenses(value) {
  const template = normalizeCitationTemplate(value);
  const source = template ? `${template.subject}\n${template.sections.map((section) => section.body).join('\n')}` : '';
  return /\{\{\s*(?:openingNarrative|charges|activity)\s*\}\}/.test(source);
}

export function citationTemplates(values = []) {
  let standard = normalizeCitationTemplate(DEFAULT_CITATION_TEMPLATE);
  let minimal = normalizeCitationTemplate(MINIMAL_CITATION_TEMPLATE);
  const custom = [];
  const knownIds = new Set([DEFAULT_CITATION_TEMPLATE_ID, MINIMAL_CITATION_TEMPLATE_ID]);

  for (const value of Array.isArray(values) ? values : []) {
    const template = normalizeCitationTemplate(value);
    if (!template) continue;
    if (template.id === DEFAULT_CITATION_TEMPLATE_ID) {
      standard = template.name === 'WHPD Standard'
        ? { ...template, name: DEFAULT_CITATION_TEMPLATE.name }
        : template;
      continue;
    }
    if (template.id === MINIMAL_CITATION_TEMPLATE_ID) {
      minimal = template;
      continue;
    }
    if (knownIds.has(template.id)) continue;
    knownIds.add(template.id);
    custom.push(template);
  }

  return [standard, minimal, ...custom];
}

export function findCitationTemplate(values = [], templateId = DEFAULT_CITATION_TEMPLATE_ID) {
  const templates = citationTemplates(values);
  return templates.find((template) => template.id === templateId) || templates[0];
}

function renderTemplateText(value, replacements) {
  return cleanTemplateText(value).replace(/\{\{\s*([a-zA-Z][a-zA-Z0-9]*)\s*\}\}/g, (token, key) => (
    Object.prototype.hasOwnProperty.call(replacements, key) ? replacements[key] : token
  ));
}

function renderCitationSubject(value, data) {
  const replacements = {
    title: cleanCitationText(data?.title || `${data?.pilotName || 'Pilot'} encountered WHPD`),
    pilotName: cleanCitationText(data?.pilotName),
    corporationName: cleanCitationText(data?.corporationName),
    allianceName: cleanCitationText(data?.allianceName),
    systemName: cleanCitationText(data?.systemName),
    activity: cleanCitationText(data?.activity),
    officerName: cleanCitationText(data?.officerName),
    officerShipName: cleanCitationText(data?.officerShipName),
    destroyedShipName: cleanCitationText(data?.destroyedShipName),
    totalValue: cleanCitationText(data?.totalValue)
  };
  return renderTemplateText(value, replacements);
}

function citationSubject(data, template = templateForCitation(data)) {
  if (Object.prototype.hasOwnProperty.call(data || {}, 'subject')) {
    return cleanCitationText(data.subject).slice(0, 132);
  }
  if (cleanCitationText(data?.subjectOverride)) {
    return cleanCitationText(data.subjectOverride).slice(0, 132);
  }
  return cleanCitationText(renderCitationSubject(template.subject, data)).slice(0, 132);
}

function defaultEvidenceForDraft(draft) {
  const hasCombatRecords = Array.isArray(draft?.sourceKillmailIds) && draft.sourceKillmailIds.length > 0;
  return hasCombatRecords
    ? `Combat telemetry places ${cleanCitationText(draft?.destroyedShipName) || 'the detained vessel'} in ${cleanCitationText(draft?.systemName) || 'the reported system'}.`
    : 'Officer observations were recorded and entered into evidence.';
}

function plainTemplateReplacements(draft, random = Math.random) {
  return {
    title: cleanCitationText(draft?.title),
    pilotName: cleanCitationText(draft?.pilotName),
    corporationName: cleanCitationText(draft?.corporationName),
    allianceName: cleanCitationText(draft?.allianceName),
    systemName: cleanCitationText(draft?.systemName),
    activity: cleanCitationText(draft?.activity),
    officerName: cleanCitationText(draft?.officerName),
    officerShipName: cleanCitationText(draft?.officerShipName),
    destroyedShipName: cleanCitationText(draft?.destroyedShipName),
    totalValue: cleanCitationText(draft?.totalValue),
    defaultEvidence: defaultEvidenceForDraft(draft),
    randomHumor: randomLibraryEntry(HUMOR, random),
    randomFinalNote: randomLibraryEntry(FINAL_NOTES, random)
  };
}

function listFromSectionValue(value) {
  return String(value ?? '')
    .split(/\r?\n/)
    .map(cleanCitationText)
    .filter(Boolean);
}

function templateForCitation(data) {
  return normalizeCitationTemplate(data?.citationTemplate) || normalizeCitationTemplate(DEFAULT_CITATION_TEMPLATE);
}

function citationSectionValues(data, template = templateForCitation(data)) {
  const supplied = data?.sectionValues && typeof data.sectionValues === 'object' ? data.sectionValues : {};
  const legacy = {
    [DEFAULT_CITATION_SECTION_IDS.opening]: data?.humor,
    [DEFAULT_CITATION_SECTION_IDS.evidence]: Array.isArray(data?.evidence) ? data.evidence.join('\n') : data?.evidence,
    [DEFAULT_CITATION_SECTION_IDS.officerComments]: Array.isArray(data?.officerComments) ? data.officerComments.join('\n') : data?.officerComments,
    [DEFAULT_CITATION_SECTION_IDS.finalNote]: data?.finalNote
  };
  return Object.fromEntries(template.sections.map((section) => [
    section.id,
    cleanTemplateText(Object.prototype.hasOwnProperty.call(supplied, section.id) ? supplied[section.id] : legacy[section.id])
  ]));
}

function renderCitationSection(section, data, sectionValue = '') {
  const items = listFromSectionValue(sectionValue);
  const scalar = (value) => escapeHtml(cleanCitationText(value));
  const replacements = {
    pilotName: scalar(data.pilotName),
    corporationName: scalar(data.corporationName),
    allianceName: scalar(data.allianceName),
    systemName: scalar(data.systemName),
    activity: scalar(data.activity),
    officerName: scalar(data.officerName),
    officerShipName: scalar(data.officerShipName),
    destroyedShipName: scalar(data.destroyedShipName),
    totalValue: scalar(data.totalValue),
    openingNarrative: openingNarrative(data, sectionValue),
    charges: chargeBullets(data.charges).join('\n'),
    evidence: evidenceBullets(data, items).join('\n'),
    content: scalar(sectionValue),
    contentWhite: white(sectionValue),
    contentBullets: whiteBullets(items, '').join('\n'),
    officerComments: whiteBullets(items, '').join('\n'),
    finalNote: white(sectionValue),
    humor: scalar(sectionValue)
  };
  return section.body.replace(/\{\{\s*([a-zA-Z][a-zA-Z0-9]*)\s*\}\}/g, (token, key) => (
    Object.prototype.hasOwnProperty.call(replacements, key) ? replacements[key] : token
  ));
}

export function applyCitationTemplate(draft, template = DEFAULT_CITATION_TEMPLATE, random = Math.random) {
  const normalized = normalizeCitationTemplate(template) || normalizeCitationTemplate(DEFAULT_CITATION_TEMPLATE);
  const replacements = plainTemplateReplacements(draft, random);
  const sectionValues = Object.fromEntries(normalized.sections.map((section) => [
    section.id,
    section.editor === 'none' ? '' : renderTemplateText(section.defaultValue, replacements)
  ]));
  const openingValue = sectionValues[DEFAULT_CITATION_SECTION_IDS.opening] || '';
  const evidence = listFromSectionValue(sectionValues[DEFAULT_CITATION_SECTION_IDS.evidence]);
  const officerComments = listFromSectionValue(sectionValues[DEFAULT_CITATION_SECTION_IDS.officerComments]);
  const finalNote = sectionValues[DEFAULT_CITATION_SECTION_IDS.finalNote] || '';
  const subject = cleanCitationText(renderCitationSubject(normalized.subject, draft)).slice(0, 132);

  return {
    ...draft,
    templateId: normalized.id,
    citationTemplate: normalized,
    sectionValues,
    subject,
    humor: openingValue,
    evidence,
    officerComments,
    finalNote
  };
}

export function makeCitationDraft(killmail, _deliverySender, offenseIds = DEFAULT_OFFENSE_IDS, random = Math.random, template = DEFAULT_CITATION_TEMPLATE) {
  const victimName = killmail.enriched?.victimName || 'Unknown pilot';
  const systemName = killmail.enriched?.systemName || 'Unknown system';
  const relatedKillmails = Array.isArray(killmail.relatedKillmails) && killmail.relatedKillmails.length
    ? killmail.relatedKillmails
    : [{ id: killmail.id, shipName: killmail.enriched?.victimShipName || 'unknown vessel', isPod: false }];
  const destroyedShipName = formatShipTypeCounts(
    relatedKillmails.map((record) => record.shipName || 'unknown vessel')
  );
  const killmailIds = relatedKillmails.map((record) => Number(record.id)).filter(Boolean);
  const officerName = killmail.enriched?.officerName
    || killmail.enriched?.finalBlowName
    || 'Unassigned WHPD officer';
  const officerShipName = killmail.enriched?.officerShipName
    || killmail.enriched?.finalBlowShipName
    || 'WHPD patrol vessel';

  const customOffenses = availableOffenses(killmail.customOffenses).filter((offense) => offense.custom);
  const normalizedOffenseIds = selectedOffenses(offenseIds, customOffenses).map((offense) => offense.id);

  const draft = {
    sourceKillmailIds: killmailIds,
    title: `${victimName} in ${systemName}`,
    pilotName: victimName,
    corporationName: killmail.enriched?.victimCorporationName || 'an unaffiliated corporation',
    allianceName: killmail.enriched?.victimAllianceName || '',
    systemName,
    offenseIds: normalizedOffenseIds,
    activity: activityForOffenses(normalizedOffenseIds, customOffenses),
    attackerType: ['officer', 'deputy', 'fleet', 'memefleet'].includes(killmail.attackerType)
      ? killmail.attackerType
      : 'officer',
    officerName,
    officerShipName,
    destroyedShipName,
    totalValue: formatIsk(killmail.totalValue),
    humor: '',
    charges: chargesForOffenses(normalizedOffenseIds, customOffenses),
    evidence: [
      `Combat telemetry places ${destroyedShipName} in ${systemName}.`
    ],
    officerComments: [],
    finalNote: '',
    zkillUrl: `https://zkillboard.com/kill/${killmail.id}/`,
    zkillRecords: relatedKillmails.map((record) => {
      const recordPilot = cleanCitationText(record.pilotName) || victimName;
      const recordShip = cleanCitationText(record.shipName) || 'unknown vessel';
      return {
        killmailId: record.id,
        killmailHash: record.hash,
        zkillUrl: `https://zkillboard.com/kill/${record.id}/`,
        label: `${recordPilot} ${recordShip}`
      };
    })
  };
  return applyCitationTemplate(draft, template, random);
}

export function makeManualCitationDraft(officer = null, offenseIds = DEFAULT_OFFENSE_IDS, random = Math.random, customOffenses = [], template = DEFAULT_CITATION_TEMPLATE) {
  const normalizedCustomOffenses = availableOffenses(customOffenses).filter((offense) => offense.custom);
  const normalizedOffenseIds = selectedOffenses(offenseIds, normalizedCustomOffenses).map((offense) => offense.id);

  const draft = {
    sourceKillmailIds: [],
    title: '',
    pilotName: '',
    corporationName: '',
    allianceName: '',
    systemName: '',
    offenseIds: normalizedOffenseIds,
    activity: activityForOffenses(normalizedOffenseIds, normalizedCustomOffenses),
    attackerType: 'officer',
    officerName: cleanCitationText(officer?.name),
    officerShipName: '',
    destroyedShipName: '',
    totalValue: '',
    humor: '',
    charges: chargesForOffenses(normalizedOffenseIds, normalizedCustomOffenses),
    evidence: ['Officer observations were recorded and entered into evidence.'],
    officerComments: [],
    finalNote: '',
    zkillUrl: '',
    zkillRecords: []
  };
  return applyCitationTemplate(draft, template, random);
}
