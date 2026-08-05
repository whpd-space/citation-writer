import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  activityForOffenses,
  availableOffenses,
  CITATION_FOOTER,
  CITATION_HEADERS,
  FINAL_NOTES,
  HUMOR,
  buildCitation,
  chargesForOffenses,
  cleanCitationText,
  formatIsk,
  formatShipTypeCounts,
  LEGAL_OFFENSES,
  makeCitationDraft,
  sortOffensesAlphabetically,
  validateCitation
} from '../js/citation.js';
import { APP_CONFIG } from '../js/config.js';
import { buildMailRecipients, extractZkillKillmail, extractZkillValue, parseZkillKillmailId } from '../js/esi.js';
import { formatRelativeTime, formatUtcDateTime, isoUtcDateTime } from '../js/time.js';
import { attackerRoleForFinalBlow, classifyKillmail, combineKillmailGroups, countDistinctAttackingPilots, groupKillmails, isPodKillmail, POD_PAIR_WINDOW_MS, selectInvolvedOfficer } from '../js/killmail-groups.js';

const completeDraft = {
  title: 'Permit inspection in J123456',
  pilotName: 'Definitely Innocent',
  corporationName: 'Totally Legal Ventures',
  allianceName: 'Nothing Suspicious',
  systemName: 'J123456',
  offenseIds: ['criminal-trespass', 'theft'],
  activity: 'criminal trespass and theft',
  officerName: 'Officer Example',
  officerShipName: 'Loki',
  destroyedShipName: 'Venture',
  totalValue: '42,000,000 ISK',
  humor: 'The permit was found immediately after the ship stopped being one piece.',
  charges: [
    'IUS Lex Penal Code - PENAL § 30.05 | Criminal Trespass',
    'IUS Lex Penal Code - PENAL § 31.03 | Theft'
  ],
  evidence: ['Patrol telemetry confirms the detention.'],
  officerComments: ['Suspect requested a complimentary permit review.'],
  finalNote: 'Please file the proper forms before returning.',
  zkillUrl: 'https://zkillboard.com/kill/123/'
};

test('builds the exact subject prefix and required ordered sections', () => {
  const citation = buildCitation(completeDraft);
  assert.equal(citation.subject, 'Citation Issued: Permit inspection in J123456');

  const ordered = [
    CITATION_HEADERS.charges,
    CITATION_HEADERS.evidence,
    CITATION_HEADERS.officerComments,
    CITATION_HEADERS.note,
    CITATION_HEADERS.disclaimer,
    CITATION_FOOTER
  ];
  let prior = -1;
  for (const section of ordered) {
    const position = citation.body.indexOf(section);
    assert.ok(position > prior, `${section} should appear in order`);
    prior = position;
  }
  assert.equal(citation.body.match(/\n\n===\n\n/g)?.length, 6);
  const narrativeText = citation.body.split('\n\n===')[0].replace(/<[^>]+>/g, '');
  assert.ok(narrativeText.includes('Pilot Definitely Innocent of Totally Legal Ventures, operating under Nothing Suspicious'));
  assert.ok(narrativeText.includes('was detained in J123456 while conducting criminal trespass and theft'));
  assert.ok(narrativeText.includes('Officer Example arrived in Loki'));
  assert.ok(!narrativeText.includes('Officer Officer Example'));
});

test('uses only the citation rule block HTML tags', () => {
  const { body } = buildCitation(completeDraft);
  const tags = [...body.matchAll(/<\/?([a-z0-9]+)\b[^>]*>/gi)].map((match) => match[1].toLowerCase());
  assert.deepEqual([...new Set(tags)].sort(), ['a', 'b', 'br', 'font']);
  assert.equal((body.match(/<br\/?\s*>/gi) || []).length, 1, 'only the fixed footer may contain a br tag');
  assert.ok(!body.includes('—'));
  assert.ok(!body.includes('–'));
});

test('keeps disclaimer and footer fixed', () => {
  const { body } = buildCitation(completeDraft);
  assert.ok(body.includes('<font color="white">If you\'re taking any of this seriously you\'re doing it wrong!</font>'));
  assert.ok(body.endsWith(CITATION_FOOTER));
});

