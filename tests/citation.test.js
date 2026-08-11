import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  activityForOffenses,
  applyCitationTemplate,
  availableOffenses,
  CITATION_FOOTER,
  CITATION_HEADERS,
  citationTemplateUsesOffenses,
  citationTemplates,
  DEFAULT_CITATION_TEMPLATE,
  DEFAULT_CITATION_TEMPLATE_ID,
  DEFAULT_CITATION_SECTION_IDS,
  MINIMAL_CITATION_TEMPLATE,
  MINIMAL_CITATION_TEMPLATE_ID,
  FINAL_NOTES,
  HUMOR,
  isProtectedCitationTemplateId,
  buildCitation,
  chargesForOffenses,
  cleanCitationText,
  formatIsk,
  formatShipTypeCounts,
  LEGAL_OFFENSES,
  makeCitationDraft,
  makeManualCitationDraft,
  sortOffensesAlphabetically,
  validateCitation
} from '../js/citation.js';
import { APP_CONFIG } from '../js/config.js';
import { buildMailRecipientBatches, buildMailRecipients, ESIClient, extractCharacterMatch, extractZkillKillmail, extractZkillValue, MAX_MAIL_RECIPIENTS, parseZkillKillmailId } from '../js/esi.js';
import { formatRelativeTime, formatUtcDateTime, isoUtcDateTime } from '../js/time.js';
import { attackerRoleForFinalBlow, citationDeliveryRecipientIds, classifyKillmail, combineKillmailGroups, countDistinctAttackingPilots, distinctAttackingPilotIds, groupKillmails, isPodKillmail, POD_PAIR_WINDOW_MS, selectInvolvedOfficer } from '../js/killmail-groups.js';

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
  assert.ok(narrativeText.includes('Officer Example arrived in their Loki'));
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

