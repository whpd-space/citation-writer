export const BACKUP_FORMAT = 'whpd-citation-writer-backup';
export const BACKUP_VERSION = 1;
export const BACKUP_STORE_NAMES = Object.freeze([
  'characters',
  'killmails',
  'history',
  'names',
  'kv'
]);

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function primaryKeyFor(storeName, record) {
  return storeName === 'kv' ? record.key : record.id;
}

function validPrimaryKey(storeName, key) {
  if (storeName === 'history') {
    return (typeof key === 'string' && key.trim().length > 0)
      || (Number.isSafeInteger(key) && key > 0);
  }
  if (storeName === 'kv') return typeof key === 'string' && key.trim().length > 0;
  return Number.isSafeInteger(key) && key > 0;
}

function validateStoreRecords(storeName, records) {
  if (!Array.isArray(records)) throw new Error(`Backup store “${storeName}” must be an array.`);

  const keys = new Set();
  records.forEach((record, index) => {
    if (!isRecord(record)) throw new Error(`Backup store “${storeName}” contains an invalid record at position ${index + 1}.`);
    const key = primaryKeyFor(storeName, record);
    if (!validPrimaryKey(storeName, key)) {
      throw new Error(`Backup store “${storeName}” contains an invalid primary key at position ${index + 1}.`);
    }
    const comparableKey = `${typeof key}:${key}`;
    if (keys.has(comparableKey)) throw new Error(`Backup store “${storeName}” contains duplicate key “${key}”.`);
    keys.add(comparableKey);
  });

  if (storeName === 'characters' && records.some((record) => typeof record.name !== 'string' || !record.name.trim())) {
    throw new Error('Every authorized character in the backup must have a name.');
  }
  if (storeName === 'names' && records.some((record) => typeof record.name !== 'string' || !record.name.trim())) {
    throw new Error('Every cached EVE name in the backup must have a name.');
  }
  if (storeName === 'killmails' && records.some((record) => (
    record.detail != null && (
      !isRecord(record.detail)
      || (record.detail.attackers != null && (
        !Array.isArray(record.detail.attackers)
        || record.detail.attackers.some((attacker) => !isRecord(attacker))
      ))
    )
  ))) {
    throw new Error('The backup contains malformed combat-record details.');
  }
  if (storeName === 'history' && records.some((record) => (
    ['killmailIds', 'mailIds', 'recipientIds', 'copyRecipientIds']
      .some((field) => record[field] != null && !Array.isArray(record[field]))
  ))) {
    throw new Error('The backup contains a malformed citation ledger entry.');
  }
  if (storeName === 'kv') {
    const settings = records.find((record) => record.key === 'settings')?.value;
    if (settings != null && (
      !isRecord(settings)
      || (settings.attackerRoles != null && !isRecord(settings.attackerRoles))
      || (settings.customOffenses != null && !Array.isArray(settings.customOffenses))
      || (settings.citationTemplates != null && !Array.isArray(settings.citationTemplates))
    )) {
      throw new Error('The backup contains malformed app settings.');
    }
  }
}

export function createBackup(stores, exportedAt = new Date()) {
  if (!isRecord(stores)) throw new Error('Local app data could not be read for export.');
  BACKUP_STORE_NAMES.forEach((storeName) => validateStoreRecords(
    storeName,
    storeName === 'characters' ? [] : stores[storeName]
  ));
  const timestamp = exportedAt instanceof Date ? exportedAt.toISOString() : new Date(exportedAt).toISOString();
  const exportedStores = Object.fromEntries(BACKUP_STORE_NAMES.map((storeName) => [
    storeName,
    storeName === 'characters' ? [] : stores[storeName]
  ]));

  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: timestamp,
    credentialsIncluded: false,
    excluded: ['eve-sso-credentials'],
    stores: exportedStores
  };
}

export function parseBackup(source) {
  let backup;
  try {
    backup = typeof source === 'string' ? JSON.parse(source) : source;
  } catch {
    throw new Error('The selected file is not valid JSON.');
  }

  if (!isRecord(backup) || backup.format !== BACKUP_FORMAT) {
    throw new Error('The selected file is not a WHPD Citation Writer backup.');
  }
  if (backup.version !== BACKUP_VERSION) {
    throw new Error(`Backup version ${String(backup.version ?? 'unknown')} is not supported by this version of the app.`);
  }
  if (typeof backup.exportedAt !== 'string' || !Number.isFinite(Date.parse(backup.exportedAt))) {
    throw new Error('The backup has an invalid export date.');
  }
  if (!isRecord(backup.stores)) throw new Error('The backup does not contain local app data.');
  BACKUP_STORE_NAMES.forEach((storeName) => validateStoreRecords(storeName, backup.stores[storeName]));
  if (backup.credentialsIncluded !== false || backup.stores.characters.length > 0) {
    throw new Error('For safety, backups containing authorized characters or SSO credentials cannot be imported.');
  }

  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: backup.exportedAt,
    credentialsIncluded: false,
    excluded: ['eve-sso-credentials'],
    stores: Object.fromEntries(BACKUP_STORE_NAMES.map((storeName) => [storeName, backup.stores[storeName]]))
  };
}

export function backupCounts(backup) {
  return {
    characters: backup.stores.characters.length,
    killmails: backup.stores.killmails.length,
    history: backup.stores.history.length,
    names: backup.stores.names.length,
    settings: backup.stores.kv.length
  };
}