test('matches the fixed blocks in citation.md without changing the rule file', () => {
  const rules = readFileSync(new URL('../citation.md', import.meta.url), 'utf8');
  const footer = rules.match(/## 16\. Fixed footer\s+``` html\s+([^]*?)\s+```/)?.[1];
  const chargeHeader = rules.match(/## 11\. Misdemeanors & Felonies[^]*?``` html\s+([^]*?)\s+```/)?.[1];
  assert.equal(footer, CITATION_FOOTER);
  assert.equal(chargeHeader, CITATION_HEADERS.charges);
});

test('escapes supplied facts and rejects unsafe evidence links', () => {
  const { body } = buildCitation({
    ...completeDraft,
    pilotName: '<script>alert(1)</script>',
    finalNote: 'Nice work 😈 — probably.',
    zkillUrl: 'javascript:alert(1)'
  });
  assert.ok(!body.includes('<script>'));
  assert.ok(body.includes('&lt;script&gt;'));
  assert.ok(!body.includes('javascript:'));
  assert.ok(!body.includes('😈'));
  assert.ok(!body.includes('—'));
});

test('validates every required citation component', () => {
  assert.deepEqual(validateCitation(completeDraft), []);
  const errors = validateCitation({ ...completeDraft, totalValue: '', charges: [], officerComments: [] });
  assert.ok(errors.includes('Total value is required.'));
  assert.ok(errors.includes('At least one charge is required.'));
  assert.ok(!errors.some((error) => error.toLowerCase().includes('comment')));
});

test('omits the optional Officer Comments section and its separator when blank', () => {
  const withComments = buildCitation(completeDraft).body;
  const withoutComments = buildCitation({ ...completeDraft, officerComments: [] }).body;
  assert.ok(withComments.includes(CITATION_HEADERS.officerComments));
  assert.ok(!withoutComments.includes(CITATION_HEADERS.officerComments));
  assert.equal((withComments.match(/\n\n===\n\n/g) || []).length, 6);
  assert.equal((withoutComments.match(/\n\n===\n\n/g) || []).length, 5);
});

test('creates a complete draft from an enriched killmail', () => {
  const draft = makeCitationDraft({
    id: 123,
    totalValue: 42_000_000,
    enriched: {
      victimName: 'Definitely Innocent',
      victimCorporationName: 'Totally Legal Ventures',
      victimAllianceName: '',
      victimShipName: 'Venture',
      systemName: 'J123456',
      finalBlowName: 'Officer Example',
      finalBlowShipName: 'Loki',
      senderShips: { 456: 'Loki' }
    }
  }, { id: 456, name: 'Officer Example' }, ['criminal-trespass', 'theft']);

  assert.equal(draft.totalValue, '42,000,000 ISK');
  assert.equal(draft.officerShipName, 'Loki');
  assert.deepEqual(draft.offenseIds, ['criminal-trespass', 'theft']);
  assert.equal(draft.activity, 'criminal trespass and theft');
  assert.ok(draft.charges.some((charge) => charge.includes('PENAL § 30.05')));
  assert.deepEqual(validateCitation(draft), []);
});

test('keeps the involved officer separate from an uninvolved EVE Mail sender', () => {
  const draft = makeCitationDraft({
    id: 124,
    totalValue: 1_000_000,
    enriched: {
      victimName: 'A Pilot',
      victimCorporationName: 'A Corporation',
      victimShipName: 'Venture',
      systemName: 'J654321',
      finalBlowName: 'Another Officer',
      finalBlowShipName: 'Loki',
      senderShips: {}
    }
  }, { id: 999, name: 'Desk Officer' });
  assert.equal(draft.officerName, 'Another Officer');
  assert.equal(draft.officerShipName, 'Loki');
  assert.ok(!buildCitation({
    ...draft,
    offenseIds: ['criminal-trespass'],
    activity: activityForOffenses(['criminal-trespass']),
    charges: chargesForOffenses(['criminal-trespass'])
  }).body.includes('Desk Officer'));
  assert.deepEqual(draft.offenseIds, []);
  assert.ok(validateCitation(draft).includes('Activity is required.'));
});

test('renders Officer, Deputy, Fleet, and Memefleet attacker identities', () => {
  const officerText = buildCitation({ ...completeDraft, attackerType: 'officer', officerName: 'Squizz Caphinator' }).body.replace(/<[^>]+>/g, '');
  const deputyText = buildCitation({ ...completeDraft, attackerType: 'deputy', officerName: 'Squizz Caphinator' }).body.replace(/<[^>]+>/g, '');
  const fleetText = buildCitation({ ...completeDraft, attackerType: 'fleet', officerName: '7 Fleet Participants' }).body.replace(/<[^>]+>/g, '');
  const memefleetText = buildCitation({ ...completeDraft, attackerType: 'memefleet', officerName: '11 Memefleet Participants' }).body.replace(/<[^>]+>/g, '');

  assert.ok(officerText.includes('Officer Squizz Caphinator arrived'));
  assert.ok(deputyText.includes('Deputy Squizz Caphinator arrived'));
  assert.ok(fleetText.includes('7 Fleet Participants arrived and dismantled'));
  assert.ok(memefleetText.includes('11 Memefleet Participants arrived and dismantled'));
  assert.ok(!fleetText.includes('arrived in Loki'));
  assert.ok(!fleetText.includes('Officer 7 Fleet Participants'));
  assert.deepEqual(validateCitation({
    ...completeDraft,
    attackerType: 'fleet',
    officerName: '7 Fleet Participants',
    officerShipName: ''
  }), []);
});

test('selects the actual managed officer without using the delivery character', () => {
  const attackers = [
    { character_id: 10, ship_type_id: 1, damage_done: 500 },
    { character_id: 20, ship_type_id: 2, damage_done: 100, final_blow: true },
    { character_id: 30, ship_type_id: 3, damage_done: 900, final_blow: true }
  ];
  assert.equal(selectInvolvedOfficer(attackers, new Set([10, 20])).character_id, 20);
  assert.equal(selectInvolvedOfficer(attackers, new Set([10])).character_id, 10);
  assert.equal(selectInvolvedOfficer(attackers, new Set([99])), null);
});

test('counts distinct capsuleer attackers and auto-selects deputies by final-blow corporation', () => {
  const records = [
    { detail: { attackers: [{ character_id: 10 }, { character_id: 20 }, { corporation_id: 30 }] } },
    { detail: { attackers: [{ character_id: 20 }, { character_id: 40, final_blow: true, corporation_id: 98653604 }] } }
  ];
  assert.equal(countDistinctAttackingPilots(records), 3);
  assert.equal(attackerRoleForFinalBlow(records[1]), 'deputy');
  assert.equal(attackerRoleForFinalBlow(records[1], { 40: 'officer' }), 'officer');
  assert.equal(attackerRoleForFinalBlow({ detail: { attackers: [{ character_id: 50, final_blow: true, corporation_id: 123 }] } }), 'officer');
});

test('allows manually imported capsuleer kills to be selected while preserving genuine WHPD losses', () => {
  const unrelatedAttackers = [{ character_id: 20, final_blow: true }];
  assert.deepEqual(classifyKillmail(9001, unrelatedAttackers, new Set([10]), true), {
    direction: 'action',
    actionable: true
  });
  assert.deepEqual(classifyKillmail(9001, unrelatedAttackers, new Set([10]), false), {
    direction: 'assist',
    actionable: false
  });
  assert.deepEqual(classifyKillmail(10, unrelatedAttackers, new Set([10]), true), {
    direction: 'loss',
    actionable: false
  });
});

test('format helpers normalize app-facing values', () => {
  assert.equal(formatIsk(1234567.89), '1,234,568 ISK');
  assert.equal(formatIsk(0), '');
  assert.equal(formatShipTypeCounts(['Heron', 'Heron', 'Heron']), '3 Herons');
  assert.equal(formatShipTypeCounts(['Heron', 'Capsule', 'Heron', 'Capsule', 'Heron']), '3 Herons and 2 Capsules');
  assert.equal(formatShipTypeCounts(['Capsule', 'Heron', 'Capsule', 'Venture']), 'Heron, Venture, and 2 Capsules');
  assert.equal(formatShipTypeCounts(['Astero', 'Venture']), 'Astero and Venture');
  assert.equal(cleanCitationText('hello — world 😈'), 'hello - world');
});

test('provides large, unique, citation-safe humor and final-note rotations', () => {
  assert.equal(HUMOR.length, 104);
  assert.equal(FINAL_NOTES.length, 104);
  assert.equal(new Set(HUMOR).size, HUMOR.length);
  assert.equal(new Set(FINAL_NOTES).size, FINAL_NOTES.length);

  for (const line of [...HUMOR, ...FINAL_NOTES]) {
    assert.equal(cleanCitationText(line), line);
    assert.ok(!/[—–]/.test(line));
    assert.ok(!/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(line));
  }
});

test('randomly and independently selects HUMOR and FINAL WHPD note entries for each draft', () => {
  const rolls = [0, 0.999999];
  const draft = makeCitationDraft({
    id: 999,
    totalValue: 1_000_000,
    enriched: {
      victimName: 'Random Recipient',
      victimCorporationName: 'Random Ventures',
      victimShipName: 'Venture',
      systemName: 'J123456',
      officerName: 'Officer Random',
      officerShipName: 'Loki'
    }
  }, null, ['criminal-trespass'], () => rolls.shift());

  assert.equal(draft.humor, HUMOR[0]);
  assert.equal(draft.finalNote, FINAL_NOTES.at(-1));
  assert.equal(rolls.length, 0);
});

test('uses every misdemeanor and felony published by the WHPD Legal Library', () => {
  assert.equal(LEGAL_OFFENSES.length, 17);
  assert.equal(LEGAL_OFFENSES.filter((offense) => offense.classification === 'Misdemeanor').length, 9);
  assert.equal(LEGAL_OFFENSES.filter((offense) => offense.classification === 'Felony').length, 8);
  assert.equal(activityForOffenses(['criminal-trespass', 'theft']), 'criminal trespass and theft');
  assert.deepEqual(chargesForOffenses(['evading-arrest']), [
    'IUS Lex Penal Code - PENAL § 38.04 | Evading Arrest or Detention'
  ]);
  assert.ok(LEGAL_OFFENSES.some((offense) => offense.code.includes('HEALTH & SAFETY § 365.012')));
  assert.ok(LEGAL_OFFENSES.some((offense) => offense.code.includes('PENAL § 19.03')));
});

test('adds sanitized custom misdemeanors and felonies to activities and charges', () => {
  const customOffenses = [
    { id: 'custom-beacon', classification: 'Misdemeanor', code: 'WHPD § 12.34', title: 'Unauthorized Beacon Enthusiasm' },
    { id: 'custom-fashion', classification: 'Felony', code: 'WHPD § 99.01', title: 'Aggravated Fashion Crime' },
    { id: 'theft', classification: 'Felony', code: 'NOPE', title: 'Built-in ID collision' },
    { id: 'custom-incomplete', classification: 'Felony', code: '', title: 'Incomplete' }
  ];
  const catalog = availableOffenses(customOffenses);

  assert.equal(catalog.filter((offense) => offense.custom).length, 2);
  assert.equal(
    activityForOffenses(['custom-beacon', 'custom-fashion'], customOffenses),
    'unauthorized beacon enthusiasm and aggravated fashion crime'
  );
  assert.deepEqual(chargesForOffenses(['custom-beacon', 'custom-fashion'], customOffenses), [
    'WHPD § 12.34 | Unauthorized Beacon Enthusiasm',
    'WHPD § 99.01 | Aggravated Fashion Crime'
  ]);
  assert.deepEqual(
    sortOffensesAlphabetically([
      { title: 'Theft' },
      { title: 'Aggravated Fashion Crime' },
      { title: 'criminal trespass' }
    ]).map((offense) => offense.title),
    ['Aggravated Fashion Crime', 'criminal trespass', 'Theft']
  );
});

test('uses the registered hostname-specific EVE SSO applications', () => {
  assert.equal(APP_CONFIG.localClientId, '82e9470fcfab49e0baf9df8e3ea0620f');
  assert.equal(APP_CONFIG.localCallbackUrl, 'http://localhost:39614/callback');
  assert.equal(APP_CONFIG.productionClientId, '30cb230d2c4a4e248485d6687f804aec');
  assert.equal(APP_CONFIG.productionCallbackUrl, 'https://cw.whpd.space/callback');
});

test('uses the canonical WHPD logo instead of the placeholder mark', () => {
  const index = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const auth = readFileSync(new URL('../auth.html', import.meta.url), 'utf8');
  const logoUrl = 'https://whpd.space/images/whpd.png';
  assert.ok(index.includes(`<img class="brand-mark" src="${logoUrl}"`));
  assert.ok(auth.includes(`<img class="brand-mark brand-mark-large" src="${logoUrl}"`));
  assert.ok(!index.includes('aria-hidden="true">W</span>'));
});

test('includes the GitHub Pages 404 route and OAuth callback handoff', () => {
  const fallback = readFileSync(new URL('../404.html', import.meta.url), 'utf8');
  const index = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const cname = readFileSync(new URL('../CNAME', import.meta.url), 'utf8').trim();
  const deployment = readFileSync(new URL('../.github/workflows/deploy.yml', import.meta.url), 'utf8');

  assert.equal(cname, 'cw.whpd.space');
  assert.ok(fallback.includes("target.searchParams.set('route', url.pathname)"));
  assert.ok(fallback.includes("target.searchParams.set('routeQuery', url.search)"));
  assert.ok(index.includes("route.replace(/\\/+$/, '') === '/callback'"));
  assert.ok(index.includes("new URL('/auth.html', window.location.origin)"));
  assert.ok(deployment.includes('branches: [main]'));
  assert.ok(deployment.includes('publish_branch: gh-pages'));
  assert.ok(deployment.includes('run: npm test'));
});

test('exposes TEST delivery as a persistent setting instead of a separate send action', () => {
  const index = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const app = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
  assert.ok(index.includes('id="test-mode-input"'));
  assert.ok(app.includes('testMode: false'));
  assert.ok(app.includes('if (state.settings.testMode) return sendTestCitation();'));
  assert.ok(!app.includes('data-action="send-test-citation"'));
});

test('adds the configured mailing list to live mail while character-only mail remains available for TEST mode', () => {
  const index = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const app = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
  const testDelivery = app.slice(
    app.indexOf('async function sendTestCitation()'),
    app.indexOf('async function saveSettings(')
  );

  assert.ok(index.includes('id="mailing-list-id-input"'));
  assert.ok(app.includes('mailingListId: 145225352'));
  assert.ok(!testDelivery.includes('mailingListId'));
  assert.deepEqual(buildMailRecipients(90000001, 145225352), [
    { recipient_id: 90000001, recipient_type: 'character' },
    { recipient_id: 145225352, recipient_type: 'mailing_list' }
  ]);
  assert.deepEqual(buildMailRecipients(90000002), [
    { recipient_id: 90000002, recipient_type: 'character' }
  ]);
  assert.deepEqual(buildMailRecipients([90000001, 90000002, 90000001], 145225352), [
    { recipient_id: 90000001, recipient_type: 'character' },
    { recipient_id: 90000002, recipient_type: 'character' },
    { recipient_id: 145225352, recipient_type: 'mailing_list' }
  ]);
  assert.throws(() => buildMailRecipients(90000001, 'invalid'), /valid EVE Mail mailing list ID/);
});

test('reads total value from the zKillboard killID response shape', () => {
  const payload = [{
    killmail_id: 136980595,
    zkb: {
      fittedValue: 268519527.41,
      droppedValue: 52411857.59,
      destroyedValue: 252538873.64,
      totalValue: 304950731.23
    }
  }];

  assert.equal(extractZkillValue(payload), 304950731.23);
  assert.equal(extractZkillValue([]), null);
});

test('parses zKillboard links and validates complete killmail import responses', () => {
  assert.equal(parseZkillKillmailId('https://zkillboard.com/kill/136980595/'), 136980595);
  assert.equal(parseZkillKillmailId('https://www.zkillboard.com/kill/136980595?foo=bar'), 136980595);
  assert.equal(parseZkillKillmailId('https://zkillboard.com/api/killID/136980595/'), 136980595);
  assert.equal(parseZkillKillmailId('136980595'), 136980595);
  assert.equal(parseZkillKillmailId('https://example.com/kill/136980595/'), null);
  assert.equal(parseZkillKillmailId('not a killmail'), null);

  const imported = extractZkillKillmail([{
    killmail_id: 136980595,
    killmail_time: '2026-07-13T10:17:36Z',
    solar_system_id: 30002645,
    victim: { character_id: 90446164, ship_type_id: 47466 },
    attackers: [{ character_id: 2123467334, final_blow: true }],
    zkb: { hash: 'abc123', totalValue: 304950731.23 }
  }], 136980595);

  assert.equal(imported.id, 136980595);
  assert.equal(imported.hash, 'abc123');
  assert.equal(imported.totalValue, 304950731.23);
  assert.equal(imported.detail.zkb, undefined);
  assert.throws(
    () => extractZkillKillmail([{ ...imported.detail, zkb: {} }], 42),
    /different killmail/
  );
});

test('treats intake timestamps as UTC and formats relative time only as supporting text', () => {
  assert.equal(formatUtcDateTime('2026-08-05T13:14:15Z'), '2026-08-05 13:14:15 UTC');
  assert.equal(formatUtcDateTime('2026-08-05 13:14:15'), '2026-08-05 13:14:15 UTC');
  assert.equal(formatUtcDateTime(null), 'Unknown time');
  assert.equal(isoUtcDateTime('2026-08-05 13:14:15'), '2026-08-05T13:14:15.000Z');
  assert.equal(
    formatRelativeTime('2026-08-05T13:14:15Z', Date.parse('2026-08-05T15:14:15Z')),
    '2 hours ago'
  );
});

test('groups a pilot ship loss with the following pod loss', () => {
  const ship = {
    id: 100,
    recipientId: 9001,
    killmailTime: '2026-08-05T13:00:00Z',
    detail: { victim: { character_id: 9001, ship_type_id: 32880 } },
    enriched: { victimShipName: 'Venture' }
  };
  const pod = {
    id: 101,
    recipientId: 9001,
    killmailTime: '2026-08-05T13:01:00Z',
    detail: { victim: { character_id: 9001, ship_type_id: 670 } },
    enriched: { victimShipName: 'Capsule' }
  };
  const unrelated = {
    id: 102,
    recipientId: 42,
    killmailTime: '2026-08-05T13:02:00Z',
    detail: { victim: { character_id: 42, ship_type_id: 587 } },
    enriched: { victimShipName: 'Rifter' }
  };

  const groups = groupKillmails([unrelated, pod, ship]);
  const paired = groups.find((group) => group.primary.id === ship.id);
  assert.equal(groups.length, 2);
  assert.equal(paired.pod.id, pod.id);
  assert.deepEqual(paired.records.map((record) => record.id), [100, 101]);
  assert.equal(isPodKillmail(pod), true);
});

test('does not group an unrelated later pod loss', () => {
  const ship = {
    id: 200,
    recipientId: 9001,
    killmailTime: '2026-08-05T13:00:00Z',
    detail: { victim: { character_id: 9001, ship_type_id: 32880 } },
    enriched: { victimShipName: 'Venture' }
  };
  const pod = {
    id: 201,
    recipientId: 9001,
    killmailTime: new Date(Date.parse(ship.killmailTime) + POD_PAIR_WINDOW_MS + 1000).toISOString(),
    detail: { victim: { character_id: 9001, ship_type_id: 670 } },
    enriched: { victimShipName: 'Capsule' }
  };
  assert.equal(groupKillmails([pod, ship]).length, 2);
});

test('sorts incidents by their highest killmail ID descending while preserving ship-and-pod groups', () => {
  const lowerIdNewerTime = {
    id: 400,
    recipientId: 41,
    killmailTime: '2026-08-05T15:00:00Z',
    detail: { victim: { character_id: 41, ship_type_id: 587 } },
    enriched: { victimShipName: 'Rifter' }
  };
  const groupedShip = {
    id: 500,
    recipientId: 42,
    killmailTime: '2026-08-05T13:00:00Z',
    detail: { victim: { character_id: 42, ship_type_id: 32880 } },
    enriched: { victimShipName: 'Venture' }
  };
  const groupedPod = {
    id: 501,
    recipientId: 42,
    killmailTime: '2026-08-05T13:01:00Z',
    detail: { victim: { character_id: 42, ship_type_id: 670 } },
    enriched: { victimShipName: 'Capsule' }
  };

  const groups = groupKillmails([lowerIdNewerTime, groupedPod, groupedShip]);
  assert.deepEqual(groups.map((group) => group.highestKillmailId), [501, 400]);
  assert.deepEqual(groups[0].records.map((record) => record.id), [500, 501]);
});

test('combines selected incidents across pilots into one delivery bundle', () => {
  const first = {
    id: 210,
    recipientId: 9001,
    killmailTime: '2026-08-05T13:00:00Z',
    detail: { victim: { character_id: 9001, ship_type_id: 32880 } },
    enriched: { victimShipName: 'Venture', systemName: 'J123456' }
  };
  const second = {
    id: 220,
    recipientId: 9001,
    killmailTime: '2026-08-05T14:00:00Z',
    detail: { victim: { character_id: 9001, ship_type_id: 587 } },
    enriched: { victimShipName: 'Rifter', systemName: 'J123456' }
  };
  const otherPilot = {
    id: 230,
    recipientId: 42,
    killmailTime: '2026-08-05T15:00:00Z',
    detail: { victim: { character_id: 42, ship_type_id: 626 } },
    enriched: { victimShipName: 'Vexor', systemName: 'J654321' }
  };
  const groups = groupKillmails([first, second, otherPilot]);
  const firstGroup = groups.find((group) => group.id === first.id);
  const secondGroup = groups.find((group) => group.id === second.id);
  const otherGroup = groups.find((group) => group.id === otherPilot.id);
  const combined = combineKillmailGroups([firstGroup, secondGroup], second.id);

  assert.equal(combined.primary.id, second.id);
  assert.equal(combined.incidentCount, 2);
  assert.deepEqual(combined.incidentIds, [first.id, second.id]);
  assert.deepEqual(combined.records.map((record) => record.id), [first.id, second.id]);
  const crossPilot = combineKillmailGroups([firstGroup, otherGroup], otherPilot.id);
  assert.equal(crossPilot.primary.id, otherPilot.id);
  assert.equal(crossPilot.incidentCount, 2);
  assert.deepEqual(crossPilot.records.map((record) => record.recipientId), [9001, 42]);
});

test('formats every grouped record as an in-game killmail link followed by a zkill link', () => {
  const draft = makeCitationDraft({
    id: 300,
    totalValue: 25_000_000,
    relatedKillmails: [
      { id: 300, hash: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', pilotName: 'Repeat Customer', shipName: 'Venture', systemName: 'J123456', isPod: false },
      { id: 301, hash: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', pilotName: 'Second Customer', shipName: 'Capsule', systemName: 'J654321', isPod: true }
    ],
    enriched: {
      victimName: 'Repeat Customer',
      victimCorporationName: 'Unlicensed Ventures',
      victimShipName: 'Venture and Capsule',
      systemName: 'J123456',
      finalBlowName: 'Officer Example',
      finalBlowShipName: 'Loki',
      senderShips: { 456: 'Loki' }
    }
  }, { id: 456, name: 'Officer Example' }, ['criminal-trespass']);
  const body = buildCitation(draft).body;

  assert.equal(draft.destroyedShipName, 'Venture and Capsule');
  assert.deepEqual(draft.officerComments, []);
  assert.ok(!body.includes("record the incident's orderly dismantling"));
  assert.ok(body.includes('href="killReport:300:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"'));
  assert.ok(body.includes('href="killReport:301:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"'));
  assert.ok(body.includes('<a href="https://zkillboard.com/kill/300/">'));
  assert.ok(body.includes('<a href="https://zkillboard.com/kill/301/">'));
  const renderedText = body.replace(/<[^>]+>/g, '');
  assert.ok(renderedText.includes('- Repeat Customer Venture (zkill)'));
  assert.ok(renderedText.includes('- Second Customer Capsule (zkill)'));
  assert.equal((body.match(/<font color="white">zkill<\/font>/g) || []).length, 2);
  assert.ok(!body.includes('J123456 - zKillboard'));
});

test('does not duplicate combat-record links as composer action buttons', () => {
  const app = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
  assert.ok(!app.includes("isPodKillmail(record) ? 'Pod zKill' : 'zKill'"));
});

test('renders per-incident bundle checkboxes and feeds the combined group into the citation draft', () => {
  const app = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
  assert.ok(app.includes('data-incident-select="${group.id}"'));
  assert.ok(app.includes('combineKillmailGroups(bundled, selected?.id)'));
  assert.ok(app.includes('citationKillmail(group)'));
  assert.ok(!app.includes('A citation bundle can contain incidents for only one pilot.'));
});

test('keeps every composer field in a grid row vertically aligned', () => {
  const css = readFileSync(new URL('../css/app.css', import.meta.url), 'utf8');
  assert.match(css, /\.field-grid > \.composer-field\s*{\s*margin-top: 0;/);
});

test('places the attacker-type selector left of the officer name and remembers individual roles', () => {
  const app = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
  const selectorPosition = app.indexOf('id="attacker-type-select"');
  const officerNamePosition = app.indexOf('data-draft-field="officerName"');

  assert.ok(selectorPosition > 0 && selectorPosition < officerNamePosition);
  assert.ok(app.includes('<option value="officer"'));
  assert.ok(app.includes('<option value="deputy"'));
  assert.ok(app.includes('<option value="fleet"'));
  assert.ok(app.includes('<option value="memefleet"'));
  assert.ok(app.includes('[String(characterId)]: attackerType'));
  assert.ok(app.includes("attackerRoles: { ...(state.settings.attackerRoles || {}) }"));
});

test('offers consistent centered and full-width shells for navigation and content', () => {
  const index = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const app = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../css/app.css', import.meta.url), 'utf8');

  assert.ok(index.includes('class="app-nav-inner"'));
  assert.ok(index.includes('id="layout-width-select"'));
  assert.ok(app.includes("layoutWidth: 'contained'"));
  assert.ok(app.includes("document.body.classList.add(`layout-${state.settings.layoutWidth === 'full' ? 'full' : 'contained'}`)"));
  assert.match(css, /\.app-nav-inner\s*{[^}]*width: var\(--shell-width\)/s);
  assert.match(css, /\.app-main\s*{[^}]*width: var\(--shell-width\)/s);
  assert.match(css, /body\.layout-full\s*{\s*--shell-width: calc\(100% - 2rem\)/);
});

test('offers manual zKillboard link import into the local pending queue', () => {
  const index = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const app = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');

  assert.ok(index.includes('id="zkill-import-form"'));
  assert.ok(index.includes('id="zkill-import-input"'));
  assert.ok(app.includes("const killmailId = parseZkillKillmailId(input.value)"));
  assert.ok(app.includes('const imported = await esi.zkillKillmail(killmailId)'));
  assert.ok(app.includes("status: 'pending'"));
  assert.ok(app.includes("store.put('killmails', killmail)"));
});

test('uses themed modals for alerts and approvals instead of browser dialogs', () => {
  const index = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const app = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../css/app.css', import.meta.url), 'utf8');

  assert.ok(index.includes('<dialog id="app-modal"'));
  assert.ok(index.includes('id="app-modal-confirm"'));
  assert.ok(index.includes('id="app-modal-cancel"'));
  assert.ok(app.includes('function showAlert('));
  assert.ok(app.includes('function requestApproval('));
  assert.ok(app.includes("modal.addEventListener('cancel'"));
  assert.doesNotMatch(app, /window\.(?:alert|confirm|prompt)\s*\(/);
  assert.match(css, /\.app-modal::backdrop\s*{/);
  assert.match(css, /\.app-modal\[data-tone="danger"\]/);
});

test('manages browser-local custom offenses from Settings', () => {
  const index = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const app = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
  const customSectionPosition = index.indexOf('class="panel settings-card custom-offenses-card"');
  const authorizedCharactersPosition = index.indexOf('<h2>Authorized characters</h2>');

  assert.ok(index.includes('Custom Misdemeanors &amp; Felonies'));
  assert.ok(customSectionPosition > 0 && customSectionPosition < authorizedCharactersPosition);
  assert.ok(index.includes('id="custom-offense-classification"'));
  assert.ok(index.includes('id="custom-offense-title"'));
  assert.ok(index.includes('id="custom-offense-code"'));
  assert.ok(index.includes('id="add-custom-offense-button"'));
  assert.ok(app.includes('customOffenses: []'));
  assert.ok(app.includes('async function addCustomOffense()'));
  assert.ok(app.includes('async function removeCustomOffense(offenseId)'));
  assert.ok(app.includes('availableOffenses(state.settings.customOffenses)'));
});

test('places local data actions under an explicit Danger heading', () => {
  const index = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const dangerPosition = index.indexOf('<div class="settings-section-label">Danger</div>');
  const localDataPosition = index.indexOf('<h2>Local data</h2>');
  assert.ok(dangerPosition > 0 && dangerPosition < localDataPosition);
  assert.ok(index.includes('class="settings-icon settings-icon-danger"'));
});
