const DB_NAME = 'solovault';
const STORE_NAME = 'vault';
const DB_VERSION = 1;
const KDF_ITERATIONS = 600000;
const RECOVERY_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

function ab2b64(buffer) {
  return btoa(String.fromCharCode(...new Uint8Array(buffer)));
}

function b642ab(base64) {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

function randomBytes(n) {
  return crypto.getRandomValues(new Uint8Array(n));
}

function generateRecoveryCode() {
  const bytes = randomBytes(32);
  let code = '';
  for (let i = 0; i < 32; i++) {
    code += RECOVERY_CHARS[bytes[i] % RECOVERY_CHARS.length];
    if ((i + 1) % 4 === 0 && i < 31) code += '-';
  }
  return code;
}

async function deriveKey(secret, saltBase64, iterations) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./kdf.worker.js', import.meta.url));
    worker.onmessage = (e) => {
      worker.terminate();
      if (e.data.type === 'derived') {
        crypto.subtle.importKey(
          'raw',
          e.data.keyBytes,
          { name: 'AES-GCM' },
          false,
          ['wrapKey', 'unwrapKey', 'encrypt', 'decrypt']
        ).then(resolve).catch(reject);
      } else if (e.data.type === 'error') {
        reject(new Error(e.data.error));
      }
    };
    worker.onerror = (e) => {
      worker.terminate();
      reject(new Error(e.message || 'Worker error'));
    };
    worker.postMessage({
      type: 'derive',
      secret,
      saltBase64,
      iterations: iterations || KDF_ITERATIONS
    });
  });
}

async function generateDek() {
  return crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt']
  );
}

async function encryptJson(key, value) {
  const iv = randomBytes(12);
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(JSON.stringify(value))
  );
  return { iv: ab2b64(iv), ciphertext: ab2b64(ciphertext) };
}

async function decryptJson(key, blob) {
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: new Uint8Array(b642ab(blob.iv)) },
    key,
    new Uint8Array(b642ab(blob.ciphertext))
  );
  return JSON.parse(new TextDecoder().decode(plaintext));
}

async function wrapDek(dek, wrappingKey) {
  const iv = randomBytes(12);
  const ciphertext = await crypto.subtle.wrapKey('raw', dek, wrappingKey, {
    name: 'AES-GCM',
    iv
  });
  return { iv: ab2b64(iv), ciphertext: ab2b64(ciphertext) };
}

async function unwrapDek(blob, wrappingKey) {
  return crypto.subtle.unwrapKey(
    'raw',
    new Uint8Array(b642ab(blob.ciphertext)),
    wrappingKey,
    { name: 'AES-GCM', iv: new Uint8Array(b642ab(blob.iv)) },
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt']
  );
}

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function hasLocalVault() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const req = store.getKey('current');
    req.onsuccess = () => resolve(req.result === 'current');
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => db.close();
  });
}

async function readLocalVault() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const req = store.get('current');
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => db.close();
  });
}

async function writeLocalVault(vault) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.put(vault, 'current');
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

async function clearLocalVault() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.delete('current');
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

async function createVault(masterPassword) {
  const saltPw = ab2b64(randomBytes(16));
  const saltRec = ab2b64(randomBytes(16));
  const recoveryCode = generateRecoveryCode();

  const [kekPw, kekRec, dek] = await Promise.all([
    deriveKey(masterPassword, saltPw, KDF_ITERATIONS),
    deriveKey(recoveryCode.replace(/-/g, ''), saltRec, KDF_ITERATIONS),
    generateDek()
  ]);

  const [dekByPassword, dekByRecovery, payload] = await Promise.all([
    wrapDek(dek, kekPw),
    wrapDek(dek, kekRec),
    encryptJson(dek, { entries: [] })
  ]);

  const now = Date.now();
  const vaultFile = {
    version: 1,
    kdf: {
      algorithm: 'pbkdf2-sha256',
      params: { iterations: KDF_ITERATIONS },
      saltPw,
      saltRec
    },
    envelope: { dekByPassword, dekByRecovery },
    payload,
    meta: { createdAt: now, updatedAt: now }
  };

  await writeLocalVault(vaultFile);
  return { vaultFile, recoveryCode };
}

async function unlockWithPassword(masterPassword, vaultFile) {
  const kekPw = await deriveKey(
    masterPassword,
    vaultFile.kdf.saltPw,
    vaultFile.kdf.params.iterations
  );
  let dek;
  try {
    dek = await unwrapDek(vaultFile.envelope.dekByPassword, kekPw);
  } catch {
    throw new Error('PASSWORD_INCORRECT');
  }
  const plain = await decryptJson(dek, vaultFile.payload);
  return { dek, plain };
}

