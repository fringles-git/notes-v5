/**
 * Hidden notes, encrypted on the device.
 * One P-256 key pair: hiding seals a note with the public key (no PIN needed to hide), reading needs the private key.
 * The private key is stored only wrapped — by the PIN (PBKDF2-SHA256, 600 000 rounds) and, where the device offers it,
 * by Face ID / fingerprint (WebAuthn PRF: 32 secret bytes released only after the biometric check). It stays in memory
 * while Notes masquées are open and is forgotten when they close. Titles stay readable, like the list always showed them.
 */
import type { Note } from './types';

type Bytes = Uint8Array<ArrayBuffer>;
export interface Wrapped { salt: Bytes; iv: Bytes; key: ArrayBuffer }
export interface Vault { v: 1; pub: JsonWebKey; pin: Wrapped; device?: Wrapped & { id: ArrayBuffer } }
export interface Sealed { v: 1; epk: JsonWebKey; iv: Bytes; data: ArrayBuffer; blobs: Blob[] }

const subtle = () => crypto.subtle, enc = new TextEncoder(), dec = new TextDecoder();
const rand = (n: number): Bytes => crypto.getRandomValues(new Uint8Array(new ArrayBuffer(n)));
const EC = { name: 'ECDH', namedCurve: 'P-256' } as const, GCM = { name: 'AES-GCM', length: 256 } as const;
const b64 = (b: Bytes) => { let s = ''; b.forEach(x => { s += String.fromCharCode(x); }); return btoa(s); };
const unb64 = (s: string): Bytes => new Uint8Array(Array.from(atob(s), c => c.charCodeAt(0)));
const aes = (raw: BufferSource, use: KeyUsage[]) => subtle().importKey('raw', raw, 'AES-GCM', false, use);

let secret: ArrayBuffer | null = null, priv: CryptoKey | null = null;
export const isOpen = () => !!priv;
export function forget() { secret = null; priv = null; }

/* ---------- The private key, wrapped ---------- */
async function pinKey(pin: string, salt: Bytes) {
  const base = await subtle().importKey('raw', enc.encode(pin), 'PBKDF2', false, ['deriveKey']);
  return subtle().deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 6e5 }, base, GCM, false, ['encrypt', 'decrypt']);
}
async function wrap(key: CryptoKey, salt: Bytes): Promise<Wrapped> {
  const iv = rand(12);
  return { salt, iv, key: await subtle().encrypt({ name: 'AES-GCM', iv }, key, secret!) };
}
async function unwrap(key: CryptoKey, w: Wrapped) {
  const raw = await subtle().decrypt({ name: 'AES-GCM', iv: w.iv }, key, w.key);   // throws on a wrong key
  priv = await subtle().importKey('pkcs8', raw, EC, false, ['deriveKey']);
  secret = raw;
}
export async function createVault(pin: string): Promise<Vault> {
  const pair = await subtle().generateKey(EC, true, ['deriveKey']), salt = rand(16);
  secret = await subtle().exportKey('pkcs8', pair.privateKey);
  priv = await subtle().importKey('pkcs8', secret, EC, false, ['deriveKey']);
  return { v: 1, pub: await subtle().exportKey('jwk', pair.publicKey), pin: await wrap(await pinKey(pin, salt), salt) };
}
export const openWithPin = async (v: Vault, pin: string) => unwrap(await pinKey(pin, v.pin.salt), v.pin);
export async function rewrapPin(v: Vault, pin: string): Promise<Vault> {
  const salt = rand(16);
  return { ...v, pin: await wrap(await pinKey(pin, salt), salt) };
}

