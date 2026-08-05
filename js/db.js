const DB_NAME = 'whpd-citation-writer';
const DB_VERSION = 1;

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.addEventListener('success', () => resolve(request.result), { once: true });
    request.addEventListener('error', () => reject(request.error), { once: true });
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.addEventListener('complete', () => resolve(), { once: true });
    transaction.addEventListener('abort', () => reject(transaction.error), { once: true });
    transaction.addEventListener('error', () => reject(transaction.error), { once: true });
  });
}

export class WHPDStore {
  constructor() {
    this.databasePromise = null;
  }

  open() {
    if (this.databasePromise) return this.databasePromise;

    this.databasePromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.addEventListener('upgradeneeded', () => {
        const database = request.result;

        if (!database.objectStoreNames.contains('characters')) {
          database.createObjectStore('characters', { keyPath: 'id' });
        }

        if (!database.objectStoreNames.contains('killmails')) {
          const store = database.createObjectStore('killmails', { keyPath: 'id' });
          store.createIndex('status', 'status', { unique: false });
          store.createIndex('killmailTime', 'killmailTime', { unique: false });
          store.createIndex('recipientId', 'recipientId', { unique: false });
        }

        if (!database.objectStoreNames.contains('history')) {
          const store = database.createObjectStore('history', { keyPath: 'id' });
          store.createIndex('recipientId', 'recipientId', { unique: false });
          store.createIndex('sentAt', 'sentAt', { unique: false });
        }

        if (!database.objectStoreNames.contains('names')) {
          database.createObjectStore('names', { keyPath: 'id' });
        }

        if (!database.objectStoreNames.contains('kv')) {
          database.createObjectStore('kv', { keyPath: 'key' });
        }
      });

      request.addEventListener('success', () => resolve(request.result), { once: true });
      request.addEventListener('error', () => reject(request.error), { once: true });
      request.addEventListener('blocked', () => reject(new Error('Local database upgrade is blocked by another tab.')), { once: true });
    });

    return this.databasePromise;
  }

  async get(storeName, key) {
    const database = await this.open();
    const transaction = database.transaction(storeName, 'readonly');
    return requestResult(transaction.objectStore(storeName).get(key));
  }

  async getAll(storeName) {
    const database = await this.open();
    const transaction = database.transaction(storeName, 'readonly');
    return requestResult(transaction.objectStore(storeName).getAll());
  }

  async put(storeName, value) {
    const database = await this.open();
    const transaction = database.transaction(storeName, 'readwrite');
    transaction.objectStore(storeName).put(value);
    await transactionDone(transaction);
    return value;
  }

  async putMany(storeName, values) {
    if (!values.length) return;
    const database = await this.open();
    const transaction = database.transaction(storeName, 'readwrite');
    const store = transaction.objectStore(storeName);
    values.forEach((value) => store.put(value));
    await transactionDone(transaction);
  }

  async delete(storeName, key) {
    const database = await this.open();
    const transaction = database.transaction(storeName, 'readwrite');
    transaction.objectStore(storeName).delete(key);
    await transactionDone(transaction);
  }

  async clear(storeName) {
    const database = await this.open();
    const transaction = database.transaction(storeName, 'readwrite');
    transaction.objectStore(storeName).clear();
    await transactionDone(transaction);
  }

  async getSetting(key, fallback = null) {
    const record = await this.get('kv', key);
    return record ? record.value : fallback;
  }

  async setSetting(key, value) {
    return this.put('kv', { key, value });
  }

  async destroy() {
    if (this.databasePromise) {
      const database = await this.databasePromise;
      database.close();
    }
    this.databasePromise = null;

    await new Promise((resolve, reject) => {
      const request = indexedDB.deleteDatabase(DB_NAME);
      request.addEventListener('success', () => resolve(), { once: true });
      request.addEventListener('error', () => reject(request.error), { once: true });
      request.addEventListener('blocked', () => reject(new Error('Close other app tabs before clearing local data.')), { once: true });
    });
  }
}