async function resetPasswordWithRecovery(recoveryCode, newMasterPassword, vaultFile) {
  const kekRec = await deriveKey(
    recoveryCode.replace(/-/g, ''),
    vaultFile.kdf.saltRec,
    vaultFile.kdf.params.iterations
  );
  let dek;
  try {
    dek = await unwrapDek(vaultFile.envelope.dekByRecovery, kekRec);
  } catch {
    throw new Error('RECOVERY_CODE_INCORRECT');
  }
  const newSaltPw = ab2b64(randomBytes(16));
  const kekPw = await deriveKey(newMasterPassword, newSaltPw, vaultFile.kdf.params.iterations);
  const dekByPassword = await wrapDek(dek, kekPw);

  const updated = {
    ...vaultFile,
    kdf: { ...vaultFile.kdf, saltPw: newSaltPw },
    envelope: { ...vaultFile.envelope, dekByPassword },
    meta: { ...vaultFile.meta, updatedAt: Date.now() }
  };
  await writeLocalVault(updated);
  return updated;
}

async function savePlainVault(dek, currentVaultFile, plain) {
  const payload = await encryptJson(dek, plain);
  const updated = {
    ...currentVaultFile,
    payload,
    meta: { ...currentVaultFile.meta, updatedAt: Date.now() }
  };
  await writeLocalVault(updated);
  return updated;
}

function serializeVault(vault) {
  return JSON.stringify(vault, null, 2);
}

function parseVaultFile(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('INVALID_JSON');
  }
  if (!parsed || typeof parsed !== 'object') throw new Error('INVALID_FORMAT');
  if (parsed.version !== 1) throw new Error('UNSUPPORTED_VERSION');
  if (!parsed.kdf || !parsed.kdf.algorithm || !parsed.kdf.saltPw || !parsed.kdf.saltRec) {
    throw new Error('INVALID_FORMAT');
  }
  if (!parsed.envelope || !parsed.envelope.dekByPassword || !parsed.envelope.dekByRecovery) {
    throw new Error('INVALID_FORMAT');
  }
  if (!parsed.payload || !parsed.payload.iv || !parsed.payload.ciphertext) {
    throw new Error('INVALID_FORMAT');
  }
  return parsed;
}

function downloadVault(vault) {
  const blob = new Blob([serializeVault(vault)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  a.href = url;
  a.download = `solovault-backup-${ts}.vault`;
  a.click();
  URL.revokeObjectURL(url);
}

function entriesToBulkText(entries) {
  return entries.map((e) => {
    const lines = [];
    if (e.title) lines.push(`title: ${e.title}`);
    lines.push(`username: ${e.username}`);
    lines.push(`password: ${e.password}`);
    if (e.url) lines.push(`url: ${e.url}`);
    if (e.note) lines.push(`note: ${e.note}`);
    return lines.join('\n');
  }).join('\n\n');
}

function parseBulkText(text) {
  const blocks = text.split(/\n\s*\n+/).filter((b) => b.trim());
  const entries = [];
  const errors = [];

  blocks.forEach((block, blockIndex) => {
    const fields = {};
    const lines = block.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const colonIdx = trimmed.indexOf(':');
      if (colonIdx < 1) continue;
      const key = trimmed.substring(0, colonIdx).trim().toLowerCase();
      const val = trimmed.substring(colonIdx + 1).trim();
      if (['title', 'username', 'password', 'url', 'note', 'totpsecret'].includes(key)) {
        fields[key] = val;
      }
    }
    if (!fields.username || !fields.password) {
      errors.push({
        blockIndex: blockIndex + 1,
        message: `条目缺少必填项「username」或「password」`
      });
      return;
    }
    entries.push({
      id: crypto.randomUUID(),
      title: fields.title || '',
      username: fields.username,
      password: fields.password,
      url: fields.url || null,
      note: fields.note || null,
      totpSecret: fields.totpsecret || null,
      createdAt: Date.now(),
      updatedAt: Date.now()
    });
  });

  return { entries, errors };
}

function getPasswordStrength(password) {
  if (!password) return { score: 0, label: '', color: '' };
  let score = 0;
  if (password.length >= 12) score++;
  if (password.length >= 16) score++;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score++;
  if (/\d/.test(password)) score++;
  if (/[^a-zA-Z0-9]/.test(password)) score++;
  if (score <= 1) return { score, label: '弱', color: '#DC2626' };
  if (score <= 3) return { score, label: '中等', color: '#D97706' };
  return { score, label: '强', color: '#059669' };
}

export {
  ab2b64,
  b642ab,
  randomBytes,
  generateRecoveryCode,
  deriveKey,
  generateDek,
  encryptJson,
  decryptJson,
  wrapDek,
  unwrapDek,
  hasLocalVault,
  readLocalVault,
  writeLocalVault,
  clearLocalVault,
  createVault,
  unlockWithPassword,
  resetPasswordWithRecovery,
  savePlainVault,
  serializeVault,
  parseVaultFile,
  downloadVault,
  entriesToBulkText,
  parseBulkText,
  getPasswordStrength
};