/* ---------- Face ID / fingerprint (WebAuthn PRF) ---------- */
type Prf = { prf?: { enabled?: boolean; results?: { first?: ArrayBuffer } } };
export async function deviceAvailable() {
  try { return isSecureContext && !!window.PublicKeyCredential && (await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()); }
  catch { return false; }
}
async function prfKey(id: ArrayBuffer, salt: Bytes) {
  const cred = (await navigator.credentials.get({
    publicKey: {
      challenge: rand(32), allowCredentials: [{ type: 'public-key', id }], userVerification: 'required', timeout: 60000,
      extensions: { prf: { eval: { first: salt } } } as AuthenticationExtensionsClientInputs,
    },
  })) as PublicKeyCredential;
  const out = (cred.getClientExtensionResults() as Prf).prf?.results?.first;
  if (!out) throw Error('no-prf');
  return aes(out, ['encrypt', 'decrypt']);
}
/** Adds Face ID / fingerprint to an open vault (two system prompts: create, then use). Throws 'no-prf' where unsupported. */
export async function addDevice(v: Vault): Promise<Vault> {
  const salt = rand(32);
  const cred = (await navigator.credentials.create({
    publicKey: {
      rp: { name: 'Notes' }, user: { id: rand(16), name: 'Notes masquées', displayName: 'Notes masquées' }, challenge: rand(32),
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
      authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'preferred' },
      timeout: 60000, extensions: { prf: {} } as AuthenticationExtensionsClientInputs,
    },
  })) as PublicKeyCredential;
  if (!(cred.getClientExtensionResults() as Prf).prf?.enabled) throw Error('no-prf');
  return { ...v, device: { ...(await wrap(await prfKey(cred.rawId, salt), salt)), id: cred.rawId } };
}
export const openWithDevice = async (v: Vault) => unwrap(await prfKey(v.device!.id, v.device!.salt), v.device!);

/* ---------- Sealing a note ---------- */
/** Each attachment is encrypted once with its own key (kept with the blob), so saving a note never re-encrypts its photos. */
const blobSeals = new WeakMap<Blob, { data: Blob; key: string; iv: string }>();
async function sealBlob(b: Blob) {
  let s = blobSeals.get(b);
  if (!s) {
    const raw = rand(32), iv = rand(12);
    s = { data: new Blob([await subtle().encrypt({ name: 'AES-GCM', iv }, await aes(raw, ['encrypt']), await b.arrayBuffer())]), key: b64(raw), iv: b64(iv) };
    blobSeals.set(b, s);
  }
  return s;
}
const noteKey = async (pub: JsonWebKey, own: CryptoKey, use: KeyUsage[]) =>
  subtle().deriveKey({ name: 'ECDH', public: await subtle().importKey('jwk', pub, EC, false, []) }, own, GCM, false, use);

async function seal(n: Note, pub: JsonWebKey): Promise<Sealed> {
  const seals = await Promise.all(n.atts.map(a => (a.blob ? sealBlob(a.blob) : null)));
  const payload = {
    body: n.body, versions: n.versions, cards: n.cards,
    atts: n.atts.map((a, i) => ({ ...a, blob: undefined, mime: a.blob?.type, key: seals[i]?.key, iv: seals[i]?.iv })),
  };
  const eph = await subtle().generateKey(EC, true, ['deriveKey']), iv = rand(12);
  return {
    v: 1, epk: await subtle().exportKey('jwk', eph.publicKey), iv,
    data: await subtle().encrypt({ name: 'AES-GCM', iv }, await noteKey(pub, eph.privateKey, ['encrypt']), enc.encode(JSON.stringify(payload))),
    blobs: seals.flatMap(s => (s ? [s.data] : [])),
  };
}
type Opened = Pick<Note, 'body' | 'versions' | 'cards' | 'atts'>;
export async function unseal(s: Sealed): Promise<Opened> {
  const p = JSON.parse(dec.decode(await subtle().decrypt({ name: 'AES-GCM', iv: s.iv }, await noteKey(s.epk, priv!, ['decrypt']), s.data)));
  let next = 0;
  const atts = await Promise.all(p.atts.map(async ({ mime, key, iv, ...a }: Record<string, string>) => {
    if (!key) return a;
    const data = s.blobs[next++];
    const blob = new Blob([await subtle().decrypt({ name: 'AES-GCM', iv: unb64(iv) }, await aes(unb64(key), ['decrypt']), await data.arrayBuffer())], { type: mime });
    blobSeals.set(blob, { data, key, iv });
    return { ...a, blob };
  }));
  return { body: p.body, versions: p.versions || [], cards: p.cards, atts };
}

/** What goes to storage: a hidden note's content sealed (title, dates and flags stay readable), everything else as is. */
export async function toRecord(n: Note, v: Vault | null): Promise<Note> {
  const { sealed: _old, sealedOnly, ...plain } = n;
  if (sealedOnly) return n.locked ? n : { ...n, locked: true };   // never written out without its content: stays hidden
  if (!n.locked || !v) return plain;   // shown notes; or hidden under an older PIN, sealed at the next unlock
  return { ...plain, body: '', atts: [], versions: [], cards: undefined, sealed: await seal(n, v.pub), sealedOnly: true };
}
