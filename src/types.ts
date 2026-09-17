/** Shared domain types for Stegossauro (volatile memory only). */

export type LsbDensity = 1 | 2 | 3;

export interface SecretMetadata {
  /** Original basename with extension (path stripped only). */
  name: string;
  mimeType: string;
}

export interface CoverImageInfo {
  width: number;
  height: number;
  megapixels: number;
  /** Capacity in bytes at each density (payload envelope room ≈ floor(bits/8)). */
  capacityBytes1: number;
  capacityBytes2: number;
  capacityBytes3: number;
  /** Bits available at density d: width*height*3*d */
  capacityBits1: number;
  capacityBits2: number;
  capacityBits3: number;
}

export interface EmbedRequest {
  /** Raw RGBA pixel buffer (width * height * 4). Alpha must remain 255. */
  imageData: Uint8ClampedArray;
  width: number;
  height: number;
  /** Parsed 32-byte key material. */
  keyBytes: Uint8Array;
  /** Arbitrary raw binary secret (any format / extension). */
  secretBytes: Uint8Array;
  metadata: SecretMetadata;
}

export interface EmbedResult {
  imageData: Uint8ClampedArray;
  width: number;
  height: number;
  bitsUsed: number;
  capacityBits: number;
  occupancyRatio: number;
  density: LsbDensity;
  compressed: boolean;
  /** Ratio stored/original (1 = no gain). */
  compressionRatio: number;
  originalBytes: number;
  storedBytes: number;
}

export interface ExtractRequest {
  imageData: Uint8ClampedArray;
  width: number;
  height: number;
  keyBytes: Uint8Array;
}

export interface ExtractResult {
  metadata: SecretMetadata;
  payload: Uint8Array;
  density: LsbDensity;
  compressed: boolean;
}

export type AuditLevel = 'info' | 'ok' | 'warn' | 'error';

export interface AuditEntry {
  ts: number;
  level: AuditLevel;
  message: string;
}

export type WorkerRequest =
  | { id: string; type: 'embed'; payload: EmbedRequest }
  | { id: string; type: 'extract'; payload: ExtractRequest };

export type WorkerResponse =
  | {
      id: string;
      type: 'progress';
      percent: number;
      message: string;
    }
  | {
      id: string;
      type: 'embed-ok';
      result: EmbedResult;
    }
  | {
      id: string;
      type: 'extract-ok';
      result: ExtractResult;
    }
  | {
      id: string;
      type: 'error';
      message: string;
    };

/** Fixed layout sizes (bytes) for the hidden container. */
export const AUTH_CHECKSUM_SIZE = 4;
export const FLAGS_SIZE = 1;
export const META_LENGTH_SIZE = 2;
export const PAYLOAD_LENGTH_SIZE = 4;
export const KEY_BYTE_LENGTH = 32;

/** RGB channel slots per pixel (Alpha excluded). */
export const CHANNELS_PER_PIXEL = 3;

/** Bit 0 of Config Flags. */
export const FLAG_COMPRESSED = 0b0000_0001;
/** Bits 1-2 of Config Flags store density (1|2|3). */
export const FLAG_DENSITY_SHIFT = 1;
