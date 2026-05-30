self.onmessage = async function (e) {
  const { type, secret, saltBase64, iterations } = e.data;

  if (type !== 'derive') return;

  try {
    const salt = Uint8Array.from(atob(saltBase64), (c) => c.charCodeAt(0));
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(secret),
      'PBKDF2',
      false,
      ['deriveKey']
    );
    const key = await crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
      keyMaterial,
      { name: 'AES-GCM', length: 256 },
      true,
      ['wrapKey', 'unwrapKey']
    );
    const raw = await crypto.subtle.exportKey('raw', key);
    self.postMessage({ type: 'derived', keyBytes: raw }, [raw]);
  } catch (err) {
    self.postMessage({ type: 'error', error: err.message });
  }
};
