/**
 * Builds a small, valid ICC v2 sRGB display profile in memory (no binary shipped, no image
 * library needed). It carries the D50-adapted sRGB primaries, the D50 white point and a
 * 1024-entry sRGB tone curve shared by the three channels, which is what PDF/A output
 * intents and viewers expect from an "sRGB IEC61966-2.1" profile.
 */
import { latin1Decode } from './common';

let cached: Uint8Array | null = null;

function ascii(s: string): number[] {
  return [...s].map((c) => c.charCodeAt(0) & 0x7f);
}

function u32(v: number): number[] {
  return [(v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff];
}

function u16(v: number): number[] {
  return [(v >>> 8) & 0xff, v & 0xff];
}

/** s15Fixed16Number: signed 16.16 fixed point, big endian. */
function s15f16(v: number): number[] {
  return u32(Math.round(v * 65536) >>> 0);
}

function padTo4(arr: number[]): number[] {
  while (arr.length % 4) arr.push(0);
  return arr;
}

function textDescription(text: string): number[] {
  const body = ascii(text);
  return padTo4([
    ...ascii('desc'),
    0, 0, 0, 0,
    ...u32(body.length + 1),
    ...body,
    0, // ASCII terminator
    ...u32(0), // Unicode language code
    ...u32(0), // Unicode count
    ...u16(0), // ScriptCode code
    0, // ScriptCode count
    ...new Array(67).fill(0), // ScriptCode text
  ]);
}

function textTag(text: string): number[] {
  return padTo4([...ascii('text'), 0, 0, 0, 0, ...ascii(text), 0]);
}

function xyzTag(x: number, y: number, z: number): number[] {
  return [...ascii('XYZ '), 0, 0, 0, 0, ...s15f16(x), ...s15f16(y), ...s15f16(z)];
}

function srgbToLinear(v: number): number {
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

function curveTag(samples: number): number[] {
  const out = [...ascii('curv'), 0, 0, 0, 0, ...u32(samples)];
  for (let i = 0; i < samples; i++) out.push(...u16(Math.round(srgbToLinear(i / (samples - 1)) * 65535)));
  return padTo4(out);
}

export function buildSrgbIccProfile(): Uint8Array {
  const tags: { sig: string; data: number[] }[] = [
    { sig: 'desc', data: textDescription('sRGB IEC61966-2.1') },
    { sig: 'cprt', data: textTag('Public domain. No warranty.') },
    { sig: 'wtpt', data: xyzTag(0.9642, 1.0, 0.8249) },
    { sig: 'rXYZ', data: xyzTag(0.43607, 0.22249, 0.01392) },
    { sig: 'gXYZ', data: xyzTag(0.38515, 0.71687, 0.09708) },
    { sig: 'bXYZ', data: xyzTag(0.14307, 0.06061, 0.7141) },
    { sig: 'rTRC', data: curveTag(1024) },
  ];
  // The three tone curves are identical: g/b point at the r curve data (allowed by the spec).
  const shared = ['gTRC', 'bTRC'];
  const tagCount = tags.length + shared.length;
  const headerSize = 128;
  const tableSize = 4 + tagCount * 12;
  let offset = headerSize + tableSize;
  const entries: number[] = [];
  const payload: number[] = [];
  const offsets = new Map<string, { offset: number; size: number }>();
  for (const t of tags) {
    offsets.set(t.sig, { offset, size: t.data.length });
    entries.push(...ascii(t.sig), ...u32(offset), ...u32(t.data.length));
    payload.push(...t.data);
    offset += t.data.length;
  }
  const trc = offsets.get('rTRC')!;
  for (const sig of shared) entries.push(...ascii(sig), ...u32(trc.offset), ...u32(trc.size));
  // Sort the tag table by signature as the spec recommends.
  const rows: number[][] = [];
  for (let i = 0; i < entries.length; i += 12) rows.push(entries.slice(i, i + 12));
  rows.sort((a, b) => latin1Decode(Uint8Array.from(a.slice(0, 4))).localeCompare(latin1Decode(Uint8Array.from(b.slice(0, 4)))));

  const total = headerSize + tableSize + payload.length;
  const now = new Date();
  const header = [
    ...u32(total),
    ...u32(0), // preferred CMM
    ...u32(0x02100000), // version 2.1
    ...ascii('mntr'),
    ...ascii('RGB '),
    ...ascii('XYZ '),
    ...u16(now.getUTCFullYear()), ...u16(now.getUTCMonth() + 1), ...u16(now.getUTCDate()), ...u16(now.getUTCHours()), ...u16(now.getUTCMinutes()), ...u16(now.getUTCSeconds()),
    ...ascii('acsp'),
    ...u32(0), // primary platform
    ...u32(0), // flags
    ...u32(0), // device manufacturer
    ...u32(0), // device model
    ...u32(0), ...u32(0), // device attributes
    ...u32(0), // rendering intent: perceptual
    ...s15f16(0.9642), ...s15f16(1.0), ...s15f16(0.8249), // PCS illuminant (D50)
    ...u32(0), // creator
    ...new Array(16).fill(0), // profile ID
    ...new Array(28).fill(0), // reserved
  ];
  if (header.length !== headerSize) throw new Error(`ICC header is ${header.length} bytes`);
  return Uint8Array.from([...header, ...u32(tagCount), ...rows.flat(), ...payload]);
}

/** True when the buffer looks like an ICC profile (magic 'acsp' at byte 36). */
export function isIccProfile(buf: Uint8Array | null | undefined): buf is Uint8Array {
  return Boolean(buf && buf.length > 128 && latin1Decode(buf.subarray(36, 40)) === 'acsp');
}

/** Returns the generated sRGB ICC profile bytes (built once, then reused). */
export function getSrgbIccProfile(): Uint8Array {
  if (!cached) cached = buildSrgbIccProfile();
  return cached;
}
