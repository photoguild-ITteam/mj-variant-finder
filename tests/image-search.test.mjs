// node --test tests/
// 画像照合（src/js/image-search/）を Node で確かめる。
// 画像は「白地に黒の四角」などの合成データで作り、索引（image-index.bin）との照合を通す。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { BIN_MESH, GRAY_MESH, binaryFeature, grayFeature, normalizeImage } from '../src/js/image-search/features.js';
import { createIndex, matchImage } from '../src/js/image-search/matcher.js';

const meta = JSON.parse(readFileSync(new URL('../src/data/image-index.json', import.meta.url), 'utf8'));
const buffer = readFileSync(new URL('../src/data/image-index.bin', import.meta.url));
const index = createIndex(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength), meta);

/** 白地に黒で図形を描いた RGBA 画像を作る */
function makeImage(width, height, draw, { invert = false } = {}) {
  const data = new Uint8ClampedArray(width * height * 4).fill(invert ? 0 : 255);
  for (let i = 3; i < data.length; i += 4) data[i] = 255;
  const set = (x, y) => {
    const p = (y * width + x) * 4;
    const v = invert ? 255 : 0;
    data[p] = data[p + 1] = data[p + 2] = v;
  };
  draw(set);
  return { data, width, height };
}

const cross = (width, height, thickness = 3) => makeImage(width, height, (set) => {
  for (let y = height * 0.2; y < height * 0.8; y++) for (let t = 0; t < thickness; t++) set(Math.round(width / 2) + t, Math.round(y));
  for (let x = width * 0.2; x < width * 0.8; x++) for (let t = 0; t < thickness; t++) set(Math.round(x), Math.round(height / 2) + t);
});

test('索引を読み込める', () => {
  assert.equal(index.records, meta.records);
  assert.ok(index.records > 58000);
  const first = index.entry(0);
  assert.match(first.mj, /^MJ\d{6}$/);
  assert.ok(first.char.length >= 1);
});

test('正規化: 位置・大きさが変わっても同じ特徴になる', () => {
  const small = grayFeature(normalizeImage(cross(40, 40)));
  const large = grayFeature(normalizeImage(cross(160, 160, 12)));
  let dot = 0;
  for (let i = 0; i < small.length; i++) dot += small[i] * large[i];
  assert.ok(dot > 0.95, `内積 ${dot.toFixed(3)}`);
  assert.equal(small.length, GRAY_MESH * GRAY_MESH);
  assert.equal(binaryFeature(normalizeImage(cross(40, 40))).length, (BIN_MESH * BIN_MESH) / 8);
});

test('白黒が反転していても読める', () => {
  const normal = grayFeature(normalizeImage(cross(80, 80)));
  const inverted = grayFeature(normalizeImage(makeImage(80, 80, (set) => {
    for (let y = 16; y < 64; y++) for (let t = 0; t < 3; t++) set(40 + t, y);
    for (let x = 16; x < 64; x++) for (let t = 0; t < 3; t++) set(x, 40 + t);
  }, { invert: true })));
  let dot = 0;
  for (let i = 0; i < normal.length; i++) dot += normal[i] * inverted[i];
  assert.ok(dot > 0.95, `内積 ${dot.toFixed(3)}`);
});

/** 索引の 16x16 白黒ビットから、その字形の画像を復元する（往復テスト用） */
function imageFromRecord(i, scale = 8) {
  const bits = index.binaryAt(i);
  const size = BIN_MESH * scale;
  return makeImage(size, size, (set) => {
    for (let cell = 0; cell < BIN_MESH * BIN_MESH; cell++) {
      if (!(bits[cell >> 3] & (0x80 >> (cell & 7)))) continue;
      const cx = (cell % BIN_MESH) * scale;
      const cy = ((cell / BIN_MESH) | 0) * scale;
      for (let y = 0; y < scale; y++) for (let x = 0; x < scale; x++) set(cx + x, cy + y);
    }
  });
}

test('索引の字形を画像にして戻すと、その字形が上位に出る（単純な字）', async () => {
  // 16x16 の白黒からの復元なので、画数の少ない字で確かめる。
  // 実際の画像での精度は README（画像から探す）の測定値を参照。
  const targets = ['々', '一', '十', '口', '日'].map((ch) => {
    for (let i = 0; i < index.records; i++) if (index.entry(i).char === ch) return i;
    return -1;
  }).filter((i) => i >= 0);
  assert.ok(targets.length >= 4);
  for (const i of targets) {
    const expected = index.entry(i);
    const candidates = await matchImage(index, imageFromRecord(i), { limit: 10 });
    assert.ok(candidates.some((c) => c.mj === expected.mj),
      `${expected.char} → ${candidates.slice(0, 5).map((c) => c.char[0]).join('')}`);
  }
});

test('十字の画像 → 縦横1本ずつの字が候補に出る', async () => {
  const candidates = await matchImage(index, cross(120, 120, 6), { limit: 12 });
  assert.ok(candidates.length > 0);
  const chars = candidates.map((c) => c.char[0]).join('');
  assert.match(chars, /[十干士土手]/, chars); // 合成画像なので似た字が並ぶ
});

test('墨が無い画像は候補なし', async () => {
  const blank = makeImage(40, 40, () => {});
  assert.deepEqual(await matchImage(index, blank), []);
});
