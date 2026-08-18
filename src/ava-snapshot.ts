import { readFile, open } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { decodeCBOR } from '@levischuck/tiny-cbor';

const AVA_SNAPSHOT_MAGIC_BYTES = 'AVA Snapshot v';
const SUPPORTED_CONTAINER_VERSION = 3;
const SUPPORTED_CONCORDANCE_VERSION = 3;
// Two md5 digests AVA writes between the header and the payload.
const HEADER_DIGEST_BYTES = 2 * 16;
// Value type tags used by ava's encoder
const ZERO = 0x00;
const INT8 = 0x01;
const INT48 = 0x06;
const NUMBER_STRING = 0x07;
const BIG_INT = 0x0c;
const UNDEFINED = 0x0d;
const NULL = 0x0e;
const TRUE = 0x0f;
const FALSE = 0x10;
const UTF8 = 0x11;
const BYTES = 0x12;
const LIST = 0x13;
const DESCRIPTOR = 0x14;
// type ID of a string
const STRING_DESCRIPTOR_ID = 0x05;

interface DecodedValue {
  offset: number;
  value: unknown;
}

const decodeValue = (buffer: Buffer, offset: number): DecodedValue => {
  const type = buffer.readUInt8(offset);
  offset += 1;

  switch (type) {
    case ZERO:
      return { offset, value: 0 };
    case UNDEFINED:
      return { offset, value: undefined };
    case NULL:
      return { offset, value: null };
    case TRUE:
      return { offset, value: true };
    case FALSE:
      return { offset, value: false };
  }

  // ints also store how many bytes they take up in the type itself
  if (type >= INT8 && type <= INT48) {
    return { offset: offset + type, value: buffer.readIntLE(offset, type) };
  }

  if (
    type === NUMBER_STRING ||
    type === BIG_INT ||
    type === UTF8 ||
    type === BYTES
  ) {
    const length = decodeValue(buffer, offset);
    const start = length.offset;
    const end = start + (length.value as number);

    switch (type) {
      case UTF8:
        return { offset: end, value: buffer.toString('utf-8', start, end) };
      case NUMBER_STRING:
        return {
          offset: end,
          value: Number(buffer.toString('utf-8', start, end)),
        };
      case BIG_INT:
        return {
          offset: end,
          value: BigInt(buffer.toString('utf-8', start, end)),
        };
      default:
        return { offset: end, value: buffer.subarray(start, end) };
    }
  }

  if (type === LIST || type === DESCRIPTOR) {
    const length = decodeValue(buffer, offset);
    const size = length.value as number;
    const value = new Array<unknown>(size);
    offset = length.offset;

    for (let i = 0; i < size; i++) {
      const item = decodeValue(buffer, offset);
      offset = item.offset;
      value[i] = item.value;
    }

    return { offset, value };
  }

  throw new Error(
    `Unsupported encoded value type 0x${type.toString(16)} at offset ${offset - 1}.`,
  );
};

const decodeSnapshotString = (buffer: Buffer, title: string): string => {
  const version = buffer.readUInt16LE(0);

  if (version !== SUPPORTED_CONCORDANCE_VERSION) {
    throw new Error(
      `Unsupported serialization version ${version} in snapshot "${title}".`,
    );
  }

  const rootOffset = buffer.readUInt32LE(2);
  const pluginIndex = decodeValue(buffer, rootOffset);
  const id = decodeValue(buffer, pluginIndex.offset);
  const pointerCount = decodeValue(buffer, id.offset);

  if (pluginIndex.value !== 0 || id.value !== STRING_DESCRIPTOR_ID) {
    throw new Error(
      `Snapshot "${title}" holds a non-string value, which cannot be compared with a Vitest snapshot.`,
    );
  }

  return decodeValue(buffer, pointerCount.offset).value as string;
};

export const decodeAvaSnapshot = async (
  filePath: string,
): Promise<Record<string, string>> => {
  const file = await readFile(filePath);
  const headerEnd = file.indexOf(0x0a);

  if (
    headerEnd === -1 ||
    !file
      .subarray(0, headerEnd)
      .toString('utf-8')
      .startsWith(AVA_SNAPSHOT_MAGIC_BYTES)
  ) {
    throw new Error(`"${filePath}" is not an AVA snapshot file.`);
  }

  const version = file.readUInt16LE(headerEnd + 1);

  if (version !== SUPPORTED_CONTAINER_VERSION) {
    throw new Error(
      `Unsupported AVA snapshot version ${version} in "${filePath}".`,
    );
  }

  const payload = file.subarray(headerEnd + 1 + 2 + HEADER_DIGEST_BYTES);
  const container = decodeCBOR(new Uint8Array(gunzipSync(payload)));

  if (!(container instanceof Map)) {
    throw new Error(`Malformed AVA snapshot in "${filePath}".`);
  }

  const blocks = container.get('blocks');

  if (!Array.isArray(blocks)) {
    throw new Error(`Malformed AVA snapshot in "${filePath}": missing blocks.`);
  }

  const entries: Record<string, string> = {};

  for (const block of blocks) {
    if (!(block instanceof Map)) {
      throw new Error(
        `Malformed AVA snapshot in "${filePath}": malformed block.`,
      );
    }

    const title = String(block.get('title'));
    const snapshots = block.get('snapshots');

    if (!Array.isArray(snapshots)) {
      throw new Error(`Snapshot block "${title}" has no snapshots.`);
    }

    for (let i = 0; i < snapshots.length; i++) {
      const snapshot = snapshots[i];
      const data = snapshot instanceof Map ? snapshot.get('data') : undefined;

      if (!(data instanceof Uint8Array)) {
        throw new Error(`Snapshot "${title}" is missing its data.`);
      }

      entries[`${title} ${i + 1}`] = decodeSnapshotString(
        Buffer.from(data.buffer, data.byteOffset, data.byteLength),
        title,
      );
    }
  }

  return entries;
};

/**
 * Determines whether a file is an AVA snapshot by its magic header.
 */
export const isAvaSnapshot = async (filePath: string) => {
  const file = await open(filePath, 'r');

  try {
    const { buffer, bytesRead } = await file.read(
      Buffer.alloc(AVA_SNAPSHOT_MAGIC_BYTES.length),
      0,
      AVA_SNAPSHOT_MAGIC_BYTES.length,
      0,
    );
    return buffer.toString('utf-8', 0, bytesRead) === AVA_SNAPSHOT_MAGIC_BYTES;
  } finally {
    await file.close();
  }
};