test('keeps the standard template disclaimer and footer unchanged', () => {
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

test('keeps the standard and minimal built-ins available and undeletable', () => {
  const custom = {
    id: 'template-border-patrol',
    name: 'Border Patrol',
    humor: 'Custom opening.',
    evidence: 'Custom evidence.',
    officerComments: '',
    finalNote: 'Custom final note.'
  };
  const templates = citationTemplates([custom]);
  assert.equal(templates[0].id, DEFAULT_CITATION_TEMPLATE_ID);
  assert.deepEqual(templates[0], DEFAULT_CITATION_TEMPLATE);
  assert.equal(templates[1].id, MINIMAL_CITATION_TEMPLATE_ID);
  assert.deepEqual(templates[1], MINIMAL_CITATION_TEMPLATE);
  assert.equal(templates[2].name, 'Border Patrol');

  const afterRemovingEveryStoredTemplate = citationTemplates([]);
  assert.deepEqual(afterRemovingEveryStoredTemplate, [DEFAULT_CITATION_TEMPLATE, MINIMAL_CITATION_TEMPLATE]);
  assert.equal(isProtectedCitationTemplateId(DEFAULT_CITATION_TEMPLATE_ID), true);
  assert.equal(isProtectedCitationTemplateId(MINIMAL_CITATION_TEMPLATE_ID), true);
  assert.equal(isProtectedCitationTemplateId(custom.id), false);

  const updatedStandard = citationTemplates([{
    ...DEFAULT_CITATION_TEMPLATE,
    name: 'Updated WHPD Standard',
    sections: DEFAULT_CITATION_TEMPLATE.sections.map((section) => (
      section.id === DEFAULT_CITATION_SECTION_IDS.finalNote
        ? { ...section, defaultValue: 'Updated protected-template note.' }
        : section
    ))
  }]);
  assert.equal(updatedStandard[0].name, 'Updated WHPD Standard');
  assert.equal(
    updatedStandard[0].sections.find((section) => section.id === DEFAULT_CITATION_SECTION_IDS.finalNote).defaultValue,
    'Updated protected-template note.'
  );

  const migratedStandard = citationTemplates([{ ...DEFAULT_CITATION_TEMPLATE, name: 'WHPD Standard' }]);
  assert.equal(migratedStandard[0].name, 'WHPD Squizz Standard');
});

test('provides an absolutely minimal built-in citation', () => {
  const draft = applyCitationTemplate({ ...completeDraft }, MINIMAL_CITATION_TEMPLATE);
  const citation = buildCitation(draft);

  assert.equal(draft.templateId, MINIMAL_CITATION_TEMPLATE_ID);
  assert.equal(MINIMAL_CITATION_TEMPLATE.sections.length, 1);
  assert.equal(MINIMAL_CITATION_TEMPLATE.sections[0].editor, 'none');
  assert.equal(citation.subject, 'Citation: Definitely Innocent');
  assert.equal(citation.body, '<font color="white">Citation issued to Definitely Innocent.</font>');
  assert.equal(citationTemplateUsesOffenses(MINIMAL_CITATION_TEMPLATE), false);
  assert.deepEqual(validateCitation(draft), []);
});

test('creates citation box values from a template and incident placeholders', () => {
  const templated = applyCitationTemplate({
    ...completeDraft,
    sourceKillmailIds: [123]
  }, {
    id: 'template-border-patrol',
    name: 'Border Patrol',
    humor: '{{pilotName}} selected the expedited inspection lane.',
    evidence: '{{defaultEvidence}}\nOfficer {{officerName}} recorded {{totalValue}}.',
    officerComments: 'Detained in {{systemName}}.',
    finalNote: 'Please scout before returning in another {{destroyedShipName}}.'
  }, () => 0);

  assert.equal(templated.templateId, 'template-border-patrol');
  assert.equal(templated.humor, 'Definitely Innocent selected the expedited inspection lane.');
  assert.deepEqual(templated.evidence, [
    'Combat telemetry places Venture in J123456.',
    'Officer Officer Example recorded 42,000,000 ISK.'
  ]);
  assert.deepEqual(templated.officerComments, ['Detained in J123456.']);
  assert.equal(templated.finalNote, 'Please scout before returning in another Venture.');
  assert.deepEqual(validateCitation(templated), []);
});

test('renders the ordered sections defined by a template without fixed citation sections', () => {
  const template = {
    id: 'template-compact-report',
    name: 'Compact Report',
    subject: 'WHPD Incident: {{pilotName}} in {{systemName}}',
    sections: [
      {
        id: 'incident-summary',
        name: 'Incident summary',
        body: '<font color="#ff007fff"><b>Incident:</b></font>\n{{contentWhite}}',
        editor: 'text',
        defaultValue: '{{pilotName}} was documented in {{systemName}}.',
        optional: false
      },
      {
        id: 'desk-notes',
        name: 'Desk notes',
        body: '<font color="#ff007fff"><b>Desk notes:</b></font>\n{{contentBullets}}',
        editor: 'list',
        defaultValue: 'First custom note\nSecond custom note',
        optional: false
      }
    ]
  };
  const draft = applyCitationTemplate({ ...completeDraft, sourceKillmailIds: [123] }, template, () => 0);
  const { subject, body } = buildCitation(draft);

  assert.deepEqual(draft.citationTemplate.sections.map((section) => section.id), ['incident-summary', 'desk-notes']);
  assert.equal(subject, 'WHPD Incident: Definitely Innocent in J123456');
  assert.ok(body.startsWith('<font color="#ff007fff"><b>Incident:</b></font>'));
  assert.ok(body.includes('Definitely Innocent was documented in J123456.'));
  assert.ok(body.includes('- <font color="white">First custom note</font>'));
  assert.equal((body.match(/\n\n===\n\n/g) || []).length, 1);
  assert.ok(!body.includes(CITATION_HEADERS.charges));
  assert.ok(!body.includes(CITATION_FOOTER));
  assert.equal(citationTemplateUsesOffenses(draft.citationTemplate), false);
  assert.equal(citationTemplateUsesOffenses(DEFAULT_CITATION_TEMPLATE), true);
  assert.equal(buildCitation({ ...draft, subject: 'Manually revised subject' }).subject, 'Manually revised subject');
  assert.ok(validateCitation({ ...draft, subject: '' }).includes('EVE Mail subject is required.'));
  assert.deepEqual(validateCitation(draft), []);
});

test('sanitizes unsafe HTML in user-defined section layouts', () => {
  const draft = applyCitationTemplate({ ...completeDraft, sourceKillmailIds: [123] }, {
    id: 'template-sanitized',
    name: 'Sanitized',
    sections: [{
      id: 'unsafe-section',
      name: 'Unsafe section',
      body: '<script>alert(1)</script><a href="javascript:alert(2)">{{content}}</a>',
      editor: 'text',
      defaultValue: 'Safe citation copy.',
      optional: false
    }]
  }, () => 0);
  const { body } = buildCitation(draft);

  assert.ok(!body.includes('<script>'));
  assert.ok(!body.includes('href="javascript:'));
  assert.ok(body.includes('&lt;script&gt;'));
  assert.ok(body.includes('Safe citation copy.'));
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

test('creates and renders a citation draft without a killmail or zKillboard evidence', () => {
  const draft = makeManualCitationDraft(
    { id: 456, name: 'Desk Officer' },
    ['criminal-trespass'],
    () => 0
  );
  assert.deepEqual(draft.sourceKillmailIds, []);
  assert.deepEqual(draft.zkillRecords, []);
  assert.equal(draft.zkillUrl, '');
  assert.equal(draft.officerName, 'Desk Officer');

  const completed = {
    ...draft,
    pilotName: 'Definitely Innocent',
    corporationName: 'Totally Legal Ventures',
    systemName: 'J123456',
    officerShipName: 'Loki',
    destroyedShipName: 'Venture',
    totalValue: '42,000,000 ISK'
  };
  assert.deepEqual(validateCitation(completed), []);
  const citation = buildCitation(completed);
  assert.ok(citation.body.includes('Definitely Innocent'));
  assert.ok(!citation.body.includes('zkillboard.com'));
  assert.ok(!citation.body.includes('killReport:'));
});

test('matches an exact EVE character for manual citation delivery', () => {
  const payload = {
    characters: [
      { id: 1001, name: 'Definitely Innocent' },
      { id: 1002, name: 'Definitely Innocent Alt' }
    ]
  };
  assert.deepEqual(extractCharacterMatch(payload, ' definitely innocent '), {
    id: 1001,
    name: 'Definitely Innocent'
  });
  assert.throws(() => extractCharacterMatch(payload, 'Definitely'), /No EVE character named/);
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
  assert.deepEqual(distinctAttackingPilotIds(records), [10, 20, 40]);
  assert.equal(countDistinctAttackingPilots(records), 3);
  assert.deepEqual(citationDeliveryRecipientIds(records, [9001], 'officer'), [9001]);
  assert.deepEqual(citationDeliveryRecipientIds(records, [9001], 'fleet'), [9001, 10, 20, 40]);
  assert.deepEqual(citationDeliveryRecipientIds(records, [9001, 10], 'memefleet'), [9001, 10, 20, 40]);
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

test('batches large fleet deliveries within the EVE Mail recipient limit and includes the mailing list once', () => {
  const recipientIds = Array.from({ length: 100 }, (_, index) => 90000001 + index);
  const batches = buildMailRecipientBatches(recipientIds, 145225352);

  assert.equal(MAX_MAIL_RECIPIENTS, 50);
  assert.deepEqual(batches.map((batch) => batch.recipientIds.length), [49, 50, 1]);
  assert.deepEqual(batches.map((batch) => batch.mailingListId), [145225352, null, null]);
  assert.equal(new Set(batches.flatMap((batch) => batch.recipientIds)).size, 100);
  assert.throws(
    () => buildMailRecipients(recipientIds.slice(0, 50), 145225352),
    /at most 50 recipients/
  );
});

test('sends every fleet delivery batch and returns each EVE Mail ID', async () => {
  const client = new ESIClient(null);
  const calls = [];
  client.sendCitation = async (senderId, recipientIds, subject, body, options) => {
    calls.push({ senderId, recipientIds, subject, body, options });
    return 7000 + calls.length;
  };

  const recipientIds = Array.from({ length: 51 }, (_, index) => 90000101 + index);
  const mailIds = await client.sendCitationCopies(123, recipientIds, 'Fleet citation', 'Citation body', {
    mailingListId: 145225352
  });

  assert.deepEqual(mailIds, [7001, 7002]);
  assert.deepEqual(calls.map((call) => call.recipientIds.length), [49, 2]);
  assert.deepEqual(calls.map((call) => call.options.mailingListId), [145225352, null]);
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

test('submits a missing killmail to zKillboard and retries its appraisal', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  let appraisalRequests = 0;
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url, options });
    if (options.method === 'POST') return { ok: true, status: 200 };
    appraisalRequests += 1;
    return {
      ok: true,
      status: 200,
      json: async () => appraisalRequests < 3 ? [] : [{ zkb: { totalValue: 42000000 } }]
    };
  };

  try {
    const value = await new ESIClient(null).zkillValue(
      136980595,
      'baa8832d86d498781edbcc99363700213787f761',
      { retryDelay: 0 }
    );
    assert.equal(value, 42000000);
    assert.equal(appraisalRequests, 3);
    assert.equal(calls.filter((call) => call.options.method === 'POST').length, 1);
    assert.equal(
      calls.find((call) => call.options.method === 'POST').url,
      'https://zkillboard.com/api/killmail/add/136980595/baa8832d86d498781edbcc99363700213787f761/'
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('tries a submitted zKillboard appraisal five times before failing', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url, options });
    if (options.method === 'POST') return { ok: true, status: 200 };
    return { ok: true, status: 200, json: async () => [] };
  };

  try {
    await assert.rejects(
      () => new ESIClient(null).zkillValue(
        136980595,
        'baa8832d86d498781edbcc99363700213787f761',
        { retryDelay: 0 }
      ),
      /remained unavailable after 5 retries/
    );
    assert.equal(calls.filter((call) => call.options.method === 'POST').length, 1);
    assert.equal(calls.filter((call) => call.options.method !== 'POST').length, 6);
  } finally {
    globalThis.fetch = originalFetch;
  }
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

test('offers killmail-free citation composition and records manual delivery in the ledger', () => {
  const index = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const app = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
  assert.ok(index.includes('id="new-citation-button"'));
  assert.ok(app.includes('function beginManualCitation()'));
  assert.ok(app.includes("data-action=\"resolve-manual-recipient\""));
  assert.ok(app.includes("id: manual ? `manual:${recipientIds[0]}:${sentAt}`"));
  assert.ok(app.includes("killmailIds: manual ? []"));
  assert.ok(app.includes("'<span class=\"badge badge-npc\">Manual</span>'"));
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

test('provides browser-local template CRUD and applies templates in the citation composer', () => {
  const index = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const app = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');

  assert.ok(index.includes('id="citation-template-list"'));
  assert.ok(index.includes('id="templates-view"'));
  assert.ok(index.includes('data-view-target="templates"'));
  assert.ok(index.includes('id="new-citation-template-button"'));
  assert.ok(index.includes('id="save-citation-template-button"'));
  assert.ok(index.includes('id="citation-template-subject"'));
  assert.ok(index.includes('id="citation-template-section-list"'));
  assert.ok(index.includes('id="add-citation-template-section-button"'));
  assert.ok(app.includes('function renderCitationTemplates()'));
  assert.ok(app.includes('async function saveCitationTemplate()'));
  assert.ok(app.includes('async function removeCitationTemplate(templateId)'));
  assert.ok(app.includes('function addCitationTemplateSection()'));
  assert.ok(app.includes('async function updateCitationTemplateSection(sectionId, action)'));
  assert.ok(app.includes('isProtectedCitationTemplateId(template.id)'));
  assert.ok(app.includes('isProtectedCitationTemplateId(templateId)'));
  assert.ok(app.includes('id="citation-template-select"'));
  assert.ok(app.includes('data-draft-section-id='));
  assert.ok(app.includes('data-draft-field="subject"'));
  assert.ok(app.includes('Required. Initially generated by the selected template'));
  assert.ok(app.includes('citationTemplateUsesOffenses(draftTemplate)'));
  assert.ok(app.includes('const offenseSelection = usesOffenseSelection'));
  assert.ok(!app.includes('<span>Activity · select offenses'));
  assert.ok(app.includes('state.draft = applyCitationTemplate(state.draft, template)'));
});

test('shows the exact EVE Mail delivery recipients in the citation composer', () => {
  const app = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../css/app.css', import.meta.url), 'utf8');

  assert.ok(app.includes('function citationRecipientsForComposer('));
  assert.ok(app.includes('function renderCitationRecipients('));
  assert.ok(app.includes('EVE Mail recipients'));
  assert.match(app, /state\.settings\.testMode\s*\?\s*'Test recipient'/);
  assert.ok(app.includes("citedIds.has(id) ? 'Cited pilot'"));
  assert.ok(app.includes("fleetIds.has(id) ? 'Fleet copy'"));
  assert.ok(app.includes('Mailing list #${recipients.mailingListId}'));
  assert.ok(app.includes('attackerNames[String(characterId)]'));
  assert.match(css, /\.citation-recipient-list\s*{/);
  assert.match(css, /\.citation-recipient\.is-missing\s*{/);
});

test('places local data actions under an explicit Danger heading', () => {
  const index = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const dangerPosition = index.indexOf('<div class="settings-section-label">Danger</div>');
  const localDataPosition = index.indexOf('<h2>Local data</h2>');
  assert.ok(dangerPosition > 0 && dangerPosition < localDataPosition);
  assert.ok(index.includes('class="settings-icon settings-icon-danger"'));
});
